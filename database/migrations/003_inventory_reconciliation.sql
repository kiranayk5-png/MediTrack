-- Inventory reconciliation workflow (MySQL 8.0.16+).
-- Additive only. Review, back up, and apply manually; the application never runs this file.

CREATE TABLE IF NOT EXISTS inventory_reconciliation_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    status ENUM('draft', 'submitted', 'approved', 'rejected', 'stale') NOT NULL DEFAULT 'draft',
    created_by BIGINT UNSIGNED NOT NULL,
    submitted_at TIMESTAMP NULL,
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at TIMESTAMP NULL,
    review_note VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reconciliation_id_pharmacy (id, pharmacy_id),
    KEY idx_reconciliation_pharmacy_status_time (pharmacy_id, status, created_at),
    KEY idx_reconciliation_created_by (created_by),
    KEY idx_reconciliation_reviewed_by (reviewed_by),
    CONSTRAINT fk_reconciliation_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reconciliation_creator FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reconciliation_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory_reconciliation_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id BIGINT UNSIGNED NOT NULL,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    batch_id BIGINT UNSIGNED NOT NULL,
    system_quantity INT UNSIGNED NOT NULL,
    physical_quantity INT UNSIGNED NULL,
    discrepancy BIGINT GENERATED ALWAYS AS (
        CAST(physical_quantity AS SIGNED) - CAST(system_quantity AS SIGNED)
    ) STORED,
    reason_code ENUM('missing_stock', 'damaged_stock', 'expired_stock', 'excess_stock', 'counting_error', 'other') NULL,
    reason_explanation VARCHAR(220) NULL,
    system_updated_at TIMESTAMP NOT NULL,
    system_history_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reconciliation_session_batch (session_id, batch_id),
    KEY idx_reconciliation_item_pharmacy_batch (pharmacy_id, batch_id),
    KEY idx_reconciliation_item_session_pharmacy (session_id, pharmacy_id),
    CONSTRAINT fk_reconciliation_item_session FOREIGN KEY (session_id, pharmacy_id)
        REFERENCES inventory_reconciliation_sessions (id, pharmacy_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_reconciliation_item_inventory FOREIGN KEY (pharmacy_id, batch_id)
        REFERENCES inventory (pharmacy_id, batch_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_reconciliation_physical_quantity CHECK (physical_quantity IS NULL OR physical_quantity <= 4294967295),
    CONSTRAINT chk_reconciliation_other_explanation CHECK (reason_code <> 'other' OR reason_explanation IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
