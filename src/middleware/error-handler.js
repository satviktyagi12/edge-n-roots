const { AppError } = require('../utils/errors');

function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`));
}
function errorHandler(err, req, res, _next) {
  const known = err instanceof AppError;
  const status = known ? err.status : 500;
  if (!known) console.error(err);
  res.status(status).json({
    error: {
      code: known ? err.code : 'INTERNAL_ERROR',
      message: known ? err.message : 'An unexpected error occurred.',
      ...(known && err.details !== undefined ? { details: err.details } : {})
    }
  });
}
module.exports = { notFound, errorHandler };