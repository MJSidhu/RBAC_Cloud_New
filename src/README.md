# Express.js Server Setup - Task 2.1

## Overview

This directory contains the Express.js server implementation for the Multi-Tenant RBAC System with the following features:

### Implemented Features

1. **Express.js Application** - Core server setup with JSON body parser
2. **Security Middleware**
   - Helmet.js for security headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy)
   - CORS configuration for cross-origin requests
3. **Rate Limiting** - 100 requests per minute per user (configurable)
4. **Error Handling** - Centralized error handling middleware with consistent error responses
5. **Database Connection Pooling** - PostgreSQL connection pool (min: 10, max: 50 connections)
6. **Request Tracing** - Unique request ID for each request
7. **Health Check Endpoint** - `/health` endpoint for monitoring

## Project Structure

```
src/
├── server.js                 # Main Express application
├── config/
│   └── database.js          # Database connection pool configuration
├── middleware/
│   └── errorHandler.js      # Error handling middleware
└── test-server.js           # Server setup verification script
```

## Configuration

All configuration is managed through environment variables in the `.env` file:

### Database Configuration
- `DB_HOST` - Database host (default: localhost)
- `DB_PORT` - Database port (default: 5432)
- `DB_NAME` - Database name (default: rbac_system)
- `DB_USER` - Database user (default: postgres)
- `DB_PASSWORD` - Database password
- `DB_POOL_MIN` - Minimum pool connections (default: 10) ✓ **Requirement 15.4**
- `DB_POOL_MAX` - Maximum pool connections (default: 50) ✓ **Requirement 15.4**

### Server Configuration
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment (development/production)

### Security Configuration
- `JWT_SECRET` - Secret key for JWT signing
- `JWT_EXPIRY` - JWT expiration time (default: 24h)
- `REFRESH_TOKEN_EXPIRY` - Refresh token expiration (default: 7d)
- `BCRYPT_ROUNDS` - Bcrypt hashing rounds (default: 10)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in ms (default: 60000)
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window (default: 100)

## Middleware Stack

The server implements the following middleware in order:

1. **Helmet** - Security headers ✓ **Requirement 14.6**
   - Content-Security-Policy
   - X-Content-Type-Options: nosniff
   - X-Frame-Options: DENY

2. **CORS** - Cross-Origin Resource Sharing
   - Configurable origin
   - Credentials support
   - Standard HTTP methods

3. **Body Parser** - JSON and URL-encoded body parsing
   - 10MB limit
   - Extended URL encoding

4. **Rate Limiter** - Request rate limiting ✓ **Requirement 14.3**
   - 100 requests per minute per IP
   - Standard headers
   - Custom error response

5. **Request ID** - Unique request identifier
   - UUID v4 generation
   - X-Request-ID header

6. **Error Handler** - Centralized error handling
   - Consistent error format
   - Request tracing
   - Environment-aware stack traces

## Database Connection Pool

The database module provides:

### Connection Pool Features
- **Min connections**: 10 (always maintained) ✓ **Requirement 15.4**
- **Max connections**: 50 (maximum allowed) ✓ **Requirement 15.4**
- **Connection timeout**: 5 seconds
- **Idle timeout**: 30 seconds
- **Max lifetime**: 1 hour
- **SSL support**: Enabled in production

### Helper Functions

#### `setTenantContext(client, tenantId)`
Sets the tenant context for Row-Level Security (RLS) policies.

```javascript
const client = await pool.connect();
await setTenantContext(client, tenantId);
```

#### `queryWithTenantContext(tenantId, queryText, params)`
Executes a query with automatic tenant context setting.

```javascript
const result = await queryWithTenantContext(
  tenantId,
  'SELECT * FROM users WHERE user_id = $1',
  [userId]
);
```

#### `withTransaction(tenantId, callback)`
Executes a callback within a database transaction with tenant context.

```javascript
await withTransaction(tenantId, async (client) => {
  await client.query('INSERT INTO users ...');
  await client.query('INSERT INTO user_roles ...');
});
```

## Error Handling

The error handler provides consistent error responses:

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {},
    "timestamp": "2024-01-01T00:00:00.000Z",
    "request_id": "uuid"
  }
}
```

### Error Classes

- `ValidationError` (400) - Input validation failures
- `AuthenticationError` (401) - Authentication failures
- `AuthorizationError` (403) - Permission denied
- `NotFoundError` (404) - Resource not found
- `ConflictError` (409) - Duplicate resources
- `RateLimitError` (429) - Rate limit exceeded
- `DatabaseError` (500) - Database operation failures

### Usage Example

```javascript
const { ValidationError, asyncHandler } = require('./middleware/errorHandler');

app.post('/api/users', asyncHandler(async (req, res) => {
  if (!req.body.email) {
    throw new ValidationError('Email is required');
  }
  // ... rest of handler
}));
```

## API Endpoints

### Health Check
```
GET /health
```

Returns server health status and database connectivity.

**Response (200 OK)**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected"
}
```

**Response (503 Service Unavailable)**:
```json
{
  "status": "unhealthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "disconnected",
  "error": "Connection error message"
}
```

## Running the Server

### Prerequisites
1. PostgreSQL database running
2. Database schema and RLS policies applied (see `database/` directory)
3. Environment variables configured in `.env`

### Start Commands

```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev

# Test server setup
node src/test-server.js
```

### Verification

The server logs the following on startup:
```
Server running on http://0.0.0.0:3000
Environment: development
Database pool: min=10, max=50
```

## Security Features

### Helmet Security Headers ✓ **Requirement 14.6**

The server includes the following security headers on all responses:

- `Content-Security-Policy` - Restricts resource loading
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking

### Rate Limiting ✓ **Requirement 14.3**

- 100 requests per minute per IP address
- Returns 429 status code when exceeded
- Includes retry-after information

### Input Validation ✓ **Requirement 14.1, 14.2**

- JSON body size limit (10MB)
- Parameterized queries prevent SQL injection
- Error handler sanitizes error messages

## Graceful Shutdown

The server handles SIGTERM and SIGINT signals:

1. Closes HTTP server
2. Closes database connection pool
3. Exits cleanly

## Next Steps

The following components need to be implemented in subsequent tasks:

- [ ] Authentication routes (`/api/auth`)
- [ ] Tenant management routes (`/api/tenants`)
- [ ] Role management routes (`/api/roles`)
- [ ] Permission management routes (`/api/permissions`)
- [ ] PDP (Policy Decision Point) middleware
- [ ] Audit logging service
- [ ] Permission caching

## Requirements Satisfied

This implementation satisfies the following requirements:

- ✓ **Requirement 14.6**: Security headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy)
- ✓ **Requirement 15.4**: Database connection pooling (min 10, max 50 connections)

## Testing

To verify the server setup:

```bash
# Run the verification script
node src/test-server.js
```

This will test:
1. Database connection
2. Connection pool configuration
3. Environment variables
4. Tenant context setting (RLS)
5. Middleware dependencies

## Troubleshooting

### Database Connection Failed

If you see "Database connection failed", ensure:
1. PostgreSQL is running
2. Database `rbac_system` exists
3. Credentials in `.env` are correct
4. Database schema is applied (`npm run db:setup`)

### Port Already in Use

If port 3000 is in use, change the `PORT` in `.env`:
```
PORT=3001
```

### Rate Limit Issues

To adjust rate limiting, modify `.env`:
```
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```
