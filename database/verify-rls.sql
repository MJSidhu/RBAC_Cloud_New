-- Verification Script for Row-Level Security Policies
-- This script verifies that RLS is properly configured on all multi-tenant tables

-- Check RLS is enabled on required tables
SELECT 
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'tenants', 'users', 'roles', 'permissions', 
    'user_roles', 'role_permissions', 'audit_logs'
  )
ORDER BY tablename;

-- Check RLS is NOT enabled on excluded tables
SELECT 
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('tenant_trust', 'sessions', 'issuers')
ORDER BY tablename;

-- List all RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Verify policy expressions match the required pattern
-- Expected: (tenant_id = (current_setting('app.current_tenant_id'::text))::uuid)
SELECT 
  tablename,
  policyname,
  qual AS using_expression,
  CASE 
    WHEN qual LIKE '%tenant_id%current_setting%app.current_tenant_id%uuid%' 
    THEN 'CORRECT'
    ELSE 'INCORRECT'
  END AS policy_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'tenants', 'users', 'roles', 'permissions', 
    'user_roles', 'role_permissions', 'audit_logs'
  )
ORDER BY tablename;
