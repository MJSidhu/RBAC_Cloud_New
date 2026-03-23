-- Row-Level Security Policies for Multi-Tenant Isolation
-- These policies ensure automatic data isolation per tenant

-- Enable RLS on multi-tenant tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy for tenants
CREATE POLICY tenant_isolation_policy ON tenants
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for users
CREATE POLICY tenant_isolation_policy ON users
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for roles
CREATE POLICY tenant_isolation_policy ON roles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for permissions
CREATE POLICY tenant_isolation_policy ON permissions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for user_roles
CREATE POLICY tenant_isolation_policy ON user_roles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for role_permissions
CREATE POLICY tenant_isolation_policy ON role_permissions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- RLS Policy for audit_logs
CREATE POLICY tenant_isolation_policy ON audit_logs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Note: tenant_trust table does NOT have RLS as it needs cross-tenant visibility
-- Note: sessions table does NOT have RLS as it's managed by authentication service
-- Note: issuers table does NOT have RLS as it's a system-level table
