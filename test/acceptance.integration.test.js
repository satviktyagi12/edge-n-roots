const test = require('node:test');
const assert = require('node:assert/strict');

// Opt in only against a dedicated test database: these tests intentionally append
// permanent version rows because business records are insert-only.
const enabled = process.env.RUN_DB_TESTS === '1';

test('two edits against one base version produce exactly one conflict', { skip: !enabled }, async () => {
  const { createOrChange } = require('../src/services/formula-service');
  const { randomUUID } = require('node:crypto');
  const created = await createOrChange({
    name: 'concurrency_' + randomUUID().replace(/-/g, '').slice(0, 12),
    formula: 'return EXTERNAL_VAR.amount + 1',
    createdBy: 'integration-test'
  });
  const edits = await Promise.allSettled([
    createOrChange({ uuid: created.uuid, expectedVersionId: created.id, name: created.name, formula: 'return EXTERNAL_VAR.amount + 2', createdBy: 'integration-test' }),
    createOrChange({ uuid: created.uuid, expectedVersionId: created.id, name: created.name, formula: 'return EXTERNAL_VAR.amount + 3', createdBy: 'integration-test' })
  ]);
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = edits.filter(r => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
});

test('a dependent formula is SKIPPED when its prerequisite fails', { skip: !enabled }, async () => {
  const { saveRecord } = require('../src/services/save-record');
  const { previewRecord } = require('../src/services/preview-service');
  const suffix = require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 10);
  const failed = await saveRecord('formulas', {
    name: 'failure_' + suffix,
    formula: 'return missingFunction()',
    status: 'ACTIVE',
    created_by: 'integration-test'
  });
  const dependent = await saveRecord('formulas', {
    name: 'dependent_' + suffix,
    formula: 'return failure_' + suffix + ' + 1',
    status: 'ACTIVE',
    created_by: 'integration-test'
  });
  const result = await previewRecord({ amount: 1 }, [dependent[0].uuid]);
  const dependentResult = result.results.find(item => item.uuid === dependent[0].uuid);
  assert.ok(dependentResult);
  assert.equal(dependentResult.status, 'SKIPPED');
  assert.ok(failed[0].uuid);
});