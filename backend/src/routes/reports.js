const express = require('express');
const pool = require('../db');
const { authenticate, pharmacyScope } = require('../middleware/auth');
const { sendCsv } = require('../lib/csv');

const router = express.Router();
router.use(authenticate);

router.get('/inventory', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    const filter = pharmacyId ? ' AND i.pharmacy_id=?' : '';
    if (pharmacyId) params.push(pharmacyId);
    const [rows] = await pool.execute(`SELECT p.name AS pharmacy,b.batch_number AS batchNumber,m.name AS medicine,m.strength,
      i.quantity_on_hand AS quantityOnHand,i.reorder_level AS reorderLevel,b.expiry_date AS expiryDate,
      b.purchase_price AS purchasePrice,b.selling_price AS sellingPrice,s.name AS supplier
      FROM inventory i JOIN pharmacies p ON p.id=i.pharmacy_id JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
      JOIN medicines m ON m.id=b.medicine_id LEFT JOIN suppliers s ON s.id=b.supplier_id AND s.pharmacy_id=b.pharmacy_id
      WHERE 1=1${filter} ORDER BY p.name,m.name,b.expiry_date`, params);
    if (req.query.format === 'csv') return sendCsv(res, 'meditrack-inventory.csv', [
      { key: 'pharmacy', label: 'Pharmacy' }, { key: 'medicine', label: 'Medicine' }, { key: 'strength', label: 'Strength' },
      { key: 'batchNumber', label: 'Batch' }, { key: 'quantityOnHand', label: 'On hand' }, { key: 'reorderLevel', label: 'Reorder level' },
      { key: 'expiryDate', label: 'Expiry date' }, { key: 'purchasePrice', label: 'Purchase price' }, { key: 'sellingPrice', label: 'Selling price' }, { key: 'supplier', label: 'Supplier' },
    ], rows);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/sales', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const params = [from, to];
    const filter = pharmacyId ? ' AND s.pharmacy_id=?' : '';
    if (pharmacyId) params.push(pharmacyId);
    const [rows] = await pool.execute(`SELECT DATE(s.sold_at) AS saleDate,p.name AS pharmacy,COUNT(*) AS transactions,
      SUM(s.subtotal) AS subtotal,SUM(s.discount_amount) AS discounts,SUM(s.tax_amount) AS tax,SUM(s.total_amount) AS revenue
      FROM sales s JOIN pharmacies p ON p.id=s.pharmacy_id WHERE s.status='completed' AND DATE(s.sold_at) BETWEEN ? AND ?${filter}
      GROUP BY DATE(s.sold_at),p.id,p.name ORDER BY saleDate DESC,p.name`, params);
    if (req.query.format === 'csv') return sendCsv(res, 'meditrack-sales.csv', [
      { key: 'saleDate', label: 'Date' }, { key: 'pharmacy', label: 'Pharmacy' }, { key: 'transactions', label: 'Transactions' },
      { key: 'subtotal', label: 'Subtotal' }, { key: 'discounts', label: 'Discounts' }, { key: 'tax', label: 'Tax' }, { key: 'revenue', label: 'Revenue' },
    ], rows);
    res.json({ data: rows, period: { from, to } });
  } catch (error) { next(error); }
});

