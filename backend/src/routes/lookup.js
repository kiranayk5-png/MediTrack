const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { mysqlBooleanOrFailClosed } = require('../lib/mysqlBoolean');

const router = express.Router();
router.use(authenticate);

router.get('/barcode/:value', async (req, res, next) => {
  try {
    const value = z.string().trim().min(1).max(100).parse(req.params.value);
    const pharmacyId = pharmacyScope(req);
    if (!pharmacyId) throw new AppError(400, 'Select a pharmacy before looking up inventory by barcode.', 'PHARMACY_REQUIRED');
    const [rows] = await pool.execute(
      `SELECT m.id AS medicineId,mi.id AS identifierId,m.name,m.generic_name AS genericName,m.brand_name AS brandName,m.strength,m.dosage_form AS dosageForm,
       mi.identifier_type AS identifierType,mi.identifier_value AS identifierValue,b.id AS batchId,b.batch_number AS batchNumber,
       b.expiry_date AS expiryDate,b.selling_price AS sellingPrice,i.quantity_on_hand AS quantityOnHand,
       EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id)) AS recalled
       FROM medicine_identifiers mi JOIN medicines m ON m.id=mi.medicine_id
       LEFT JOIN medicine_batches b ON b.medicine_id=m.id${pharmacyId ? ' AND b.pharmacy_id=?' : ''}
       LEFT JOIN inventory i ON i.batch_id=b.id AND i.pharmacy_id=b.pharmacy_id
       WHERE mi.identifier_value=? ORDER BY b.expiry_date`,
      [pharmacyId, value],
    );
    if (!rows.length) {
      await pool.execute('INSERT INTO scan_history (pharmacy_id,user_id,scanned_value,scan_context,was_matched) VALUES (?,?,?,\'lookup\',FALSE)', [pharmacyId || req.user.pharmacyId, req.user.id, value]);
      throw new AppError(404, 'No medicine matches that barcode. You can still search by name or add the identifier to a medicine.', 'BARCODE_NOT_FOUND');
    }
    await pool.execute('INSERT INTO scan_history (pharmacy_id,user_id,medicine_id,identifier_id,scanned_value,scan_context,was_matched) VALUES (?,?,?,?,?,\'lookup\',TRUE)', [pharmacyId, req.user.id, rows[0].medicineId, rows[0].identifierId, value]);
    res.json({
      data: rows.map((row) => ({ ...row, recalled: mysqlBooleanOrFailClosed(row.recalled) })),
      authenticityVerified: false,
    });
  } catch (error) { next(error); }
});

module.exports = router;
