const { z } = require('zod');

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'name must be a valid identifier');
const formulaBody = z.object({
  uuid: z.string().uuid().optional(),
  name: identifier.optional(),
  formula: z.string().min(1).max(10000).optional(),
  createdBy: z.string().trim().min(1).max(128).default('api'),
  expectedVersionId: z.number().int().positive().optional(),
  force: z.boolean().default(false)
}).strict().superRefine((body, ctx) => {
  if (!body.uuid) {
    if (!body.name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'name is required when creating a formula.' });
    if (!body.formula) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['formula'], message: 'formula is required when creating a formula.' });
    if (body.expectedVersionId !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedVersionId'], message: 'expectedVersionId is only valid when changing an existing formula.' });
    return;
  }
  if (body.expectedVersionId === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedVersionId'], message: 'expectedVersionId is required when changing a formula.' });
  if (body.name === undefined && body.formula === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'Provide name or formula to create a new version.' });
});
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