const { randomUUID } = require('node:crypto');
const pLimit = require('p-limit');
const config = require('../config');
const { currentFormulas, insertRunLogs } = require('../repositories/formula-repository');
const { executionLevels, assertKnownInputs } = require('./dependency-graph');
const { evaluateFormula } = require('./formula-evaluator');
const { AppError } = require('../utils/errors');

async function formulasAt(asOf) {
  if (!asOf) return currentFormulas();
  const pool = require('../db/pool');
  const [rows] = await pool.execute(
    `SELECT f.* FROM formulas f
     JOIN (SELECT uuid, MAX(id) AS latest_id FROM formulas WHERE inserted_at <= ? GROUP BY uuid) v
       ON v.latest_id = f.id WHERE f.status = 'ACTIVE' ORDER BY f.id`, [new Date(asOf)]
  );
  return rows;
}

async function previewRecord(record, formulaUuids, asOf, options = {}) {
  const started = Date.now(); const runUuid = options.runUuid || randomUUID();
  let formulas = await formulasAt(asOf);
  if (formulaUuids?.length) {
    const selected = new Set(formulaUuids);
    formulas = formulas.filter(f => selected.has(f.uuid));
    // Include transitive prerequisites for requested formulas.
    const all = await formulasAt(asOf);
    const byName = new Map(all.map(f=>[f.name,f]));
    const needed = new Set(formulas.map(f=>f.name));
    let progress = true;
    while (progress) {
      progress = false;
      for (const f of all) {
        if (!needed.has(f.name)) continue;
        const names = f.formula.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)||[];
        for (const n of names) if (byName.has(n)&&!needed.has(n)) {needed.add(n);progress=true;}
      }
    }
    formulas = all.filter(f=>needed.has(f.name));
  }
  assertKnownInputs(formulas, record);
  const levels = executionLevels(formulas);
  const values = {}; const results = []; const logs = [];
  const levelLimit = pLimit(config.previewConcurrency);
  for (const level of levels) {
    const outcomes = await Promise.all(level.map(f => levelLimit(async () => {
      const failedDependency = results.find(r => r.status !== 'SUCCESS' && (f.formula.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)||[]).includes(r.name));
      if (failedDependency) return { formula:f, status:'SKIPPED', error:`Dependency "${failedDependency.name}" did not succeed`, durationMs:0 };
      const t = Date.now();
      const evaluated = await evaluateFormula(f.formula, record, values);
      return { formula:f, ...evaluated, durationMs:Date.now()-t };
    })));
    for (const outcome of outcomes) {
      const f = outcome.formula;
      if (outcome.status === 'SUCCESS') values[f.name] = outcome.result;
      const result = {
        uuid:f.uuid,name:f.name,versionId:f.id,status:outcome.status,
        result:outcome.result,error:outcome.error||null,
        calculationSteps:{
          inputs:outcome.inputs || record,
          formula:f.formula,
          substituted:outcome.calculationText || f.formula,
          result:outcome.result
        },durationMs:outcome.durationMs
      };
      results.push(result);
      logs.push({
        runUuid,formulaUuid:f.uuid,formulaName:f.name,formulaVersionId:f.id,
        input:record,result:outcome.result,calculationText:outcome.calculationText||f.formula,
        status:outcome.status,error:outcome.error,durationMs:outcome.durationMs
      });
    }
  }
  if (!options.deferLogs) await insertRunLogs(logs);
  const elapsedMs = Date.now()-started;
  return {
    runUuid, results, record:{...record,...values},
    metrics:{totalTimeMs:elapsedMs,averageTimePerRecordMs:elapsedMs,failures:results.filter(r=>r.status==='FAILED').length},
    ...(options.deferLogs ? { _logs: logs } : {})
  };
}

async function previewBulk(records, formulaUuids, asOf) {
  if (!Array.isArray(records) || records.length > config.maxBulkRecords) {
    throw new AppError(400,'BULK_LIMIT',`records must contain at most ${config.maxBulkRecords} records.`);
  }
  const limit = pLimit(config.bulkConcurrency); const started = Date.now();
  const runUuid = randomUUID();
  const results = await Promise.all(records.map(record=>limit(()=>previewRecord(record,formulaUuids,asOf,{deferLogs:true,runUuid}))));
  const logs = results.flatMap(result => result._logs || []);
  results.forEach(result => { delete result._logs; });
  // One multi-row insert for the entire bulk run; every row shares this request's run UUID.
  await insertRunLogs(logs);
  const elapsedMs=Date.now()-started;
  return {runUuid,results,metrics:{totalTimeMs:elapsedMs,averageTimePerRecordMs:Number((elapsedMs/records.length).toFixed(2)),failures:results.reduce((n,r)=>n+r.metrics.failures,0),records:records.length}};
}
module.exports = { previewRecord, previewBulk };