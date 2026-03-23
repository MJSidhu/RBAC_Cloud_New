# Database Setup

This directory contains the PostgreSQL database schema and configuration for the Multi-Tenant RBAC System.

## Files

- `schema.sql` - Complete database schema with all tables, indexes, and constraints
- `rls-policies.sql` - Row-Level Security policies for automatic tenant isolation
- `config.js` - Database connection configuration and helper functions
- `verify-rls.sql` - SQL queries to verify RLS implementation
- `verify-rls.js` - Automated RLS verification script
- `test-rls-isolation.sql` - Integration tests for tenant isolation
- `RLS-IMPLEMENTATION.md` - Detailed RLS implementation documentation

## Prerequisites

- PostgreSQL 14 or higher
- Node.js with `pg` package installed

## Setup Instructions

### 1. Create Database

```bash
createdb rbac_system
```

Or using psql:

```sql
CREATE DATABASE rbac_system;
```

### 2. Apply Schema

```bash
psql -d rbac_system -f database/schema.sql
```

### 3. Apply RLS Policies

```bash
psql -d rbac_system -f database/rls-policies.sql
```

### 4. Verify RLS Implementation

```bash
# Automated verification
npm run db:verify-rls

# Or manual SQL verification
psql -d rbac_system -f database/verify-rls.sql

# Run integration tests
npm run db:test-rls
```

### 5. Configure Environment

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rbac_system
DB_USER=postgres
DB_PASSWORD=your_password
DB_POOL_MIN=10
DB_POOL_MAX=50
```

## Database Schema Overview

### Core Tables

- **issuers** - Organizations that manage tenants
- **tenants** - Isolated customer organizations
- **users** - User accounts associated with tenants
- **roles** - Named collections of permissions
- **permissions** - Granular access rights to resources
- **user_roles** - User-to-role assignments
- **role_permissions** - Role-to-permission assignments
- **tenant_trust** - Cross-tenant trust relationships
- **sessions** - JWT refresh token storage
- **audit_logs** - Authorization decision audit trail

### Key Features

1. **UUID Primary Keys** - All tables use UUID for primary keys
2. **Foreign Key Constraints** - Referential integrity enforced
3. **Unique Constraints** - Prevent duplicate records
4. **Indexes** - Optimized for multi-tenant queries
5. **Row-Level Security** - Automatic tenant data isolation
6. **Cascading Deletes** - Automatic cleanup of related records

## Usage

### Import Configuration

```javascript
const db = require('./database/config');
```

### Query with Tenant Context

```javascript
// Automatically applies RLS policy
const result = await db.queryWithTenantContext(
  tenantId,
  'SELECT * FROM users WHERE email = $1',
  ['user@example.com']
);
```

### Query without Tenant Context

```javascript
// For system-level operations (bypasses RLS)
const result = await db.queryWithoutTenantContext(
  'SELECT * FROM issuers WHERE name = $1',
  ['Acme Corp']
);
```

### Transactions

```javascript
const client = await db.beginTransaction(tenantId);
try {
  await client.query('INSERT INTO users ...');
  await client.query('INSERT INTO user_roles ...');
  await db.commitTransaction(client);
} catch (error) {
  await db.rollbackTransaction(client);
  throw error;
}
```

## Row-Level Security

RLS policies automatically filter queries based on the `app.current_tenant_id` session variable. This ensures:

- Users can only see data from their own tenant
- No application code changes needed for tenant isolation
- Defense-in-depth security layer

### Tables with RLS

- tenants
- users
- roles
- permissions
- user_roles
- role_permissions
- audit_logs

### Tables without RLS

- issuers (system-level)
- tenant_trust (needs cross-tenant visibility)
- sessions (managed by auth service)

## Performance Considerations

### Connection Pooling

The configuration uses connection pooling with:
- Minimum 10 connections
- Maximum 50 connections
- 5-second connection timeout
- 30-second idle timeout

### Indexes

All multi-tenant tables have indexes on:
- `tenant_id` for filtering
- Composite indexes on `(tenant_id, user_id)` and `(tenant_id, role_id)`
- Foreign key columns for join performance

## Security Notes

1. Always use parameterized queries to prevent SQL injection
2. Set tenant context before executing queries
3. Use transactions for multi-step operations
4. Enable SSL in production environments
5. Rotate database credentials regularly
6. Monitor audit logs for suspicious activity

## Maintenance

### Backup

```bash
pg_dump rbac_system > backup.sql
```

### Restore

```bash
psql rbac_system < backup.sql
```

### Cleanup Old Audit Logs

Audit logs older than 90 days should be archived or deleted:

```sql
DELETE FROM audit_logs WHERE timestamp < NOW() - INTERVAL '90 days';
```
