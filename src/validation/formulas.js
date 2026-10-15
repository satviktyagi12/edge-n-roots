const { z } = require('zod');

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'name must be a valid identifier');
const formulaBody = z.object({
  uuid: z.string().uuid().optional(),
  name: identifier,
  formula: z.string().min(1).max(10000),
  createdBy: z.string().trim().min(1).max(128).default('api'),
  expectedVersionId: z.number().int().positive().optional(),
  force: z.boolean().default(false)
}).strict();
const previewBody = z.object({
  record: z.record(z.unknown()),
  formulaUuids: z.array(z.string().uuid()).optional(),
  asOf: z.string().datetime({ offset: true }).optional()
}).strict();
const bulkBody = z.object({
  records: z.array(z.record(z.unknown())).min(1).max(500),
  formulaUuids: z.array(z.string().uuid()).optional(),
  asOf: z.string().datetime({ offset: true }).optional()
}).strict();

function validate(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const { AppError } = require('../utils/errors');
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', parsed.error.issues.map(i => ({
      path: i.path.join('.'), message: i.message
    })));
  }
  return parsed.data;
}
module.exports = { formulaBody, previewBody, bulkBody, validate };