class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function badRequest(message, details) {
  return new ApiError(400, 'invalid_request', message, details);
}

function notFound(message) {
  return new ApiError(404, 'not_found', message);
}

function conflict(message, details) {
  return new ApiError(409, 'conflict', message, details);
}

function forbidden(message) {
  return new ApiError(403, 'forbidden', message);
}

function unauthorized(message) {
  return new ApiError(401, 'unauthorized', message || 'Invalid or missing host token');
}

module.exports = { ApiError, badRequest, notFound, conflict, forbidden, unauthorized };
