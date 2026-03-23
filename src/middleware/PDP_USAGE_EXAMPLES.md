# PDP Middleware Usage Examples

The PDP (Policy Decision Point) middleware is the **GATEKEEPER** for the entire RBAC system. It enforces authorization on every protected API request.

## Components

1. **extractJWT** - Validates JWT and attaches user context to request
2. **setTenantContext** - Sets database session variable for Row-Level Security
3. **authorize(resource, action)** - Checks if user has required permission

## Basic Usage

### Protecting a Single Route

```javascript
const { extractJWT, setTenantContext, authorize } = require('./middleware/pdpMiddleware');

// Protect a DELETE endpoint
app.delete('/api/files/:id',
  extractJWT,              // Step 1: Validate JWT
  setTenantContext,        // Step 2: Set tenant context for RLS
  authorize('files/*', 'DELETE'),  // Step 3: Check permission
  fileController.deleteFile
);
```

### Using the Convenience Function

```javascript
const { requirePermission } = require('./middleware/pdpMiddleware');

// Same as above, but more concise
app.delete('/api/files/:id',
  ...requirePermission('files/*', 'DELETE'),
  fileController.deleteFile
);
```

## Complete Examples

### File Management API

```javascript
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/pdpMiddleware');
const fileController = require('../controllers/fileController');

// Create file - requires CREATE permission
router.post('/files',
  ...requirePermission('files/*', 'CREATE'),
  fileController.createFile
);

// Read file - requires READ permission
router.get('/files/:id',
  ...requirePermission('files/*', 'READ'),
  fileController.getFile
);

// Update file - requires UPDATE permission
router.put('/files/:id',
  ...requirePermission('files/*', 'UPDATE'),
  fileController.updateFile
);

// Delete file - requires DELETE permission
router.delete('/files/:id',
  ...requirePermission('files/*', 'DELETE'),
  fileController.deleteFile
);

// Share file - requires SHARE permission
router.post('/files/:id/share',
  ...requirePermission('files/*', 'SHARE'),
  fileController.shareFile
);

module.exports = router;
```

### Role Management API

```javascript
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/pdpMiddleware');
const roleController = require('../controllers/roleController');

// Only admins can manage roles
router.post('/tenants/:tenantId/roles',
  ...requirePermission('roles/*', 'CREATE'),
  roleController.createRole
);

router.get('/tenants/:tenantId/roles',
  ...requirePermission('roles/*', 'READ'),
  roleController.listRoles
);

router.put('/tenants/:tenantId/roles/:roleId',
  ...requirePermission('roles/*', 'UPDATE'),
  roleController.updateRole
);

router.delete('/tenants/:tenantId/roles/:roleId',
  ...requirePermission('roles/*', 'DELETE'),
  roleController.deleteRole
);

module.exports = router;
```

### Mixed Permissions

```javascript
// Different resources can have different permission requirements
router.get('/dashboard',
  ...requirePermission('dashboard', 'READ'),
  dashboardController.getDashboard
);

router.get('/reports',
  ...requirePermission('reports/*', 'READ'),
  reportController.getReports
);

router.post('/reports/generate',
  ...requirePermission('reports/*', 'CREATE'),
  reportController.generateReport
);
```

## Resource Patterns

The middleware supports wildcard patterns for flexible permission matching:

```javascript
// Exact match
authorize('files/123', 'READ')  // Only matches "files/123"

// Wildcard match
authorize('files/*', 'READ')    // Matches "files/123", "files/abc", etc.

// Global wildcard
authorize('*', 'READ')          // Matches any resource
```

## Action Types

The system supports five action types:

- **CREATE** - Create new resources
- **READ** - View/read resources
- **UPDATE** - Modify existing resources
- **DELETE** - Remove resources
- **SHARE** - Share resources with others

## Error Responses

### 401 Unauthorized - Missing or Invalid JWT

```json
{
  "error": {
    "code": "AUTH_TOKEN_REQUIRED",
    "message": "Authorization header is required",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "request_id": "req-123"
  }
}
```

### 403 Forbidden - Insufficient Permissions

```json
{
  "error": {
    "code": "AUTHZ_PERMISSION_DENIED",
    "message": "You do not have permission to perform this action",
    "details": {
      "required_permission": {
        "resource": "files/123",
        "action": "DELETE"
      },
      "user": {
        "user_id": "123e4567-e89b-12d3-a456-426614174000",
        "tenant_id": "223e4567-e89b-12d3-a456-426614174000",
        "email": "user@example.com"
      }
    },
    "timestamp": "2024-01-15T10:30:00.000Z",
    "request_id": "req-123"
  }
}
```

## How It Works

### 1. JWT Extraction (extractJWT)

- Extracts JWT from `Authorization: Bearer <token>` header
- Validates signature and expiration
- Attaches decoded payload to `req.user`:
  ```javascript
  req.user = {
    user_id: "123e4567-e89b-12d3-a456-426614174000",
    tenant_id: "223e4567-e89b-12d3-a456-426614174000",
    role: "Admin",
    email: "user@example.com",
    iat: 1705315800,
    exp: 1705402200
  }
  ```

