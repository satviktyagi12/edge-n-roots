const test=require('node:test');
const assert=require('node:assert/strict');
const {saveRecord}=require('../src/services/save-record');

test('rejects unsafe table identifiers before touching the database',async()=>{
  await assert.rejects(()=>saveRecord('formulas; DROP TABLE formulas',{name:'x'}),/Invalid table or column identifier/);
});
test('rejects unsafe UUID column identifiers before touching the database',async()=>{
  await assert.rejects(()=>saveRecord('formulas',{name:'x'},{uuidColumn:'uuid; DROP'}),/Invalid table or column identifier/);
});
test('empty array returns without issuing a database query',async()=>{
  assert.deepEqual(await saveRecord('formulas',[]),[]);
});