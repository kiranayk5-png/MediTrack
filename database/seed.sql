-- MediTrack fictional development/demo data for MySQL 8.
-- Execute only after schema.sql has created the tables in an empty MediTrack database:
--   mysql --default-character-set=utf8mb4 -u <user> -p meditrack < database/seed.sql
-- This script does not drop or truncate tables. Fixed IDs make the sample relationships
-- readable; use a fresh database to avoid collisions with existing primary keys.
-- Demo account password hashes below are bcrypt-compatible ($2a$, cost 10); plaintext
-- passwords are not stored in this file.

START TRANSACTION;

-- Access roles
INSERT INTO roles (id, name, description) VALUES
    (1, 'platform_admin', 'Fictional platform administrator for local development'),
    (2, 'pharmacy_manager', 'Manages one pharmacy location'),
    (3, 'pharmacist', 'Dispenses medicines and records inventory activity'),
    (4, 'inventory_clerk', 'Receives and counts pharmacy stock');

-- Three fictional pharmacy locations
INSERT INTO pharmacies (id, name, license_number, email, phone, address_line1, city, state, postal_code, country_code, timezone) VALUES
    (1, 'Northstar Community Pharmacy', 'TEST-IN-MH-10001', 'northstar@example.test', '+91-20-5550-0101', '14 Cedar Lane', 'Pune', 'Maharashtra', '411001', 'IN', 'Asia/Kolkata'),
    (2, 'Harborview Family Pharmacy', 'TEST-IN-KA-20002', 'harborview@example.test', '+91-80-5550-0202', '8 Marina Road', 'Bengaluru', 'Karnataka', '560001', 'IN', 'Asia/Kolkata'),
    (3, 'Meadowgate Health Pharmacy', 'TEST-IN-TN-30003', 'meadowgate@example.test', '+91-44-5550-0303', '27 Orchard Street', 'Chennai', 'Tamil Nadu', '600001', 'IN', 'Asia/Kolkata');