### 2. Tenant Context Setting (setTenantContext)

- Gets database client from connection pool
- Begins transaction
- Executes: `SET LOCAL app.current_tenant_id = '<tenant_id>'`
- Attaches client to `req.dbClient`
- Registers cleanup handlers to commit/rollback and release client

**CRITICAL**: This enables Row-Level Security (RLS) at the database level, ensuring automatic tenant data isolation.

### 3. Authorization Check (authorize)

- Calls `hasPermission(user_id, tenant_id, resource, action)`
- Checks effective permissions (includes inherited permissions from role hierarchy)
- Returns 403 if permission denied
- Allows request to proceed if permission granted

## Permission Evaluation

The authorization check evaluates permissions in this order:

1. **Check cache** - Fast in-memory lookup (5-minute TTL)
2. **Query database** - If cache miss:
   - Get user's assigned roles
   - Get roles from cross-tenant trust relationships
   - Traverse role hierarchy to collect inherited permissions
   - Deduplicate permissions
   - Cache result
3. **Match resource pattern** - Check if any permission matches the requested resource and action

## Best Practices

### 1. Always Use the Full Middleware Chain

```javascript
// ✅ CORRECT - Full chain
app.delete('/api/files/:id',
  extractJWT,
  setTenantContext,
  authorize('files/*', 'DELETE'),
  fileController.deleteFile
);

// ❌ WRONG - Missing setTenantContext
app.delete('/api/files/:id',
  extractJWT,
  authorize('files/*', 'DELETE'),  // RLS won't work!
  fileController.deleteFile
);
```

### 2. Use Specific Resource Patterns

```javascript
// ✅ GOOD - Specific pattern
authorize('files/*', 'DELETE')

// ⚠️ LESS SECURE - Too broad
authorize('*', 'DELETE')
```

### 3. Match Actions to Operations

```javascript
// ✅ CORRECT - Action matches operation
router.post('/files', ...requirePermission('files/*', 'CREATE'), ...)
router.get('/files/:id', ...requirePermission('files/*', 'READ'), ...)
router.put('/files/:id', ...requirePermission('files/*', 'UPDATE'), ...)
router.delete('/files/:id', ...requirePermission('files/*', 'DELETE'), ...)

// ❌ WRONG - Action doesn't match operation
router.delete('/files/:id', ...requirePermission('files/*', 'READ'), ...)
```

### 4. Don't Bypass the Middleware

```javascript
// ❌ WRONG - Public endpoint without authorization
app.delete('/api/files/:id', fileController.deleteFile);

// ✅ CORRECT - Protected endpoint
app.delete('/api/files/:id',
  ...requirePermission('files/*', 'DELETE'),
  fileController.deleteFile
);
```

## Testing

When testing protected endpoints, include a valid JWT:

```javascript
const { generateJWT } = require('../utils/jwtUtils');

const token = generateJWT({
  user_id: '123e4567-e89b-12d3-a456-426614174000',
  tenant_id: '223e4567-e89b-12d3-a456-426614174000',
  role: 'Admin',
  email: 'admin@example.com'
});

const response = await request(app)
  .delete('/api/files/123')
  .set('Authorization', `Bearer ${token}`);
```

## Performance Considerations

- **Permission caching**: Effective permissions are cached for 5 minutes
- **Cache invalidation**: Cache is automatically invalidated when roles/permissions change
- **Database connection pooling**: Connections are reused from the pool (min 10, max 50)
- **Transaction scope**: Tenant context is transaction-scoped using `SET LOCAL`

## Security Features

1. **JWT validation** - Signature and expiration checked on every request
2. **Row-Level Security** - Automatic tenant data isolation at database level
3. **Permission inheritance** - Supports role hierarchies up to 5 levels deep
4. **Cross-tenant trust** - Supports secure role sharing between tenants
5. **Audit logging** - All authorization decisions are logged (when integrated)

## Troubleshooting

### "User context not found" Error

**Cause**: `extractJWT` middleware not executed before `setTenantContext` or `authorize`

**Solution**: Ensure middleware order is correct:
```javascript
app.use(extractJWT);
app.use(setTenantContext);
app.use(authorize(...));
```

### "Failed to set tenant context" Error

**Cause**: Database connection issue or invalid tenant_id

**Solution**: 
- Check database connection
- Verify tenant_id in JWT is a valid UUID
- Check database pool configuration

### Permission Denied Despite Having Role

**Cause**: 
- Permission not assigned to role
- Cache not invalidated after permission change
- Role hierarchy not configured correctly

**Solution**:
- Verify role has required permission in database
- Clear cache: `permissionCache.invalidateTenant(tenantId)`
- Check role hierarchy with `getRoleDepth()`

## Related Documentation

- [Error Handler](./errorHandler.js) - Error codes and response format
- [RBAC Service](../services/rbacService.js) - Permission evaluation logic
- [Permission Cache](../services/permissionCache.js) - Caching implementation
- [JWT Utils](../utils/jwtUtils.js) - JWT generation and validation
