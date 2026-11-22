-- MediTrack database schema (MySQL 8)
-- Creates structure only; no sample or reference data is inserted here.

CREATE TABLE IF NOT EXISTS roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pharmacies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    license_number VARCHAR(100) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(30) NULL,
    address_line1 VARCHAR(200) NULL,
    address_line2 VARCHAR(200) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(100) NULL,
    postal_code VARCHAR(20) NULL,
    country_code CHAR(2) NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pharmacies_license_number (license_number),
    KEY idx_pharmacies_name (name),
    KEY idx_pharmacies_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_pharmacy_role (pharmacy_id, role_id),
    KEY idx_users_is_active (is_active),
    CONSTRAINT fk_users_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medicines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    generic_name VARCHAR(200) NULL,
    brand_name VARCHAR(150) NULL,
    strength VARCHAR(100) NULL,
    dosage_form VARCHAR(80) NULL,
    route VARCHAR(80) NULL,
    manufacturer VARCHAR(200) NULL,
    prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_medicines_name (name),
    KEY idx_medicines_generic_name (generic_name),
    KEY idx_medicines_brand_name (brand_name),
    KEY idx_medicines_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medicine_identifiers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    medicine_id BIGINT UNSIGNED NOT NULL,
    identifier_type ENUM('barcode', 'gtin', 'national_code', 'internal_code', 'other') NOT NULL DEFAULT 'barcode',
    identifier_value VARCHAR(100) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_medicine_identifiers_type_value (identifier_type, identifier_value),
    KEY idx_medicine_identifiers_medicine (medicine_id),
    CONSTRAINT fk_medicine_identifiers_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS suppliers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(180) NOT NULL,
    contact_name VARCHAR(150) NULL,
    email VARCHAR(254) NULL,
    phone VARCHAR(30) NULL,
    address TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_suppliers_pharmacy_name (pharmacy_id, name),
    UNIQUE KEY uq_suppliers_id_pharmacy (id, pharmacy_id),
    KEY idx_suppliers_pharmacy_active (pharmacy_id, is_active),
    CONSTRAINT fk_suppliers_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medicine_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    medicine_id BIGINT UNSIGNED NOT NULL,
    supplier_id BIGINT UNSIGNED NULL,
    batch_number VARCHAR(100) NOT NULL,
    manufacture_date DATE NULL,
    expiry_date DATE NOT NULL,
    purchase_price DECIMAL(12,2) NOT NULL,
    selling_price DECIMAL(12,2) NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_batches_pharmacy_medicine_number (pharmacy_id, medicine_id, batch_number),
    UNIQUE KEY uq_batches_id_pharmacy (id, pharmacy_id),
    KEY idx_batches_pharmacy_expiry (pharmacy_id, expiry_date),
    KEY idx_batches_medicine (medicine_id),
    KEY idx_batches_supplier (supplier_id, pharmacy_id),
    CONSTRAINT fk_batches_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_batches_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_batches_supplier_pharmacy FOREIGN KEY (supplier_id, pharmacy_id) REFERENCES suppliers (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_batches_prices CHECK (purchase_price >= 0 AND selling_price >= 0),
    CONSTRAINT chk_batches_dates CHECK (manufacture_date IS NULL OR manufacture_date <= expiry_date)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    quantity_on_hand INT UNSIGNED NOT NULL DEFAULT 0,
    reorder_level INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_pharmacy_batch (pharmacy_id, batch_id),
    KEY idx_inventory_pharmacy_quantity (pharmacy_id, quantity_on_hand),
    CONSTRAINT fk_inventory_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sales (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    receipt_number VARCHAR(80) NOT NULL,
    status ENUM('completed', 'voided', 'refunded') NOT NULL DEFAULT 'completed',
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sold_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sales_pharmacy_receipt (pharmacy_id, receipt_number),
    UNIQUE KEY uq_sales_id_pharmacy (id, pharmacy_id),
    KEY idx_sales_pharmacy_sold_at (pharmacy_id, sold_at),
    KEY idx_sales_user (user_id),
    CONSTRAINT fk_sales_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sales_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_sales_amounts CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sale_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    sale_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_sale_items_sale (sale_id, pharmacy_id),
    KEY idx_sale_items_batch (batch_id, pharmacy_id),
    CONSTRAINT fk_sale_items_sale_pharmacy FOREIGN KEY (sale_id, pharmacy_id) REFERENCES sales (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sale_items_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_sale_items_values CHECK (quantity > 0 AND unit_price >= 0 AND discount_amount >= 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scan_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    medicine_id BIGINT UNSIGNED NULL,
    identifier_id BIGINT UNSIGNED NULL,
    scanned_value VARCHAR(150) NOT NULL,
    scan_context ENUM('lookup', 'receiving', 'sale', 'transfer', 'other') NOT NULL DEFAULT 'lookup',
    was_matched BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_scan_history_pharmacy_time (pharmacy_id, scanned_at),
    KEY idx_scan_history_user (user_id),
    KEY idx_scan_history_medicine (medicine_id),
    KEY idx_scan_history_identifier (identifier_id),
    CONSTRAINT fk_scan_history_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_scan_history_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_scan_history_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_scan_history_identifier FOREIGN KEY (identifier_id) REFERENCES medicine_identifiers (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS expiry_alerts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    alert_type ENUM('expiring_soon', 'expired') NOT NULL,
    status ENUM('open', 'acknowledged', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
    triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by BIGINT UNSIGNED NULL,
    acknowledged_at DATETIME NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_expiry_alert_batch_type_status (pharmacy_id, batch_id, alert_type, status),
    KEY idx_expiry_alerts_pharmacy_status_time (pharmacy_id, status, triggered_at),
    KEY idx_expiry_alerts_batch (batch_id, pharmacy_id),
    CONSTRAINT fk_expiry_alert_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_expiry_alert_ack_user FOREIGN KEY (acknowledged_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stock_transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_pharmacy_id BIGINT UNSIGNED NOT NULL,
    destination_pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    requested_by BIGINT UNSIGNED NOT NULL,
    approved_by BIGINT UNSIGNED NULL,
    received_by BIGINT UNSIGNED NULL,
    quantity INT UNSIGNED NOT NULL,
    status ENUM('requested', 'approved', 'in_transit', 'received', 'rejected', 'cancelled') NOT NULL DEFAULT 'requested',
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    shipped_at DATETIME NULL,
    received_at DATETIME NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_transfers_source_status (source_pharmacy_id, status, requested_at),
    KEY idx_transfers_destination_status (destination_pharmacy_id, status, requested_at),
    KEY idx_transfers_batch_source (batch_id, source_pharmacy_id),
    KEY idx_transfers_requested_by (requested_by),
    CONSTRAINT fk_transfers_source FOREIGN KEY (source_pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfers_destination FOREIGN KEY (destination_pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfers_batch_source FOREIGN KEY (batch_id, source_pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfers_requested_by FOREIGN KEY (requested_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfers_approved_by FOREIGN KEY (approved_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_transfers_received_by FOREIGN KEY (received_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_transfers_quantity CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stock_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    transfer_id BIGINT UNSIGNED NULL,
    movement_type ENUM('opening', 'received', 'sale', 'adjustment', 'transfer_out', 'transfer_in', 'return', 'write_off') NOT NULL,
    quantity_delta INT NOT NULL,
    quantity_after INT UNSIGNED NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id BIGINT UNSIGNED NULL,
    reason VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_stock_history_pharmacy_time (pharmacy_id, created_at),
    KEY idx_stock_history_batch_time (batch_id, pharmacy_id, created_at),
    KEY idx_stock_history_transfer (transfer_id),
    KEY idx_stock_history_user (user_id),
    CONSTRAINT fk_stock_history_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_stock_history_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_stock_history_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_stock_history_transfer FOREIGN KEY (transfer_id) REFERENCES stock_transfers (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_stock_history_delta CHECK (quantity_delta <> 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS storage_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NULL,
    recorded_by BIGINT UNSIGNED NULL,
    temperature_c DECIMAL(5,2) NULL,
    humidity_percent DECIMAL(5,2) NULL,
    is_within_range BOOLEAN NULL,
    notes VARCHAR(500) NULL,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_storage_logs_pharmacy_time (pharmacy_id, recorded_at),
    KEY idx_storage_logs_batch (batch_id, pharmacy_id),
    KEY idx_storage_logs_recorded_by (recorded_by),
    CONSTRAINT fk_storage_logs_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_storage_logs_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_storage_logs_user FOREIGN KEY (recorded_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_storage_logs_humidity CHECK (humidity_percent IS NULL OR (humidity_percent >= 0 AND humidity_percent <= 100))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recall_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    medicine_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NULL,
    recall_number VARCHAR(100) NOT NULL,
    source VARCHAR(150) NULL,
    reason TEXT NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'high',
    status ENUM('active', 'investigating', 'contained', 'closed') NOT NULL DEFAULT 'active',
    issued_at DATETIME NOT NULL,
    resolved_at DATETIME NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_recall_pharmacy_number (pharmacy_id, recall_number),
    KEY idx_recalls_pharmacy_status (pharmacy_id, status, issued_at),
    KEY idx_recalls_medicine (medicine_id),
    KEY idx_recalls_batch_pharmacy (batch_id, pharmacy_id),
    CONSTRAINT fk_recalls_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_recalls_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_recalls_batch_pharmacy FOREIGN KEY (batch_id, pharmacy_id) REFERENCES medicine_batches (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_recalls_created_by FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS forecast_results (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    medicine_id BIGINT UNSIGNED NOT NULL,
    forecast_date DATE NOT NULL,
    horizon_days SMALLINT UNSIGNED NOT NULL,
    predicted_demand DECIMAL(12,2) NOT NULL,
    recommended_reorder_quantity DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    model_version VARCHAR(80) NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_forecast_pharmacy_medicine_date_horizon (pharmacy_id, medicine_id, forecast_date, horizon_days),
    KEY idx_forecast_pharmacy_date (pharmacy_id, forecast_date),
    KEY idx_forecast_medicine (medicine_id),
    CONSTRAINT fk_forecasts_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_forecasts_medicine FOREIGN KEY (medicine_id) REFERENCES medicines (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_forecasts_quantities CHECK (predicted_demand >= 0 AND recommended_reorder_quantity >= 0),
    CONSTRAINT chk_forecasts_horizon CHECK (horizon_days > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    ip_address VARBINARY(16) NULL,
    user_agent VARCHAR(500) NULL,
    details JSON NULL,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_logs_pharmacy_time (pharmacy_id, occurred_at),
    KEY idx_audit_logs_user_time (user_id, occurred_at),
    KEY idx_audit_logs_entity (entity_type, entity_id),
    KEY idx_audit_logs_action_time (action, occurred_at),
    CONSTRAINT fk_audit_logs_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
