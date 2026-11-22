const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { writeAudit } = require('../lib/audit');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    let clause = '';
    if (pharmacyId) { clause = 'WHERE f.pharmacy_id=?'; params.push(pharmacyId); }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const [rows] = await pool.execute(
      `SELECT f.id,f.pharmacy_id AS pharmacyId,p.name AS pharmacy,f.medicine_id AS medicineId,m.name AS medicineName,
              f.forecast_date AS forecastDate,f.horizon_days AS horizonDays,f.predicted_demand AS predictedDemand,
              f.recommended_reorder_quantity AS recommendedReorderQuantity,f.model_version AS modelVersion,
              f.generated_at AS generatedAt,e.lookback_days AS lookbackDays,e.observed_sales_days AS observedSalesDays,
              e.data_quality AS dataQuality,e.explanation
       FROM forecast_results f JOIN pharmacies p ON p.id=f.pharmacy_id JOIN medicines m ON m.id=f.medicine_id
       LEFT JOIN forecast_explanations e ON e.forecast_id=f.id ${clause}
       ORDER BY f.forecast_date DESC,f.generated_at DESC,m.name LIMIT ?`, [...params, limit],
    );
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/generate', allowRoles('platform_admin', 'pharmacy_manager'), async (req, res, next) => {
  let conn;
  try {
    const body = z.object({
      pharmacyId: z.number().int().positive().safe().optional(), medicineId: z.number().int().positive().safe().optional(),
      horizonDays: z.number().int().refine((v) => [7, 14, 30, 90].includes(v)).default(30),
      lookbackDays: z.number().int().refine((v) => [30, 60, 90, 180].includes(v)).default(90),
    }).parse(req.body);
    const scopedPharmacy = pharmacyScope(req);
    const pharmacyId = scopedPharmacy || body.pharmacyId;
    if (!pharmacyId) throw new AppError(400, 'Select a pharmacy for forecasting.', 'PHARMACY_REQUIRED');
    if (scopedPharmacy && body.pharmacyId && Number(body.pharmacyId) !== Number(scopedPharmacy)) throw new AppError(403, 'You can only forecast demand for your assigned pharmacy.', 'PHARMACY_FORBIDDEN');
    conn = await pool.getConnection(); await conn.beginTransaction();
    const [[today]] = await conn.execute('SELECT CURRENT_DATE() AS forecastDate');
    const [[pharmacy]] = await conn.execute('SELECT id FROM pharmacies WHERE id=? AND is_active=TRUE FOR UPDATE', [pharmacyId]);
    if (!pharmacy) throw new AppError(400, 'Choose an active pharmacy.', 'INVALID_PHARMACY');
    // CURRENT_DATE() is included in the window, so subtract N - 1 to cover exactly N dates.
    const params = [pharmacyId, body.lookbackDays - 1];
    let medicineFilter = '';
    if (body.medicineId) { medicineFilter = ' AND b.medicine_id=?'; params.push(body.medicineId); }
    const [history] = await conn.execute(
      `SELECT b.medicine_id AS medicineId,m.name AS medicineName,SUM(si.quantity) AS unitsSold,
              COUNT(DISTINCT DATE(s.sold_at)) AS observedSalesDays
       FROM sales s JOIN sale_items si ON si.sale_id=s.id AND si.pharmacy_id=s.pharmacy_id
       JOIN medicine_batches b ON b.id=si.batch_id AND b.pharmacy_id=si.pharmacy_id
       JOIN medicines m ON m.id=b.medicine_id
       WHERE s.pharmacy_id=? AND s.status='completed' AND s.sold_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)
         AND s.sold_at < DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY)${medicineFilter}
       GROUP BY b.medicine_id,m.name ORDER BY m.name`, params,
    );
    if (!history.length) {
      await conn.rollback();
      return res.json({ generated: 0, data: [], dataQuality: 'insufficient', message: 'No completed sales exist in the selected history window; no forecast was stored.' });
    }
    const [stockRows] = await conn.execute(
      `SELECT b.medicine_id AS medicineId,COALESCE(SUM(i.quantity_on_hand),0) AS eligibleUnits
       FROM medicine_batches b JOIN inventory i ON i.batch_id=b.id AND i.pharmacy_id=b.pharmacy_id
       WHERE b.pharmacy_id=? AND b.expiry_date >= CURRENT_DATE() AND i.quantity_on_hand > 0
         AND NOT EXISTS (SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id
           AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id))
       GROUP BY b.medicine_id`, [pharmacyId],
    );
    const eligibleUnits = new Map(stockRows.map((row) => [String(row.medicineId), Number(row.eligibleUnits)]));
    const forecasts = [];
    for (const item of history) {
      const unitsSold = Number(item.unitsSold);
      const observedSalesDays = Number(item.observedSalesDays);
      const dailyRate = unitsSold / body.lookbackDays;
      const predictedDemand = Math.round(dailyRate * body.horizonDays * 100) / 100;
      const onHand = eligibleUnits.get(String(item.medicineId)) || 0;
      const recommendedReorderQuantity = Math.max(0, Math.ceil(predictedDemand - onHand));
      const dataQuality = observedSalesDays < 3 ? 'insufficient' : observedSalesDays < 10 ? 'limited' : 'adequate';
      const explanation = `Simple moving average: ${unitsSold} units sold across ${body.lookbackDays} calendar days (${observedSalesDays} days had sales). ${body.horizonDays}-day demand = ${predictedDemand}; eligible on-hand = ${onHand}; reorder recommendation = max(demand − on-hand, 0), rounded up. ${dataQuality === 'adequate' ? 'Historical sample is adequate for this basic estimate.' : `Historical sample is ${dataQuality}; treat this estimate cautiously.`}`;
      const [result] = await conn.execute(
        `INSERT INTO forecast_results (pharmacy_id,medicine_id,forecast_date,horizon_days,predicted_demand,recommended_reorder_quantity,model_version)
         VALUES (?,?,?,?,?,?,?)`,
        [pharmacyId, item.medicineId, today.forecastDate, body.horizonDays, predictedDemand, recommendedReorderQuantity, 'sma-v1'],
      );
      await conn.execute(
        'INSERT INTO forecast_explanations (forecast_id,lookback_days,observed_sales_days,data_quality,explanation) VALUES (?,?,?,?,?)',
        [result.insertId, body.lookbackDays, observedSalesDays, dataQuality, explanation],
      );
      forecasts.push({ id: result.insertId, medicineId: item.medicineId, medicineName: item.medicineName, predictedDemand, recommendedReorderQuantity, lookbackDays: body.lookbackDays, observedSalesDays, dataQuality, explanation });
    }
    await writeAudit(conn, { pharmacyId, userId: req.user.id, action: 'forecast.generated', entityType: 'forecast_batch', details: { horizonDays: body.horizonDays, lookbackDays: body.lookbackDays, count: forecasts.length } });
    await conn.commit();
    res.status(201).json({ generated: forecasts.length, forecastDate: today.forecastDate, horizonDays: body.horizonDays, lookbackDays: body.lookbackDays, data: forecasts });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
