const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateFormula,normalizeReferences}=require('../src/services/formula-evaluator');

test('evaluates a formula in an isolated worker and rounds results',async()=>{
  const result=await evaluateFormula('return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100',{amount:2000,rate:10},{});
  assert.equal(result.status,'SUCCESS');
  assert.equal(result.result,200);
});
test('normalizes bare formula dependencies to EXTERNAL_VAR references',()=>{
  assert.equal(normalizeReferences('return commission * 0.18',{commission:200}),'return EXTERNAL_VAR.commission * 0.18');
});
test('kills a formula that exceeds the parent timeout',async()=>{
  const result=await evaluateFormula('while (true) {}\nreturn 1',{}, {},100);
  assert.equal(result.status,'FAILED');
  assert.match(result.error,/timed out/i);
});
test('supports the SUM helper in isolated formula evaluation', async () => {
  const result = await evaluateFormula('return SUM(EXTERNAL_VAR.amount, 20)', { amount: 22 }, {});
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.result, 42);
});
