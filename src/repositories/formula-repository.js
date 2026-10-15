const pool = require('../db/pool');

async function currentFormulas(connection = pool) {
  const [rows] = await connection.query('SELECT * FROM current_formulas ORDER BY id');
  return rows;
}
async function latestFormula(uuid, connection = pool) {
  const [rows] = await connection.execute('SELECT * FROM formulas WHERE uuid = ? ORDER BY id DESC LIMIT 1', [uuid]);
  return rows[0] || null;
}
async function history(uuid) {
  const [rows] = await pool.execute(
    'SELECT f.*, ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id) AS version_number FROM formulas f WHERE uuid = ? ORDER BY id',
    [uuid]
  );
  return rows;
}
async function insertRunLogs(rows) {
  if (!rows.length) return;
  const values = rows.map(r => [
    r.runUuid, r.formulaUuid, r.formulaName, r.formulaVersionId,
    JSON.stringify(r.input), r.result === undefined ? null : JSON.stringify(r.result),
    r.calculationText || null, r.status, r.error || null, r.durationMs || 0
  ]);
  await pool.query(
    'INSERT INTO formula_runs (run_uuid, formula_uuid, formula_name, formula_version_id, input_json, result_json, calculation_text, status, error_message, duration_ms) VALUES ?',
    [values]
  );
}
module.exports = { pool, currentFormulas, latestFormula, history, insertRunLogs };