const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const app = require('../src/app');
const pool = require('../src/db/pool');

test.after(async () => { await pool.end(); });

test('GET /health returns an OK response', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

const enabled = process.env.RUN_DB_TESTS === '1';
test('HTTP API creates, changes, previews historically, and returns formula history', { skip: !enabled }, async () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const name = 'api_commission_' + suffix;
  const createdResponse = await request(app).post('/formulas').send({
    name,
    formula: 'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100',
    createdBy: 'api-integration-test'
  });
  assert.equal(createdResponse.status, 201, JSON.stringify(createdResponse.body));
  const created = createdResponse.body.data;
  assert.ok(created.uuid);
  assert.equal(created.status, 'ACTIVE');

  const previewBefore = await request(app).post('/formulas/preview').send({
    record: { amount: 2000, rate: 10 },
    formulaUuids: [created.uuid]
  });
  assert.equal(previewBefore.status, 200, JSON.stringify(previewBefore.body));
  assert.equal(previewBefore.body.data.results[0].result, 200);

  const changedResponse = await request(app).post('/formulas').send({
    uuid: created.uuid,
    expectedVersionId: created.id,
    formula: 'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 200'
  });
  assert.equal(changedResponse.status, 200, JSON.stringify(changedResponse.body));
  assert.notEqual(changedResponse.body.data.id, created.id);

  const historicalPreview = await request(app).post('/formulas/preview').send({
    record: { amount: 2000, rate: 10 },
    formulaUuids: [created.uuid],
    asOf: created.inserted_at
  });
  assert.equal(historicalPreview.status, 200, JSON.stringify(historicalPreview.body));
  assert.equal(historicalPreview.body.data.results[0].result, 200);

  const history = await request(app).get('/formulas/' + created.uuid + '/history');
  assert.equal(history.status, 200);
  assert.equal(history.body.data.length, 2);
  assert.equal(Number(history.body.data[0].id), Number(created.id));
  assert.equal(Number(history.body.data[1].id), Number(changedResponse.body.data.id));

  const list = await request(app).get('/formulas');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some(item => item.uuid === created.uuid && Number(item.id) === Number(changedResponse.body.data.id)));
});

test('POST /formulas rejects a malformed create payload with a consistent error', async () => {
  const response = await request(app).post('/formulas').send({ name: 'not valid name' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

const ciBulkLimitMs = process.env.CI === 'true' ? 150000 : 30000;
const ciBulkTestTimeoutMs = process.env.CI === 'true' ? 180000 : 60000;
test('bulk preview handles 500 records and 10 formulas within the target budget', { skip: !enabled, timeout: ciBulkTestTimeoutMs }, async () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const formulaUuids = [];
  for (let i = 1; i <= 10; i++) {
    const response = await request(app).post('/formulas').send({
      name: 'bulk_' + suffix + '_' + i,
      formula: 'return EXTERNAL_VAR.amount * ' + i,
      createdBy: 'bulk-performance-test'
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    formulaUuids.push(response.body.data.uuid);
  }

  const records = Array.from({ length: 500 }, (_, i) => ({ amount: i + 1 }));
  const started = Date.now();
  const response = await request(app).post('/formulas/preview/bulk').send({ records, formulaUuids });
  const elapsed = Date.now() - started;
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 2000));
  assert.equal(response.body.data.results.length, 500);
  assert.ok(elapsed < ciBulkLimitMs, '500 x 10 formula preview took ' + elapsed + 'ms (limit ' + ciBulkLimitMs + 'ms)');
  assert.equal(response.body.data.metrics.records, 500);
  assert.equal(response.body.data.metrics.failures, 0, 'all bulk formulas must succeed');
  assert.equal(response.body.data.results[0].results[0].result, 1);
});

test('HTTP API protects dependencies and supports deactivate plus rollback', { skip: !enabled }, async () => {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const baseName = 'base_' + suffix;
  const dependentName = 'dependent_' + suffix;
  const baseResponse = await request(app).post('/formulas').send({
    name: baseName,
    formula: 'return EXTERNAL_VAR.amount + 1',
    createdBy: 'api-lifecycle-test'
  });
  assert.equal(baseResponse.status, 201, JSON.stringify(baseResponse.body));
  const base = baseResponse.body.data;

  const dependentResponse = await request(app).post('/formulas').send({
    name: dependentName,
    formula: 'return ' + baseName + ' + 1',
    createdBy: 'api-lifecycle-test'
  });
  assert.equal(dependentResponse.status, 201, JSON.stringify(dependentResponse.body));
  const dependent = dependentResponse.body.data;

  const impact = await request(app).get('/formulas/' + base.uuid + '/impact');
  assert.equal(impact.status, 200);
  assert.ok(impact.body.data.some(formula => formula.uuid === dependent.uuid));

  const blocked = await request(app).post('/formulas/' + base.uuid + '/deactivate').send({
    expectedVersionId: base.id,
    force: false
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, 'DEPENDENTS_EXIST');

  const deactivatedResponse = await request(app).post('/formulas/' + base.uuid + '/deactivate').send({
    expectedVersionId: base.id,
    force: true
  });
  assert.equal(deactivatedResponse.status, 200, JSON.stringify(deactivatedResponse.body));
  const deactivated = deactivatedResponse.body.data;
  assert.equal(deactivated.status, 'INACTIVE');

  const rollback = await request(app).post('/formulas/' + base.uuid + '/rollback').send({
    expectedVersionId: deactivated.id,
    targetVersionId: base.id
  });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.body));
  assert.equal(rollback.body.data.status, 'ACTIVE');

  const history = await request(app).get('/formulas/' + base.uuid + '/history');
  assert.equal(history.status, 200);
  assert.equal(history.body.data.length, 3);
});