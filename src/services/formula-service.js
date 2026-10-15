const { randomUUID } = require('node:crypto');
const pool = require('../db/pool');
const { saveRecord } = require('./save-record');
const { evaluateFormula } = require('./formula-evaluator');
const { currentFormulas, latestFormula, history } = require('../repositories/formula-repository');
const { executionLevels, graphFor } = require('./dependency-graph');
const { AppError } = require('../utils/errors');

async function validateFormula(name, formula, replacingUuid = null) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new AppError(400, 'INVALID_NAME', 'Formula name must be a valid identifier.');
  }
  const all = await currentFormulas();
  const conflict = all.find(f => f.name === name && f.uuid !== replacingUuid);
  if (conflict) throw new AppError(400, 'DUPLICATE_NAME', 'Formula name must be unique among active formulas.');
  const sampleValues = Object.fromEntries(all.map(item => [item.name, item.name === 'commission' ? 200 : item.name === 'tax' ? 36 : 1]));
  sampleValues.commission = 200; sampleValues.tax = 36;
  const sample = await evaluateFormula(formula, { amount: 2000, rate: 10, commission: 200, tax: 36 }, sampleValues);
  if (sample.status !== 'SUCCESS') {
    throw new AppError(400, 'INVALID_FORMULA', 'Formula failed validation against sample data.', { error: sample.error });
  }
  const proposed = all.filter(f => f.uuid !== replacingUuid).concat([{ uuid: replacingUuid || randomUUID(), name, formula, status: 'ACTIVE' }]);
  executionLevels(proposed);
  return proposed;
}

async function createOrChange(input) {
  if (!input.uuid) {
    const conn = await pool.getConnection();
    const nameLock = `formula-name:${input.name}`;
    let locked = false;
    try {
      const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 10) AS acquired', [nameLock]);
      locked = lockRows[0]?.acquired === 1;
      if (!locked) throw new AppError(409, 'CONCURRENT_MODIFICATION', 'Could not acquire formula-name lock; retry the request.');
      await validateFormula(input.name, input.formula);
      return (await saveRecord('formulas', {
        name: input.name, formula: input.formula, status: 'ACTIVE',
        created_by: input.createdBy
      }, { connection: conn }))[0];
    } finally {
      if (locked) await conn.execute('SELECT RELEASE_LOCK(?)', [nameLock]).catch(() => {});
      conn.release();
    }
  }
  // MySQL advisory lock serializes same-formula writes across app instances.
  const lockName = `formula:${input.uuid}`;
  const conn = await pool.getConnection();
  let locked = false;
  let nameLocked = false;
  let nameLock = null;
  try {
    const [lockRows] = await conn.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    locked = lockRows[0]?.acquired === 1;
    if (!locked) throw new AppError(409, 'CONCURRENT_MODIFICATION', 'Could not acquire formula version lock; retry the request.');
    const current = await latestFormula(input.uuid, conn);
    if (!current) throw new AppError(404, 'FORMULA_NOT_FOUND', 'Formula not found.');
    if (!input.expectedVersionId || Number(input.expectedVersionId) !== Number(current.id)) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Formula has changed since the version you last saw.', { currentVersion: current });
    }
    const merged = { ...current, name: input.name ?? current.name, formula: input.formula ?? current.formula };
    nameLock = `formula-name:${merged.name}`;
    const [nameLockRows] = await conn.execute('SELECT GET_LOCK(?, 10) AS acquired', [nameLock]);
    nameLocked = nameLockRows[0]?.acquired === 1;
    if (!nameLocked) throw new AppError(409, 'CONCURRENT_MODIFICATION', 'Could not acquire formula-name lock; retry the request.');
    if (merged.name !== current.name) {
      const active = await currentFormulas(conn);
      const dependencies = graphFor(active).deps;
      const dependents = active.filter(f => f.uuid !== current.uuid && (dependencies.get(f.name) || []).includes(current.name));
      if (dependents.length && !input.force) {
        throw new AppError(400, 'DEPENDENTS_EXIST', 'Cannot rename a formula used by active formulas unless force is true.', { dependents: dependents.map(f => f.name) });
      }
    }
    await validateFormula(merged.name, merged.formula, input.uuid);
    const saved = await saveRecord('formulas', {
      uuid: current.uuid, name: merged.name, formula: merged.formula, status: 'ACTIVE',
      created_by: current.created_by, first_created_at: current.first_created_at, base_version_id: current.id
    }, { connection: conn });
    return saved[0];
  } finally {
    if (nameLocked && nameLock) await conn.execute('SELECT RELEASE_LOCK(?)', [nameLock]).catch(() => {});
    if (locked) await conn.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    conn.release();
  }
}

