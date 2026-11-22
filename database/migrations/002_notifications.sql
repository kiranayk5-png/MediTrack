-- Additive MediTrack notification center migration (MySQL 8.0.16+).
-- Apply only after review and approval. This does not change existing records.

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    notification_type ENUM('medicine_expiry', 'low_stock', 'stock_transfer', 'storage_violation') NOT NULL,
    event_key VARCHAR(190) NOT NULL,
    title VARCHAR(180) NOT NULL,
    message VARCHAR(500) NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    resolved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_notifications_event_key (event_key),
    KEY idx_notifications_feed (pharmacy_id, resolved_at, created_at, id),
    KEY idx_notifications_unread (pharmacy_id, is_read, resolved_at, id),
    KEY idx_notifications_type_severity (notification_type, severity, created_at),
    CONSTRAINT fk_notifications_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_notifications_read_timestamp CHECK ((is_read = FALSE AND read_at IS NULL) OR (is_read = TRUE AND read_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
