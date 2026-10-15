const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateFormula,normalizeReferences}=require('../src/services/formula-evaluator');

test('evaluates simple arithmetic formulas and rounds results',async()=>{
  const result=await evaluateFormula('return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100',{amount:2000,rate:10},{});
  assert.equal(result.status,'SUCCESS');
  assert.equal(result.result,200);
});
test('reuses the arithmetic fast path for repeated bulk formulas',async()=>{
  const formula='return EXTERNAL_VAR.amount * 7';
  for (let amount=1; amount<=20; amount++) {
    const result=await evaluateFormula(formula,{amount},{});
    assert.equal(result.status,'SUCCESS');
    assert.equal(result.result,amount*7);
  }
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
test('does not use the arithmetic fast path for arbitrary statements',async()=>{
  const result=await evaluateFormula('while (true) {}\nreturn 1',{}, {},100);
  assert.equal(result.status,'FAILED');
  assert.match(result.error,/timed out/i);
});
