-- MediTrack additive workflow extension (MySQL 8.0.16+).
-- Review and apply once, with the backend stopped and a verified backup.
-- This migration only creates new tables; it does not alter or delete existing data.

CREATE TABLE IF NOT EXISTS storage_policies (
    pharmacy_id BIGINT UNSIGNED NOT NULL,
    min_temperature_c DECIMAL(5,2) NULL,
    max_temperature_c DECIMAL(5,2) NULL,
    min_humidity_percent DECIMAL(5,2) NULL,
    max_humidity_percent DECIMAL(5,2) NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (pharmacy_id),
    KEY idx_storage_policies_updated_by (updated_by),
    CONSTRAINT fk_storage_policies_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_storage_policies_user FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_storage_policy_temperature_pair CHECK ((min_temperature_c IS NULL) = (max_temperature_c IS NULL)),
    CONSTRAINT chk_storage_policy_temperature_order CHECK (min_temperature_c IS NULL OR min_temperature_c <= max_temperature_c),
    CONSTRAINT chk_storage_policy_humidity_pair CHECK ((min_humidity_percent IS NULL) = (max_humidity_percent IS NULL)),
    CONSTRAINT chk_storage_policy_humidity_order CHECK (min_humidity_percent IS NULL OR min_humidity_percent <= max_humidity_percent),
    CONSTRAINT chk_storage_policy_humidity_bounds CHECK (
        (min_humidity_percent IS NULL OR min_humidity_percent >= 0) AND
        (max_humidity_percent IS NULL OR max_humidity_percent <= 100)
    ),
    CONSTRAINT chk_storage_policy_has_range CHECK (min_temperature_c IS NOT NULL OR min_humidity_percent IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS storage_condition_details (
    storage_log_id BIGINT UNSIGNED NOT NULL,
    condition_status ENUM('normal', 'damaged_packaging', 'contamination', 'power_outage', 'other') NOT NULL DEFAULT 'normal',
    condition_notes VARCHAR(500) NULL,
    PRIMARY KEY (storage_log_id),
    KEY idx_storage_condition_status (condition_status, storage_log_id),
    CONSTRAINT fk_storage_condition_log FOREIGN KEY (storage_log_id) REFERENCES storage_logs (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS forecast_explanations (
    forecast_id BIGINT UNSIGNED NOT NULL,
    lookback_days SMALLINT UNSIGNED NOT NULL,
    observed_sales_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    data_quality ENUM('insufficient', 'limited', 'adequate') NOT NULL,
    explanation VARCHAR(600) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (forecast_id),
    CONSTRAINT fk_forecast_explanation_result FOREIGN KEY (forecast_id) REFERENCES forecast_results (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_forecast_explanation_lookback CHECK (lookback_days > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
