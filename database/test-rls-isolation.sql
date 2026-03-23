-- Test Script for Row-Level Security Isolation
-- This script tests that RLS policies properly isolate tenant data

-- Setup: Create test data for two tenants
BEGIN;

-- Create issuer
INSERT INTO issuers (issuer_id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Issuer');

-- Create two tenants
INSERT INTO tenants (tenant_id, issuer_id, name) 
VALUES 
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Tenant A'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Tenant B');

-- Create users for each tenant
INSERT INTO users (user_id, tenant_id, email, password_hash)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'user-a@tenant-a.com', 'hash_a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'user-b@tenant-b.com', 'hash_b');

-- Create roles for each tenant
INSERT INTO roles (role_id, tenant_id, role_name)
VALUES
  ('aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Admin-A'),
  ('bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Admin-B');

-- Create permissions for each tenant
INSERT INTO permissions (permission_id, tenant_id, resource_name, action)
VALUES
  ('aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'files/*', 'READ'),
  ('bbbb0002-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'files/*', 'READ');

-- Create user_roles for each tenant
INSERT INTO user_roles (user_id, role_id, tenant_id)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

-- Create role_permissions for each tenant
INSERT INTO role_permissions (role_id, permission_id, tenant_id)
VALUES
  ('aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbb0001-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbb0002-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

-- Create audit logs for each tenant
INSERT INTO audit_logs (log_id, user_id, tenant_id, resource, action, decision)
VALUES
  ('aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'files/1', 'READ', 'ALLOW'),
  ('bbbb0003-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'files/2', 'READ', 'ALLOW');

COMMIT;

-- Test 1: Set context to Tenant A and verify isolation
\echo '=== Test 1: Tenant A Context ==='
SET app.current_tenant_id = '11111111-1111-1111-1111-111111111111';

\echo 'Tenants visible to Tenant A (should be 1):'
SELECT tenant_id, name FROM tenants;

\echo 'Users visible to Tenant A (should be 1):'
SELECT user_id, email FROM users;

\echo 'Roles visible to Tenant A (should be 1):'
SELECT role_id, role_name FROM roles;

\echo 'Permissions visible to Tenant A (should be 1):'
SELECT permission_id, resource_name, action FROM permissions;

\echo 'User roles visible to Tenant A (should be 1):'
SELECT user_id, role_id FROM user_roles;

\echo 'Role permissions visible to Tenant A (should be 1):'
SELECT role_id, permission_id FROM role_permissions;

\echo 'Audit logs visible to Tenant A (should be 1):'
SELECT log_id, resource, decision FROM audit_logs;

-- Test 2: Set context to Tenant B and verify isolation
\echo '=== Test 2: Tenant B Context ==='
SET app.current_tenant_id = '22222222-2222-2222-2222-222222222222';

\echo 'Tenants visible to Tenant B (should be 1):'
SELECT tenant_id, name FROM tenants;

\echo 'Users visible to Tenant B (should be 1):'
SELECT user_id, email FROM users;

\echo 'Roles visible to Tenant B (should be 1):'
SELECT role_id, role_name FROM roles;

\echo 'Permissions visible to Tenant B (should be 1):'
SELECT permission_id, resource_name, action FROM permissions;

\echo 'User roles visible to Tenant B (should be 1):'
SELECT user_id, role_id FROM user_roles;

\echo 'Role permissions visible to Tenant B (should be 1):'
SELECT role_id, permission_id FROM role_permissions;

\echo 'Audit logs visible to Tenant B (should be 1):'
SELECT log_id, resource, decision FROM audit_logs;

-- Test 3: Verify tenant_trust does NOT have RLS (should see all records)
\echo '=== Test 3: Tenant Trust Cross-Tenant Visibility ==='

-- Create trust relationship
INSERT INTO tenant_trust (trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

\echo 'Trust relationships visible (should see all, no RLS):'
SELECT trust_id, truster_tenant_id, trustee_tenant_id FROM tenant_trust;

-- Test 4: Verify sessions does NOT have RLS
\echo '=== Test 4: Sessions Cross-Tenant Visibility ==='

-- Create sessions for both tenants
INSERT INTO sessions (session_id, user_id, tenant_id, refresh_token_hash, expires_at)
VALUES 
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'hash_session_a', NOW() + INTERVAL '7 days'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'hash_session_b', NOW() + INTERVAL '7 days');

\echo 'Sessions visible (should see all, no RLS):'
SELECT session_id, user_id, tenant_id FROM sessions;

-- Test 5: Verify issuers does NOT have RLS
\echo '=== Test 5: Issuers System-Level Visibility ==='
\echo 'Issuers visible (should see all, no RLS):'
SELECT issuer_id, name FROM issuers;

-- Cleanup
\echo '=== Cleanup ==='
BEGIN;
DELETE FROM sessions;
DELETE FROM tenant_trust;
DELETE FROM audit_logs;
DELETE FROM role_permissions;
DELETE FROM user_roles;
DELETE FROM permissions;
DELETE FROM roles;
DELETE FROM users;
DELETE FROM tenants;
DELETE FROM issuers;
COMMIT;

\echo '=== RLS Isolation Tests Complete ==='
