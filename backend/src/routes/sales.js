const express = require('express');
const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const pool = require('../db');
const { authenticate, allowRoles, pharmacyScope } = require('../middleware/auth');
const { AppError } = require('../lib/errors');
const { mysqlBoolean } = require('../lib/mysqlBoolean');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const pharmacyId = pharmacyScope(req);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const params = [];
    let clause = '';
    if (pharmacyId) { clause = 'WHERE s.pharmacy_id=?'; params.push(pharmacyId); }
    const [rows] = await pool.execute(`SELECT s.id, s.pharmacy_id AS pharmacyId, s.receipt_number AS receiptNumber, s.status,
      s.subtotal, s.discount_amount AS discountAmount, s.tax_amount AS taxAmount, s.total_amount AS totalAmount,
      s.sold_at AS soldAt, u.full_name AS cashierName, COUNT(si.id) AS lineCount
      FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN sale_items si ON si.sale_id=s.id AND si.pharmacy_id=s.pharmacy_id
      ${clause} GROUP BY s.id,u.full_name ORDER BY s.sold_at DESC LIMIT ?`, [...params, limit]);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.post('/', allowRoles('platform_admin', 'pharmacy_manager', 'pharmacist'), async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const pharmacyId = pharmacyScope(req) || z.number().int().positive().parse(req.body.pharmacyId);
    const body = z.object({
      items: z.array(z.object({ medicineId: z.number().int().positive(), quantity: z.number().int().positive().max(10000) })).min(1).max(50),
      discountAmount: z.number().nonnegative().default(0), taxRate: z.number().min(0).max(1).default(0),
    }).parse(req.body);
    const quantities = new Map();
    for (const item of body.items) quantities.set(item.medicineId, (quantities.get(item.medicineId) || 0) + item.quantity);

    await conn.beginTransaction();
    const allocations = [];
    const medicineIds = [...quantities.keys()].sort((a, b) => a - b);
    for (const medicineId of medicineIds) {
      const [batches] = await conn.execute(
        `SELECT i.batch_id AS batchId, i.quantity_on_hand AS quantityOnHand, b.expiry_date AS expiryDate, b.selling_price AS sellingPrice,
                EXISTS(SELECT 1 FROM recall_records rr WHERE rr.pharmacy_id=b.pharmacy_id AND rr.medicine_id=b.medicine_id
                  AND rr.status <> 'closed' AND (rr.batch_id IS NULL OR rr.batch_id=b.id)) AS recalled
         FROM inventory i JOIN medicine_batches b ON b.id=i.batch_id AND b.pharmacy_id=i.pharmacy_id
         WHERE i.pharmacy_id=? AND b.medicine_id=? AND b.expiry_date >= CURDATE() AND i.quantity_on_hand > 0
         ORDER BY b.expiry_date ASC, b.id ASC FOR UPDATE`, [pharmacyId, medicineId],
      );
      let remaining = quantities.get(medicineId);
      for (const batch of batches) {
        // mysql2 can return boolean SQL expressions as strings with bigNumberStrings enabled.
        // Only an explicit false result may pass the recall safety check.
        if (mysqlBoolean(batch.recalled) !== false) continue;
        if (remaining === 0) break;
        const quantity = Math.min(remaining, Number(batch.quantityOnHand));
        const unitPriceCents = Math.round(Number(batch.sellingPrice) * 100);
        allocations.push({ medicineId, batchId: batch.batchId, quantity, unitPriceCents, unitPrice: unitPriceCents / 100 });
        remaining -= quantity;
      }
      if (remaining > 0) throw new AppError(409, 'Not enough non-expired, non-recalled stock is available for one or more items.', 'INSUFFICIENT_ELIGIBLE_STOCK');
    }

    const subtotalCents = allocations.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    const discountCents = Math.round(body.discountAmount * 100);
    if (discountCents > subtotalCents) throw new AppError(400, 'Discount cannot exceed the sale subtotal.', 'INVALID_DISCOUNT');
    const taxAmountCents = Math.round((subtotalCents - discountCents) * body.taxRate);
    const totalAmountCents = subtotalCents - discountCents + taxAmountCents;
    const subtotal = subtotalCents / 100;
    const discountAmount = discountCents / 100;
    const taxAmount = taxAmountCents / 100;
    const totalAmount = totalAmountCents / 100;
    const receiptNumber = `MT-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [sale] = await conn.execute(
      `INSERT INTO sales (pharmacy_id,user_id,receipt_number,status,subtotal,discount_amount,tax_amount,total_amount)
       VALUES (?,?,?,'completed',?,?,?,?)`,
      [pharmacyId, req.user.id, receiptNumber, subtotal, discountAmount, taxAmount, totalAmount],
    );
    for (const item of allocations) {
      const [[current]] = await conn.execute('SELECT quantity_on_hand AS quantityOnHand FROM inventory WHERE pharmacy_id=? AND batch_id=? FOR UPDATE', [pharmacyId, item.batchId]);
      if (!current || Number(current.quantityOnHand) < item.quantity) throw new AppError(409, 'Stock changed while recording this sale. Please retry.', 'STOCK_CHANGED');
      const after = Number(current.quantityOnHand) - item.quantity;
      await conn.execute('UPDATE inventory SET quantity_on_hand=? WHERE pharmacy_id=? AND batch_id=?', [after, pharmacyId, item.batchId]);
      const lineTotal = (item.quantity * item.unitPriceCents) / 100;
      await conn.execute('INSERT INTO sale_items (pharmacy_id,sale_id,batch_id,quantity,unit_price,discount_amount,line_total) VALUES (?,?,?,?,?,0,?)', [pharmacyId, sale.insertId, item.batchId, item.quantity, item.unitPrice, lineTotal]);
      await conn.execute('INSERT INTO stock_history (pharmacy_id,batch_id,user_id,movement_type,quantity_delta,quantity_after,reference_type,reference_id,reason) VALUES (?,?,?,\'sale\',?, ?,\'sale\',?,?)', [pharmacyId, item.batchId, req.user.id, -item.quantity, after, sale.insertId, `Sale ${receiptNumber}`]);
    }
    await conn.execute('INSERT INTO audit_logs (pharmacy_id,user_id,action,entity_type,entity_id,details) VALUES (?,?,\'sale.completed\',\'sale\',?,?)', [pharmacyId, req.user.id, sale.insertId, JSON.stringify({ receiptNumber, totalAmount })]);
    await conn.commit();
    res.status(201).json({ id: sale.insertId, receiptNumber, subtotal, discountAmount: body.discountAmount, taxAmount, totalAmount, allocations });
  } catch (error) { if (conn) { try { await conn.rollback(); } catch (_rollbackError) { /* connection already ended */ } } next(error); }
  finally { conn?.release(); }
});

module.exports = router;
