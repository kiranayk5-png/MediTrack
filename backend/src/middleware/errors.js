const { ZodError } = require('zod');

function notFound(_req, _res, next) {
  const error = new Error('The requested endpoint was not found.');
  error.status = 404;
  next(error);
}

function errorHandler(error, _req, res, _next) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Please check the submitted information.', details: error.issues.map(({ path, message }) => ({ path: path.join('.'), message })) },
    });
  }
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'DUPLICATE_RECORD', message: 'A record with those details already exists.' } });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'One of the selected records no longer exists.' } });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({
    error: {
      code: error.code && typeof error.code === 'string' && !error.code.startsWith('ER_') ? error.code : 'INTERNAL_ERROR',
      message: status >= 500 ? 'Something went wrong. Please try again.' : error.message,
    },
  });
}

module.exports = { notFound, errorHandler };
