const { ApiError } = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`No route: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;

  if (statusCode === 500) {
    // Full detail goes to the server log; only a generic message goes to the client.
    console.error(err);
  }

  res.status(statusCode).json({
    error: {
      message,
      details: err.details,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
