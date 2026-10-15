CREATE DATABASE IF NOT EXISTS edgenroots_formula_engine
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE edgenroots_formula_engine;

CREATE TABLE IF NOT EXISTS formulas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  formula TEXT NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by VARCHAR(128) NOT NULL,
  first_created_at DATETIME(3) NOT NULL,
  inserted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  base_version_id BIGINT UNSIGNED NULL,
  INDEX idx_formula_uuid_id (uuid, id),
  INDEX idx_formula_status_name_id (status, name, id),
  INDEX idx_formula_inserted (inserted_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS formula_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_uuid CHAR(36) NOT NULL,
  formula_uuid CHAR(36) NOT NULL,
  formula_name VARCHAR(64) NOT NULL,
  formula_version_id BIGINT UNSIGNED NULL,
  input_json JSON NOT NULL,
  result_json JSON NULL,
  calculation_text MEDIUMTEXT NULL,
  status ENUM('SUCCESS','FAILED','SKIPPED') NOT NULL,
  error_message TEXT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_runs_uuid (run_uuid),
  INDEX idx_runs_formula_created (formula_uuid, created_at),
  INDEX idx_runs_status_created (status, created_at),
  INDEX idx_runs_created (created_at)
) ENGINE=InnoDB;