router.get('/transfers', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    let filter = '';
    if (pharmacyId) { filter = ' AND (t.source_pharmacy_id=? OR t.destination_pharmacy_id=?)'; params.push(pharmacyId, pharmacyId); }
    const [rows] = await pool.execute(
      `SELECT DATE(t.requested_at) AS requestDate,sp.name AS sourcePharmacy,dp.name AS destinationPharmacy,
              t.status,COUNT(*) AS transferCount,SUM(t.quantity) AS units
       FROM stock_transfers t JOIN pharmacies sp ON sp.id=t.source_pharmacy_id JOIN pharmacies dp ON dp.id=t.destination_pharmacy_id
       WHERE 1=1${filter} GROUP BY DATE(t.requested_at),sp.id,sp.name,dp.id,dp.name,t.status
       ORDER BY requestDate DESC,sp.name,dp.name,t.status`, params,
    );
    if (req.query.format === 'csv') return sendCsv(res, 'meditrack-transfers.csv', [
      { key: 'requestDate', label: 'Requested date' }, { key: 'sourcePharmacy', label: 'Source pharmacy' },
      { key: 'destinationPharmacy', label: 'Destination pharmacy' }, { key: 'status', label: 'Status' },
      { key: 'transferCount', label: 'Transfers' }, { key: 'units', label: 'Units' },
    ], rows);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/storage', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    let filter = '';
    if (pharmacyId) { filter = ' AND sl.pharmacy_id=?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(
      `SELECT DATE(sl.recorded_at) AS recordDate,p.name AS pharmacy,COUNT(*) AS readings,
              SUM(CASE WHEN sl.is_within_range=FALSE OR sc.condition_status <> 'normal' THEN 1 ELSE 0 END) AS alerts,
              AVG(sl.temperature_c) AS averageTemperatureC,MIN(sl.temperature_c) AS minTemperatureC,MAX(sl.temperature_c) AS maxTemperatureC,
              AVG(sl.humidity_percent) AS averageHumidityPercent
       FROM storage_logs sl JOIN pharmacies p ON p.id=sl.pharmacy_id
       LEFT JOIN storage_condition_details sc ON sc.storage_log_id=sl.id
       WHERE 1=1${filter} GROUP BY DATE(sl.recorded_at),p.id,p.name ORDER BY recordDate DESC,p.name`, params,
    );
    if (req.query.format === 'csv') return sendCsv(res, 'meditrack-storage.csv', [
      { key: 'recordDate', label: 'Date' }, { key: 'pharmacy', label: 'Pharmacy' }, { key: 'readings', label: 'Readings' },
      { key: 'alerts', label: 'Alerts' }, { key: 'averageTemperatureC', label: 'Average temperature C' },
      { key: 'minTemperatureC', label: 'Minimum temperature C' }, { key: 'maxTemperatureC', label: 'Maximum temperature C' },
      { key: 'averageHumidityPercent', label: 'Average humidity percent' },
    ], rows);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/forecasts', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const params = [];
    let filter = '';
    if (pharmacyId) { filter = 'WHERE f.pharmacy_id=?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(
      `SELECT p.name AS pharmacy,m.name AS medicine,f.forecast_date AS forecastDate,f.horizon_days AS horizonDays,
              f.predicted_demand AS predictedDemand,f.recommended_reorder_quantity AS recommendedReorderQuantity,
              e.lookback_days AS lookbackDays,e.observed_sales_days AS observedSalesDays,e.data_quality AS dataQuality,e.explanation
       FROM forecast_results f JOIN pharmacies p ON p.id=f.pharmacy_id JOIN medicines m ON m.id=f.medicine_id
       LEFT JOIN forecast_explanations e ON e.forecast_id=f.id ${filter}
       ORDER BY f.forecast_date DESC,f.generated_at DESC,m.name LIMIT 500`, params,
    );
    if (req.query.format === 'csv') return sendCsv(res, 'meditrack-forecasts.csv', [
      { key: 'pharmacy', label: 'Pharmacy' }, { key: 'medicine', label: 'Medicine' }, { key: 'forecastDate', label: 'Forecast date' },
      { key: 'horizonDays', label: 'Horizon days' }, { key: 'predictedDemand', label: 'Predicted demand' },
      { key: 'recommendedReorderQuantity', label: 'Recommended reorder quantity' }, { key: 'lookbackDays', label: 'Lookback days' },
      { key: 'observedSalesDays', label: 'Observed sales days' }, { key: 'dataQuality', label: 'Data quality' }, { key: 'explanation', label: 'Explanation' },
    ], rows);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

module.exports = router;