async function deactivate(uuid, expectedVersionId, force = false) {
  const conn = await pool.getConnection(); const lock = `formula:${uuid}`; let locked = false;
  try {
    const [l] = await conn.execute('SELECT GET_LOCK(?, 10) AS acquired', [lock]); locked = l[0]?.acquired === 1;
    if (!locked) throw new AppError(409, 'CONCURRENT_MODIFICATION', 'Could not acquire formula version lock.');
    const current = await latestFormula(uuid, conn);
    if (!current) throw new AppError(404, 'FORMULA_NOT_FOUND', 'Formula not found.');
    if (Number(expectedVersionId) !== Number(current.id)) throw new AppError(409, 'VERSION_CONFLICT', 'Formula version is stale.', { currentVersion: current });
    const active = await currentFormulas(conn);
    const dependents = active.filter(f => f.uuid !== uuid && (graphFor(active).deps.get(f.name) || []).includes(current.name));
    if (dependents.length && !force) throw new AppError(400, 'DEPENDENTS_EXIST', 'Cannot deactivate a formula used by active formulas.', { dependents: dependents.map(f => f.name) });
    const saved = await saveRecord('formulas', {
      uuid: current.uuid, name: current.name, formula: current.formula, status: 'INACTIVE',
      created_by: current.created_by, first_created_at: current.first_created_at, base_version_id: current.id
    }, { connection: conn });
    return saved[0];
  } finally { if (locked) await conn.execute('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>{}); conn.release(); }
}

async function rollback(uuid, targetVersionId, expectedVersionId) {
  const conn = await pool.getConnection(); const lock = `formula:${uuid}`; let locked = false;
  try {
    const [l] = await conn.execute('SELECT GET_LOCK(?, 10) AS acquired',[lock]); locked = l[0]?.acquired === 1;
    if (!locked) throw new AppError(409,'CONCURRENT_MODIFICATION','Could not acquire formula version lock.');
    const current = await latestFormula(uuid,conn);
    if (!current) throw new AppError(404,'FORMULA_NOT_FOUND','Formula not found.');
    if (Number(expectedVersionId) !== Number(current.id)) throw new AppError(409,'VERSION_CONFLICT','Formula version is stale.',{currentVersion:current});
    const [targets] = await conn.execute('SELECT * FROM formulas WHERE uuid = ? AND id = ?',[uuid,targetVersionId]);
    if (!targets[0]) throw new AppError(404,'VERSION_NOT_FOUND','Target version does not exist for this formula.');
    const target = targets[0];
    const all = (await currentFormulas(conn)).filter(f=>f.uuid!==uuid).concat([{...target,status:'ACTIVE'}]);
    await validateFormula(target.name,target.formula,uuid);
    executionLevels(all);
    const saved = await saveRecord('formulas', {
      uuid, name: target.name, formula: target.formula, status: 'ACTIVE',
      created_by: current.created_by, first_created_at: current.first_created_at, base_version_id: current.id
    }, { connection: conn });
    return { ...saved[0], rolledBackFromVersionId: target.id };
  } finally { if (locked) await conn.execute('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>{}); conn.release(); }
}

async function list() { return currentFormulas(); }
async function getHistory(uuid) { return history(uuid); }
async function impact(uuid) {
  const active = await currentFormulas();
  const byUuid = await latestFormula(uuid);
  if (!byUuid) throw new AppError(404,'FORMULA_NOT_FOUND','Formula not found.');
  const { deps } = graphFor(active); const impacted = new Set([byUuid.name]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, dependencies] of deps) {
      if (!impacted.has(name) && dependencies.some(dep=>impacted.has(dep))) { impacted.add(name); changed = true; }
    }
  }
  impacted.delete(byUuid.name);
  return active.filter(f=>impacted.has(f.name));
}
module.exports = { createOrChange, deactivate, rollback, list, getHistory, impact };