const { randomUUID } = require('node:crypto');
const pool = require('../db/pool');
const { AppError } = require('../utils/errors');

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new AppError(400, 'INVALID_IDENTIFIER', 'Invalid table or column identifier.');
  }
  return '`' + value + '`';
}

// Generic append-only save. Table/column names are validated and table columns are
// discovered from the selected database; every data value is passed as a bind parameter.
async function saveRecord(table, data, options = {}) {
  quoteIdentifier(table);
  const uuidColumn = options.uuidColumn || 'uuid';
  quoteIdentifier(uuidColumn);
  const records = Array.isArray(data) ? data : [data];
  if (!records.length) return [];
  const connection = options.connection || pool;
  const [metadata] = await connection.execute(
    'SELECT COLUMN_NAME, EXTRA, COLUMN_DEFAULT, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [table]
  );
  if (!metadata.length) throw new AppError(400, 'INVALID_TABLE', 'Table does not exist in the configured database.');
  const columns = metadata.filter(c => !String(c.EXTRA).includes('auto_increment')).map(c=>c.COLUMN_NAME);
  if (!columns.includes(uuidColumn)) throw new AppError(400, 'INVALID_UUID_COLUMN', 'The configured UUID column does not exist in this table.');
  if (!metadata.some(c => c.COLUMN_NAME === 'id' && String(c.EXTRA).includes('auto_increment'))) throw new AppError(400, 'INVALID_TABLE', 'Insert-only records require an auto-increment id column.');
  const prepared = [];
  for (const input of records) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AppError(400, 'INVALID_RECORD', 'Each record must be an object.');
    }
    const uuid = input[uuidColumn] || randomUUID();
    let previous = null;
    if (input[uuidColumn] && !options.appendRows) {
      const [rows] = await connection.execute(
        `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(uuidColumn)} = ? ORDER BY id DESC LIMIT 1`,
        [uuid]
      );
      previous = rows[0] || null;
      if (!previous) throw new AppError(404, 'RECORD_NOT_FOUND', 'Cannot change a record that does not exist.');
    }
    const merged = { ...(previous || {}), ...input, [uuidColumn]: uuid };
    const now = new Date();
    if (columns.includes('first_created_at')) merged.first_created_at = previous?.first_created_at || input.first_created_at || now;
    if (columns.includes('created_at') && !previous) merged.created_at = input.created_at || now;
    if (columns.includes('inserted_at')) merged.inserted_at = now;
    // Never carry the prior auto-increment id into the new version.
    delete merged.id;
    prepared.push({ uuid, merged, previous });
  }
  const insertColumns = columns.filter(c => prepared.some(p => Object.prototype.hasOwnProperty.call(p.merged,c)) || !['first_created_at','created_at','inserted_at'].includes(c));
  const values = prepared.map(({merged})=>insertColumns.map(column=>{
    if (Object.prototype.hasOwnProperty.call(merged,column)) return merged[column];
    const meta=metadata.find(c=>c.COLUMN_NAME===column);
    if (meta?.COLUMN_DEFAULT !== null && meta?.COLUMN_DEFAULT !== undefined) return meta.COLUMN_DEFAULT;
    if (meta?.IS_NULLABLE === 'YES') return null;
    throw new AppError(400,'MISSING_FIELD',`Required field "${column}" is missing.`);
  }));
  const placeholders = values.map(row=>'('+row.map(()=>'?').join(', ')+')').join(', ');
  const flatValues=values.flat();
  const [result]=await connection.execute(
    `INSERT INTO ${quoteIdentifier(table)} (${insertColumns.map(quoteIdentifier).join(', ')}) VALUES ${placeholders}`,
    flatValues
  );
  return prepared.map(({uuid,merged},index)=>({id:result.insertId+index,...merged,[uuidColumn]:uuid}));
}
module.exports={saveRecord};