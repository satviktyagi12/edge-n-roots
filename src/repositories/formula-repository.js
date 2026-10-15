const pool = require('../db/pool');
const { saveRecord } = require('../services/save-record');

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
    'SELECT f.*, ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id) AS version_number FROM formulas f WHERE f.uuid = ? ORDER BY id',
    [uuid]
  );
  return rows;
}
async function insertRunLogs(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    run_uuid: r.runUuid,
    formula_uuid: r.formulaUuid,
    formula_name: r.formulaName,
    formula_version_id: r.formulaVersionId,
    input_json: JSON.stringify(r.input),
    result_json: r.result === undefined ? null : JSON.stringify(r.result),
    calculation_text: r.calculationText || null,
    status: r.status,
    error_message: r.error || null,
    duration_ms: r.durationMs || 0
  }));
  await saveRecord('formula_runs', values, { uuidColumn: 'run_uuid', appendRows: true });
}
module.exports = { pool, currentFormulas, latestFormula, history, insertRunLogs };