-- All demo accounts share a bcrypt-compatible hash. Replace credentials outside
-- development; never use these accounts in a deployed environment.
INSERT INTO users (id, pharmacy_id, role_id, full_name, email, password_hash, phone, is_active) VALUES
    (1, NULL, 1, 'Morgan Demo', 'morgan.admin@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-01001', TRUE),
    (2, 1, 2, 'Asha Kulkarni', 'asha.manager@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-01002', TRUE),
    (3, 1, 3, 'Rohan Desai', 'rohan.pharmacist@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-01003', TRUE),
    (4, 1, 4, 'Neha Patil', 'neha.stock@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-01004', TRUE),
    (5, 2, 2, 'Vikram Rao', 'vikram.manager@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-02002', TRUE),
    (6, 2, 3, 'Isha Nair', 'isha.pharmacist@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-02003', TRUE),
    (7, 3, 2, 'Kavya Raman', 'kavya.manager@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-03002', TRUE),
    (8, 3, 3, 'Arjun Iyer', 'arjun.pharmacist@example.test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '+91-90000-03003', TRUE);

-- Shared medicine catalogue; inventory remains pharmacy- and batch-specific.
INSERT INTO medicines (id, name, generic_name, brand_name, strength, dosage_form, route, manufacturer, prescription_required, description, is_active) VALUES
    (1, 'Paracetamol 500 mg tablets', 'Paracetamol', 'Reliefa', '500 mg', 'tablet', 'oral', 'Asterion Therapeutics', FALSE, 'Fictional analgesic sample product.', TRUE),
    (2, 'Amoxicillin 250 mg capsules', 'Amoxicillin', 'Moxifern', '250 mg', 'capsule', 'oral', 'BluePeak Laboratories', TRUE, 'Fictional antibiotic sample product.', TRUE),
    (3, 'Cetirizine 10 mg tablets', 'Cetirizine', 'Clearwind', '10 mg', 'tablet', 'oral', 'Asterion Therapeutics', FALSE, 'Fictional antihistamine sample product.', TRUE),
    (4, 'Metformin 500 mg tablets', 'Metformin hydrochloride', 'GlucoVale', '500 mg', 'tablet', 'oral', 'Cedarwell Pharma', TRUE, 'Fictional diabetes care sample product.', TRUE),
    (5, 'Omeprazole 20 mg capsules', 'Omeprazole', 'GastroEase', '20 mg', 'capsule', 'oral', 'BluePeak Laboratories', TRUE, 'Fictional acid-reduction sample product.', TRUE),
    (6, 'Oral rehydration salts sachet', 'Sodium chloride, potassium chloride, glucose', 'HydraDay', '21.8 g', 'powder sachet', 'oral', 'Cedarwell Pharma', FALSE, 'Fictional rehydration sample product.', TRUE),
    (7, 'Amlodipine 5 mg tablets', 'Amlodipine besylate', 'Pressura', '5 mg', 'tablet', 'oral', 'Northwind Generics', TRUE, 'Fictional blood pressure sample product.', TRUE),
    (8, 'Vitamin D3 1000 IU capsules', 'Cholecalciferol', 'Sunwell', '1000 IU', 'capsule', 'oral', 'Northwind Generics', FALSE, 'Fictional supplement sample product.', TRUE);

INSERT INTO medicine_identifiers (id, medicine_id, identifier_type, identifier_value, is_primary) VALUES
    (1, 1, 'barcode', '8907000000001', TRUE), (2, 1, 'internal_code', 'MED-PARA-500', FALSE),
    (3, 2, 'barcode', '8907000000002', TRUE), (4, 2, 'gtin', '08907000000002', FALSE),
    (5, 3, 'barcode', '8907000000003', TRUE), (6, 4, 'barcode', '8907000000004', TRUE),
    (7, 5, 'barcode', '8907000000005', TRUE), (8, 6, 'barcode', '8907000000006', TRUE),
    (9, 7, 'barcode', '8907000000007', TRUE), (10, 8, 'barcode', '8907000000008', TRUE);

-- Supplier records are scoped to their pharmacy as required by the schema.
INSERT INTO suppliers (id, pharmacy_id, name, contact_name, email, phone, address, is_active) VALUES
    (1, 1, 'Summit Medical Wholesale', 'Tara Shah', 'orders@summit.example.test', '+91-20-5551-1001', 'Warehouse 4, Pune', TRUE),
    (2, 1, 'Juniper Health Distribution', 'Dev Mehta', 'orders@juniper.example.test', '+91-20-5551-1002', 'Unit 12, Pune', TRUE),
    (3, 2, 'Lakeside Pharma Supply', 'Nila Joseph', 'orders@lakeside.example.test', '+91-80-5552-1001', 'Depot 6, Bengaluru', TRUE),
    (4, 2, 'Cobalt Care Distributors', 'Kiran Bhat', 'orders@cobalt.example.test', '+91-80-5552-1002', 'Block C, Bengaluru', TRUE),
    (5, 3, 'Orchard Medical Traders', 'Mira Suresh', 'orders@orchard.example.test', '+91-44-5553-1001', 'Market Road, Chennai', TRUE),
    (6, 3, 'Beaconline Health Supply', 'Hari Kumar', 'orders@beaconline.example.test', '+91-44-5553-1002', 'Harbor Estate, Chennai', TRUE);

-- Batches intentionally include expired, near-expiry, and longer-dated stock.
-- Medicine 1 at pharmacy 1 has multiple dated batches to illustrate FEFO selection.
INSERT INTO medicine_batches (id, pharmacy_id, medicine_id, supplier_id, batch_number, manufacture_date, expiry_date, purchase_price, selling_price, received_at) VALUES
    (1, 1, 1, 1, 'NS-PAR-2601', '2025-01-15', '2026-11-30', 12.00, 20.00, '2026-02-01 09:00:00'),
    (2, 1, 1, 2, 'NS-PAR-2602', '2025-06-10', '2027-06-30', 13.00, 22.00, '2026-08-15 10:30:00'),
    (3, 1, 2, 1, 'NS-AMX-2511', '2025-11-01', '2026-10-31', 48.00, 72.00, '2026-01-11 08:45:00'),
    (4, 1, 2, 2, 'NS-AMX-2608', '2026-08-01', '2027-08-31', 51.00, 78.00, '2026-09-02 11:00:00'),
    (5, 1, 3, 1, 'NS-CET-2603', '2026-03-01', '2027-03-31', 18.00, 30.00, '2026-04-04 09:20:00'),
    (6, 1, 4, 2, 'NS-MET-2605', '2026-05-01', '2027-05-31', 25.00, 39.00, '2026-06-03 09:15:00'),
    (7, 2, 1, 3, 'HV-PAR-2604', '2026-04-01', '2027-04-30', 12.50, 21.00, '2026-05-10 10:00:00'),
    (8, 2, 2, 4, 'HV-AMX-2602', '2026-02-01', '2027-02-28', 49.00, 75.00, '2026-03-07 08:30:00'),
    (9, 2, 5, 3, 'HV-OME-2601', '2026-01-01', '2026-12-15', 34.00, 55.00, '2026-02-12 10:40:00'),
    (10, 2, 6, 4, 'HV-ORS-2606', '2026-06-01', '2027-06-30', 7.00, 12.00, '2026-07-03 12:00:00'),
    (11, 2, 7, 3, 'HV-AML-2605', '2026-05-01', '2027-05-31', 28.00, 45.00, '2026-06-06 09:00:00'),
    (12, 3, 1, 5, 'MG-PAR-2607', '2026-07-01', '2027-07-31', 12.25, 20.50, '2026-08-08 09:30:00'),
    (13, 3, 3, 6, 'MG-CET-2601', '2026-01-01', '2026-12-10', 17.50, 29.00, '2026-02-05 08:40:00'),
    (14, 3, 4, 5, 'MG-MET-2606', '2026-06-01', '2027-06-30', 24.50, 38.00, '2026-07-12 10:10:00'),
    (15, 3, 5, 6, 'MG-OME-2603', '2026-03-01', '2027-03-31', 33.00, 54.00, '2026-04-02 11:15:00'),
    (16, 3, 8, 5, 'MG-VIT-2605', '2026-05-01', '2027-05-31', 19.00, 32.00, '2026-06-18 13:00:00');

-- On-hand quantities reflect already-completed sample sales below. Several rows
-- are at or below reorder level; expired stock is zeroed and retained for reporting.
INSERT INTO inventory (id, pharmacy_id, batch_id, quantity_on_hand, reorder_level) VALUES
    (1, 1, 1, 18, 10), (2, 1, 2, 42, 15), (3, 1, 3, 0, 8), (4, 1, 4, 6, 10),
    (5, 1, 5, 3, 12), (6, 1, 6, 28, 10),
    (7, 2, 7, 9, 12), (8, 2, 8, 21, 10), (9, 2, 9, 4, 8), (10, 2, 10, 0, 15), (11, 2, 11, 16, 10),
    (12, 3, 12, 35, 12), (13, 3, 13, 5, 10), (14, 3, 14, 8, 10), (15, 3, 15, 19, 8), (16, 3, 16, 2, 10);

-- Completed sales and line items provide relational reporting examples. The
-- earlier-expiring batch 1 is used before later-expiring batch 2 (FEFO example).
INSERT INTO sales (id, pharmacy_id, user_id, receipt_number, status, subtotal, discount_amount, tax_amount, total_amount, sold_at) VALUES
    (1, 1, 3, 'NS-20261110-001', 'completed', 140.00, 2.00, 7.50, 145.50, '2026-11-10 10:15:00'),
    (2, 1, 3, 'NS-20261112-002', 'completed', 156.00, 0.00, 7.80, 163.80, '2026-11-12 16:42:00'),
    (3, 2, 6, 'HV-20261113-001', 'completed', 160.00, 5.00, 8.00, 163.00, '2026-11-13 12:05:00'),
    (4, 3, 8, 'MG-20261115-001', 'completed', 111.00, 0.00, 5.80, 116.80, '2026-11-15 18:20:00'),
    (5, 2, 6, 'HV-20261116-002', 'voided', 55.00, 0.00, 0.00, 55.00, '2026-11-16 09:35:00');

INSERT INTO sale_items (id, pharmacy_id, sale_id, batch_id, quantity, unit_price, discount_amount, line_total) VALUES
    (1, 1, 1, 1, 4, 20.00, 0.00, 80.00), (2, 1, 1, 5, 2, 30.00, 2.00, 58.00),
    (3, 1, 2, 4, 2, 78.00, 0.00, 156.00),
    (4, 2, 3, 7, 5, 21.00, 5.00, 100.00), (5, 2, 3, 9, 1, 55.00, 0.00, 55.00),
    (6, 3, 4, 12, 4, 20.50, 0.00, 82.00), (7, 3, 4, 13, 1, 29.00, 0.00, 29.00),
    (8, 2, 5, 9, 1, 55.00, 0.00, 55.00);

-- Acknowledged and open rows support alert status and expiry reporting.
INSERT INTO expiry_alerts (id, pharmacy_id, batch_id, alert_type, status, triggered_at, acknowledged_by, acknowledged_at) VALUES
    (1, 1, 1, 'expiring_soon', 'open', '2026-11-01 07:00:00', NULL, NULL),
    (2, 1, 3, 'expired', 'acknowledged', '2026-11-01 07:00:00', 2, '2026-11-02 09:10:00'),
    (3, 2, 9, 'expiring_soon', 'open', '2026-10-15 07:00:00', NULL, NULL),
    (4, 3, 13, 'expiring_soon', 'open', '2026-10-10 07:00:00', NULL, NULL),
    (5, 1, 4, 'expiring_soon', 'open', '2026-11-01 07:00:00', NULL, NULL);

COMMIT;
