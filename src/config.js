require('dotenv').config();

function integer(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: expected integer between ${min} and ${max}`);
  }
  return value;
}

module.exports = Object.freeze({
  port: integer('PORT', 3000, 1, 65535),
  timeoutMs: integer('FORMULA_TIMEOUT_MS', 2500, 50, 10000),
  previewConcurrency: integer('PREVIEW_CONCURRENCY', 8, 1, 64),
  bulkConcurrency: integer('BULK_CONCURRENCY', 4, 1, 32),
  maxBulkRecords: integer('MAX_BULK_RECORDS', 500, 1, 500),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: integer('DB_PORT', 3306, 1, 65535),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'edgenroots_formula_engine',
    connectionLimit: 20,
    timezone: 'Z'
  }
});