# Error Codes Reference

This document lists all error codes implemented in the error handling utilities.

## Error Categories

### 1. Authentication Errors (401)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `AUTH_INVALID_CREDENTIALS` | `AuthenticationError` | Invalid email or password provided |
| `AUTH_TOKEN_REQUIRED` | `TokenRequiredError` | Authentication token is missing |
| `AUTH_INVALID_TOKEN` | `InvalidTokenError` | Authentication token is invalid or expired |
| `AUTH_TOKEN_EXPIRED` | (handled in middleware) | JWT token has expired |

### 2. Authorization Errors (403)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `AUTHZ_PERMISSION_DENIED` | `AuthorizationError` | User lacks required permission |
| `AUTHZ_TENANT_ISOLATION_VIOLATION` | `TenantIsolationError` | Attempted cross-tenant access |

### 3. Validation Errors (400)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `VALIDATION_INVALID_INPUT` | `ValidationError` | Input validation failed |
| `VALIDATION_CIRCULAR_HIERARCHY` | `CircularHierarchyError` | Operation would create circular hierarchy |
| `VALIDATION_HIERARCHY_DEPTH_EXCEEDED` | `HierarchyDepthError` | Role hierarchy depth exceeds 5 levels |
| `VALIDATION_FOREIGN_KEY_VIOLATION` | (handled in middleware) | Referenced resource does not exist |
| `VALIDATION_REQUIRED_FIELD_MISSING` | (handled in middleware) | Required field is missing |
| `VALIDATION_INVALID_FORMAT` | (handled in middleware) | Invalid data format |

### 4. Resource Errors (404)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `RESOURCE_NOT_FOUND` | `NotFoundError` | Requested resource was not found |

### 5. Conflict Errors (409)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `CONFLICT_DUPLICATE_RESOURCE` | `ConflictError` | Resource with identifier already exists |

### 6. Rate Limiting Errors (429)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `RATE_LIMIT_EXCEEDED` | `RateLimitError` | Too many requests, rate limit exceeded |

### 7. Server Errors (500)

| Error Code | Error Class | Description |
|------------|-------------|-------------|
| `INTERNAL_SERVER_ERROR` | `InternalServerError` | Unexpected server error occurred |
| `DATABASE_ERROR` | `DatabaseError` | Database operation failed |
| `DATABASE_CONNECTION_ERROR` | `DatabaseConnectionError` | Unable to connect to database |

## Error Response Format

All errors follow this consistent JSON structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {},
    "timestamp": "2024-01-01T00:00:00.000Z",
    "request_id": "unique-request-id"
  }
}
```

## Usage Examples

### Throwing Custom Errors

```javascript
const { ValidationError, AuthorizationError, NotFoundError } = require('./middleware/errorHandler');

// Validation error with details
throw new ValidationError('Invalid input', {
  fields: {
    email: 'Must be a valid email address',
    password: 'Must be at least 8 characters'
  }
});

// Authorization error with permission details
throw new AuthorizationError('Permission denied', {
  required_permission: { resource: 'files/123', action: 'DELETE' },
  user_permissions: [/* user's permissions */]
});

// Not found error
throw new NotFoundError('Role not found', {
  resource_type: 'role',
  resource_id: 'uuid-here'
});
```

### Using Async Handler

```javascript
const { asyncHandler } = require('./middleware/errorHandler');

router.get('/api/resource', asyncHandler(async (req, res) => {
  // Any errors thrown here will be caught and passed to error handler
  const data = await someAsyncOperation();
  res.json(data);
}));
```

## PostgreSQL Error Code Mapping

The error handler automatically maps PostgreSQL error codes:

| PostgreSQL Code | HTTP Status | Error Code | Description |
|-----------------|-------------|------------|-------------|
| `23505` | 409 | `CONFLICT_DUPLICATE_RESOURCE` | Unique constraint violation |
| `23503` | 400 | `VALIDATION_FOREIGN_KEY_VIOLATION` | Foreign key constraint violation |
| `23502` | 400 | `VALIDATION_REQUIRED_FIELD_MISSING` | Not null constraint violation |
| `22P02` | 400 | `VALIDATION_INVALID_FORMAT` | Invalid text representation |

## Compliance with Design Document

This implementation covers all error categories specified in the design document:

- ✅ AUTH_* (Authentication errors)
- ✅ AUTHZ_* (Authorization errors)
- ✅ VALIDATION_* (Validation errors)
- ✅ RESOURCE_* (Resource errors)
- ✅ CONFLICT_* (Conflict errors)
- ✅ RATE_LIMIT_* (Rate limiting errors)
- ✅ INTERNAL_* (Internal server errors)

All error responses include:
- ✅ Machine-readable error code
- ✅ Human-readable message
- ✅ Optional details object
- ✅ ISO 8601 timestamp
- ✅ Unique request ID for tracing
