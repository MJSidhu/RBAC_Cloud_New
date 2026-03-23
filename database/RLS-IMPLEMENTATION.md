# Row-Level Security (RLS) Implementation

## Overview

This document describes the Row-Level Security (RLS) implementation for the Multi-Tenant RBAC System. RLS provides automatic tenant data isolation at the database level, ensuring that queries only return data belonging to the current tenant.

## Implementation Details

### RLS-Enabled Tables

The following tables have RLS enabled with tenant isolation policies:

1. **tenants** - Tenant records
2. **users** - User accounts
3. **roles** - Role definitions
4. **permissions** - Permission definitions
5. **user_roles** - User-to-role assignments
6. **role_permissions** - Role-to-permission assignments
7. **audit_logs** - Authorization audit trail

### RLS Policy Expression

All RLS policies use the same expression:

```sql
USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
```

This expression:
- Filters rows based on the `tenant_id` column
- Compares against the session variable `app.current_tenant_id`
- Casts the session variable to UUID type for comparison

### Tables WITHOUT RLS

The following tables do NOT have RLS enabled for specific reasons:

1. **issuers** - System-level table, no tenant_id column
2. **tenant_trust** - Requires cross-tenant visibility for trust relationships
3. **sessions** - Managed by authentication service, needs cross-tenant access

## Usage

### Setting Tenant Context

Before executing queries, set the tenant context:

```javascript
const db = require('./database/config');

// Set tenant context for a database client
await db.setTenantContext(tenantId, client);

// Or use the helper function
const result = await db.queryWithTenantContext(
  tenantId,
  'SELECT * FROM users WHERE email = $1',
  ['user@example.com']
);
```

### SQL Example

```sql
-- Set the tenant context
SET app.current_tenant_id = '11111111-1111-1111-1111-111111111111';

-- This query will only return users from the specified tenant
SELECT * FROM users;

-- Change tenant context
SET app.current_tenant_id = '22222222-2222-2222-2222-222222222222';

-- Now the same query returns different users
SELECT * FROM users;
```

## Verification

### Automated Verification

Run the verification script to check RLS implementation:

```bash
npm run db:verify-rls
```

This script verifies:
- ✓ RLS is enabled on all required tables
- ✓ RLS is NOT enabled on excluded tables
- ✓ All policies use the correct tenant_id expression
- ✓ No unexpected policies exist

### Manual Verification

Check RLS status using SQL:

```bash
psql -d rbac_system -f database/verify-rls.sql
```

### Integration Testing

Run the isolation test suite:

```bash
npm run db:test-rls
```

This test:
- Creates test data for two tenants
- Sets context to Tenant A and verifies only Tenant A data is visible
- Sets context to Tenant B and verifies only Tenant B data is visible
- Verifies cross-tenant tables (tenant_trust, sessions) are accessible

## Security Benefits

### Defense in Depth

RLS provides an additional security layer beyond application-level checks:

1. **Application Layer** - PDP middleware checks permissions
2. **Database Layer** - RLS automatically filters queries
3. **Network Layer** - SSL/TLS encryption

### Automatic Enforcement

- No application code changes needed for tenant isolation
- Impossible to accidentally query another tenant's data
- Works even if application logic has bugs

### Audit and Compliance

- All queries are automatically scoped to the current tenant
- Audit logs track which tenant context was used
- Meets compliance requirements for data isolation

## Performance Considerations

### Indexes

All multi-tenant tables have indexes on `tenant_id`:

```sql
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_roles_tenant ON roles(tenant_id);
-- etc.
```

### Query Planning

PostgreSQL's query planner uses RLS policies to optimize queries:

```sql
EXPLAIN SELECT * FROM users WHERE email = 'user@example.com';
-- Shows: Filter: (tenant_id = '...'::uuid)
```

### Connection Pooling

The system uses connection pooling to minimize overhead:
- Minimum 10 connections
- Maximum 50 connections
- Session variables persist within a connection

## Troubleshooting

### Error: "unrecognized configuration parameter"

If you see this error:

```
ERROR: unrecognized configuration parameter "app.current_tenant_id"
```

**Solution**: Set the session variable before querying:

```sql
SET app.current_tenant_id = 'your-tenant-id';
```

### No Rows Returned

If queries return no rows unexpectedly:

1. Check that `app.current_tenant_id` is set
2. Verify the tenant_id matches the data
3. Check that RLS is enabled on the table

```sql
-- Check current tenant context
SHOW app.current_tenant_id;

-- Check RLS status
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'users';
```

### Cross-Tenant Queries

If you need to query across tenants (e.g., for admin operations):

1. Use a superuser role (bypasses RLS)
2. Or temporarily disable RLS (not recommended in production)

```sql
-- As superuser, RLS is bypassed
SELECT * FROM users; -- Returns all users from all tenants
```

## Requirements Validation

This implementation satisfies the following requirements:

### Requirement 6.1
✓ All multi-tenant tables include a `tenant_id` column

### Requirement 6.2
✓ PostgreSQL RLS policies are enforced on all multi-tenant tables

### Requirement 6.3
✓ RLS policies use the expression: `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`

### Requirement 6.4
✓ The `app.current_tenant_id` session variable is set before queries (via `setTenantContext`)

### Requirement 6.5
✓ Queries cannot return rows belonging to other tenants (enforced by RLS)

## Files

- `database/schema.sql` - Database schema with tenant_id columns
- `database/rls-policies.sql` - RLS policy definitions
- `database/verify-rls.sql` - SQL verification queries
- `database/verify-rls.js` - Automated verification script
- `database/test-rls-isolation.sql` - Integration test suite
- `database/config.js` - Database configuration with tenant context helpers

## References

- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Multi-Tenant Data Architecture](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/overview)
- Requirements Document: `.kiro/specs/multi-tenant-rbac-system/requirements.md`
- Design Document: `.kiro/specs/multi-tenant-rbac-system/design.md`
