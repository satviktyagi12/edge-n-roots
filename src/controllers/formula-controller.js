const service = require('../services/formula-service');
const preview = require('../services/preview-service');
const { formulaBody, previewBody, bulkBody, validate } = require('../validation/formulas');
const { AppError } = require('../utils/errors');

async function create(req,res) {
  const body=validate(formulaBody,req.body);
  const saved=await service.createOrChange(body);
  res.status(body.uuid?200:201).json({data:saved});
}
async function deactivate(req,res) {
  const expected=Number(req.body?.expectedVersionId);
  if (!Number.isInteger(expected)||expected<=0) throw new AppError(400,'VALIDATION_ERROR','expectedVersionId must be a positive integer.');
  const data=await service.deactivate(req.params.uuid,expected,req.body?.force===true);
  res.json({data});
}
async function rollback(req,res) {
  const expected=Number(req.body?.expectedVersionId), target=Number(req.body?.targetVersionId);
  if (![expected,target].every(n=>Number.isInteger(n)&&n>0)) throw new AppError(400,'VALIDATION_ERROR','expectedVersionId and targetVersionId must be positive integers.');
  res.json({data:await service.rollback(req.params.uuid,target,expected)});
}
async function list(_req,res) { res.json({data:await service.list()}); }
async function history(req,res) { res.json({data:await service.getHistory(req.params.uuid)}); }
async function impact(req,res) { res.json({data:await service.impact(req.params.uuid)}); }
async function runPreview(req,res) {
  const body=validate(previewBody,req.body);
  res.json({data:await preview.previewRecord(body.record,body.formulaUuids,body.asOf)});
}
async function runBulk(req,res) {
  const body=validate(bulkBody,req.body);
  res.json({data:await preview.previewBulk(body.records,body.formulaUuids,body.asOf)});
}
module.exports={create,deactivate,rollback,list,history,impact,runPreview,runBulk};