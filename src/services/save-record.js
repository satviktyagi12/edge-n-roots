const { randomUUID } = require('node:crypto');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');

// Generic append-only writer. Table and column identifiers are allow-listed; all values
// are parameterized. The caller must use a transaction when coordinating version checks.
const ALLOWED_TABLES = new Set(['formulas']);
const COLUMNS = {
  formulas: ['uuid','name','formula','status','created_by','first_created_at','inserted_at','base_version_id']
};
function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new AppError(400, 'INVALID_TABLE', 'Invalid table or column identifier.');
  return '`' + value + '`';
}
async function saveRecord(table, data, options = {}) {
  if (!ALLOWED_TABLES.has(table)) throw new AppError(400, 'INVALID_TABLE', 'Table is not allowed for insert-only writes.');
  const uuidColumn = options.uuidColumn || 'uuid';
  if (uuidColumn !== 'uuid') throw new AppError(400, 'INVALID_UUID_COLUMN', 'Unsupported UUID column.');
  const records = Array.isArray(data) ? data : [data];
  if (!records.length) return [];
  const connection = options.connection || pool;
  const saved = [];
  for (const input of records) {
    const now = new Date();
    let previous = null;
    const uuid = input.uuid || randomUUID();
    if (input.uuid) {
      const [rows] = await connection.execute(
        `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(uuidColumn)} = ? ORDER BY id DESC LIMIT 1`, [uuid]
      );
      previous = rows[0] || null;
      if (!previous) throw new AppError(404, 'RECORD_NOT_FOUND', 'Cannot change a record that does not exist.');
    }
    const merged = {
      uuid,
      name: input.name ?? previous?.name,
      formula: input.formula ?? previous?.formula,
      status: input.status ?? previous?.status ?? 'ACTIVE',
      created_by: previous?.created_by ?? input.created_by ?? input.createdBy ?? 'api',
      first_created_at: previous?.first_created_at ?? now,
      inserted_at: now,
      base_version_id: input.base_version_id ?? previous?.id ?? null
    };
    const columns = COLUMNS[table];
    const vals = columns.map(c => merged[c]);
    const [result] = await connection.execute(
      `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, vals
    );
    saved.push({ id: result.insertId, ...merged });
  }
  return saved;
}
module.exports = { saveRecord };