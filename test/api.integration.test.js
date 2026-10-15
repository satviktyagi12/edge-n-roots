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