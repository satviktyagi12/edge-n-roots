const test=require('node:test');
const assert=require('node:assert/strict');
const {saveRecord}=require('../src/services/save-record');
test('rejects unapproved tables instead of allowing arbitrary SQL identifiers',async()=>{
  await assert.rejects(()=>saveRecord('users',{name:'x'}),/Table is not allowed/);
});
test('accepts only UUID as the configured logical key',async()=>{
  await assert.rejects(()=>saveRecord('formulas',{name:'x'},{uuidColumn:'id'}),/Unsupported UUID column/);
});