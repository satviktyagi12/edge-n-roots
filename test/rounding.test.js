const test=require('node:test');
const assert=require('node:assert/strict');
const {round2}=require('../src/services/rounding');
test('rounds common floating point artifacts to two decimals',()=>{
  assert.equal(round2(0.1+0.2),0.3);
  assert.equal(round2(35.999999999),36);
  assert.equal(round2(2000*10/100),200);
});
test('rejects non-finite results',()=>{
  assert.throws(()=>round2(Infinity),/finite number/);
});