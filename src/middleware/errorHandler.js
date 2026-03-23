/**
 * Centralized error handling middleware
 * Handles all errors and returns consistent error responses
 */

class AppError extends Error {
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_INVALID_INPUT', details);
  }
}

class CircularHierarchyError extends AppError {
  constructor(message = 'Operation would create a circular hierarchy', details = null) {
    super(message, 400, 'VALIDATION_CIRCULAR_HIERARCHY', details);
  }
}

class HierarchyDepthError extends AppError {
  constructor(message = 'Role hierarchy depth cannot exceed 5 levels', details = null) {
    super(message, 400, 'VALIDATION_HIERARCHY_DEPTH_EXCEEDED', details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', code = 'AUTH_INVALID_CREDENTIALS') {
    super(message, 401, code);
  }
}

class TokenRequiredError extends AppError {
  constructor(message = 'Authentication token is required') {
    super(message, 401, 'AUTH_TOKEN_REQUIRED');
  }
}

class InvalidTokenError extends AppError {
  constructor(message = 'Authentication token is invalid or expired') {
    super(message, 401, 'AUTH_INVALID_TOKEN');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Permission denied', details = null) {
    super(message, 403, 'AUTHZ_PERMISSION_DENIED', details);
  }
}

class TenantIsolationError extends AppError {
  constructor(message = 'Access to resources in other tenants is not allowed') {
    super(message, 403, 'AUTHZ_TENANT_ISOLATION_VIOLATION');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details = null) {
    super(message, 404, 'RESOURCE_NOT_FOUND', details);
  }
}

class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, 'CONFLICT_DUPLICATE_RESOURCE', details);
  }
}

class RateLimitError extends AppError {
  constructor(details = null) {
    super('Too many requests. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED', details);
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500, 'DATABASE_ERROR');
  }
}

class DatabaseConnectionError extends AppError {
  constructor(message = 'Unable to connect to database') {
    super(message, 500, 'DATABASE_CONNECTION_ERROR');
  }
}

class InternalServerError extends AppError {
  constructor(message = 'An unexpected error occurred', details = null) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', details);
  }
}

// Main error handler middleware
function errorHandler(err, req, res, next) {
  // Default to 500 server error
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_INVALID_INPUT';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'AUTH_INVALID_TOKEN';
    message = 'Authentication token is invalid';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'AUTH_TOKEN_EXPIRED';
    message = 'Authentication token has expired';
  } else if (err.code === '23505') {
    // PostgreSQL unique violation
    statusCode = 409;
    errorCode = 'CONFLICT_DUPLICATE_RESOURCE';
    message = 'A resource with this identifier already exists';
    details = {
      constraint: err.constraint,
    };
  } else if (err.code === '23503') {
    // PostgreSQL foreign key violation
    statusCode = 400;
    errorCode = 'VALIDATION_FOREIGN_KEY_VIOLATION';
    message = 'Referenced resource does not exist';
  } else if (err.code === '23502') {
    // PostgreSQL not null violation
    statusCode = 400;
    errorCode = 'VALIDATION_REQUIRED_FIELD_MISSING';
    message = 'Required field is missing';
  } else if (err.code === '22P02') {
    // PostgreSQL invalid text representation
    statusCode = 400;
    errorCode = 'VALIDATION_INVALID_FORMAT';
    message = 'Invalid data format';
  }

  // Log error for debugging (in production, use proper logging service)
  if (statusCode >= 500) {
    console.error('Server Error:', {
      message: err.message,
      stack: err.stack,
      code: errorCode,
      request_id: req.id,
      url: req.url,
      method: req.method,
    });
  } else {
    console.warn('Client Error:', {
      message: err.message,
      code: errorCode,
      request_id: req.id,
      url: req.url,
      method: req.method,
    });
  }

  // Send error response
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: message,
      ...(details && { details }),
      timestamp: new Date().toISOString(),
      request_id: req.id,
      // Include stack trace only in development
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

// Async error wrapper to catch errors in async route handlers
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = errorHandler;
module.exports.AppError = AppError;
module.exports.ValidationError = ValidationError;
module.exports.CircularHierarchyError = CircularHierarchyError;
module.exports.HierarchyDepthError = HierarchyDepthError;
module.exports.AuthenticationError = AuthenticationError;
module.exports.TokenRequiredError = TokenRequiredError;
module.exports.InvalidTokenError = InvalidTokenError;
module.exports.AuthorizationError = AuthorizationError;
module.exports.TenantIsolationError = TenantIsolationError;
module.exports.NotFoundError = NotFoundError;
module.exports.ConflictError = ConflictError;
module.exports.RateLimitError = RateLimitError;
module.exports.DatabaseError = DatabaseError;
module.exports.DatabaseConnectionError = DatabaseConnectionError;
module.exports.InternalServerError = InternalServerError;
module.exports.asyncHandler = asyncHandler;
