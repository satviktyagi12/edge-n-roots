const test=require('node:test');
const assert=require('node:assert/strict');
const {executionLevels,cyclePath,dependenciesOf}=require('../src/services/dependency-graph');
test('orders formulas by dependencies regardless of creation order',()=>{
  const formulas=[
    {name:'total',formula:'return commission + tax'},
    {name:'tax',formula:'return commission * 0.18'},
    {name:'commission',formula:'return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100'}
  ];
  assert.deepEqual(executionLevels(formulas).map(level=>level.map(f=>f.name)),[['commission'],['tax'],['total']]);
});
test('reports complete cycle path',()=>{
  const formulas=[{name:'a',formula:'return b'},{name:'b',formula:'return c'},{name:'c',formula:'return a'}];
  assert.deepEqual(cyclePath(new Map([['a',['b']],['b',['c']],['c',['a']]])),['a','b','c','a']);
  assert.throws(()=>executionLevels(formulas),/Dependency loop detected/);
});
test('finds formula references but not EXTERNAL_VAR properties',()=>{
  assert.deepEqual(dependenciesOf('return EXTERNAL_VAR.amount * rate + commission',new Set(['rate','commission'])),['rate','commission']);
});