/**
 * Trust Relationship Integration Tests
 * 
 * Tests for Task 6.3: Integrate trust roles into effective permissions
 * Validates that getEffectivePermissions includes permissions from trust relationships
 * Requirements: 5.2
 */

const { pool } = require('../config/database');
const rbacService = require('../services/rbacService');
const trustService = require('../services/trustService');
const { permissionCache } = require('../services/permissionCache');

describe('Trust Integration - Effective Permissions (Task 6.3)', () => {
  let issuerA, issuerB;
  let tenantA, tenantB;
  let userA, userB;
  let roleA, roleB;
  let permissionA1, permissionA2, permissionB1;

  beforeAll(async () => {
    // Create two issuers
    const issuerAResult = await pool.query(
      'INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id',
      ['Issuer A']
    );
    issuerA = issuerAResult.rows[0].issuer_id;

    const issuerBResult = await pool.query(
      'INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id',
      ['Issuer B']
    );
    issuerB = issuerBResult.rows[0].issuer_id;

    // Create two tenants
    const tenantAResult = await pool.query(
      'INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id',
      [issuerA, 'Tenant A']
    );
    tenantA = tenantAResult.rows[0].tenant_id;

    const tenantBResult = await pool.query(
      'INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id',
      [issuerB, 'Tenant B']
    );
    tenantB = tenantBResult.rows[0].tenant_id;

    // Create users in each tenant
    await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
    const userAResult = await pool.query(
      'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id',
      [tenantA, 'userA@example.com', 'hash']
    );
    userA = userAResult.rows[0].user_id;

    await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
    const userBResult = await pool.query(
      'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id',
      [tenantB, 'userB@example.com', 'hash']
    );
    userB = userBResult.rows[0].user_id;

    // Create roles in each tenant
    await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
    roleA = await rbacService.createRole(tenantA, 'Admin');

    await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
    roleB = await rbacService.createRole(tenantB, 'Developer');

    // Create permissions in tenant A
    await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
    permissionA1 = await rbacService.createPermission(tenantA, 'files/*', 'READ');
    permissionA2 = await rbacService.createPermission(tenantA, 'files/*', 'UPDATE');

    // Create permission in tenant B
    await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
    permissionB1 = await rbacService.createPermission(tenantB, 'docs/*', 'READ');

    // Assign permissions to roles
    await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
    await rbacService.assignPermissionToRole(tenantA, roleA.role_id, permissionA1.permission_id);
    await rbacService.assignPermissionToRole(tenantA, roleA.role_id, permissionA2.permission_id);

    await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
    await rbacService.assignPermissionToRole(tenantB, roleB.role_id, permissionB1.permission_id);

    // Assign roles to users
    await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
    await rbacService.assignRoleToUser(tenantB, userB, roleB.role_id);
  }, 15000);

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM tenants WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
    await pool.query('DELETE FROM issuers WHERE issuer_id IN ($1, $2)', [issuerA, issuerB]);
  }, 10000);

  describe('getEffectivePermissions with trust relationships', () => {
    beforeEach(() => {
      // Clear cache before each test
      permissionCache.clear();
    });

    test('should include permissions from trust roles when trust is active', async () => {
      // Create trust relationship: Tenant A trusts Tenant B with roleA
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      // Get effective permissions for userB (from tenant B)
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const permissions = await rbacService.getEffectivePermissions(userB, tenantB);

      // Should have permissions from both roleB (direct) and roleA (trust)
      expect(permissions.length).toBeGreaterThanOrEqual(3);

      const resourceActions = permissions.map(p => `${p.resource_name}:${p.action}`);
      
      // Direct permissions from roleB
      expect(resourceActions).toContain('docs/*:READ');
      
      // Trust permissions from roleA
      expect(resourceActions).toContain('files/*:READ');
      expect(resourceActions).toContain('files/*:UPDATE');

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });

    test('should not include permissions from deactivated trust relationships', async () => {
      // Create and then deactivate trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      await trustService.deactivateTrust(trust.trust_id);

      // Get effective permissions for userB
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const permissions = await rbacService.getEffectivePermissions(userB, tenantB);

      const resourceActions = permissions.map(p => `${p.resource_name}:${p.action}`);
      
      // Should only have direct permissions from roleB
      expect(resourceActions).toContain('docs/*:READ');
      
      // Should NOT have trust permissions from roleA
      expect(resourceActions).not.toContain('files/*:READ');
      expect(resourceActions).not.toContain('files/*:UPDATE');

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });

    test('should include permissions when trust is reactivated', async () => {
      // Create, deactivate, then reactivate trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      await trustService.deactivateTrust(trust.trust_id);
      await trustService.activateTrust(trust.trust_id);

      // Get effective permissions for userB
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const permissions = await rbacService.getEffectivePermissions(userB, tenantB);

      const resourceActions = permissions.map(p => `${p.resource_name}:${p.action}`);
      
      // Should have permissions from both roleB and roleA again
      expect(resourceActions).toContain('docs/*:READ');
      expect(resourceActions).toContain('files/*:READ');
      expect(resourceActions).toContain('files/*:UPDATE');

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });

    test('should handle multiple trust relationships', async () => {
      // Create another role in tenant A with different permissions
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const roleA2 = await rbacService.createRole(tenantA, 'Viewer');
      const permissionA3 = await rbacService.createPermission(tenantA, 'reports/*', 'READ');
      await rbacService.assignPermissionToRole(tenantA, roleA2.role_id, permissionA3.permission_id);

      // Create two trust relationships
      const trust1 = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      const trust2 = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA2.role_id
      );

      // Get effective permissions for userB
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const permissions = await rbacService.getEffectivePermissions(userB, tenantB);

      const resourceActions = permissions.map(p => `${p.resource_name}:${p.action}`);
      
      // Should have permissions from roleB, roleA, and roleA2
      expect(resourceActions).toContain('docs/*:READ');
      expect(resourceActions).toContain('files/*:READ');
      expect(resourceActions).toContain('files/*:UPDATE');
      expect(resourceActions).toContain('reports/*:READ');

      // Clean up
      await trustService.deleteTrustRelationship(trust1.trust_id);
      await trustService.deleteTrustRelationship(trust2.trust_id);
      await rbacService.deleteRole(tenantA, roleA2.role_id);
    });

    test('should handle user with no direct roles but trust roles', async () => {
      // Create a new user in tenant B without any direct roles
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const userCResult = await pool.query(
        'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id',
        [tenantB, 'userC@example.com', 'hash']
      );
      const userC = userCResult.rows[0].user_id;

      // Create trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      // Get effective permissions for userC (no direct roles, only trust)
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const permissions = await rbacService.getEffectivePermissions(userC, tenantB);

      const resourceActions = permissions.map(p => `${p.resource_name}:${p.action}`);
      
      // Should have permissions from trust role only
      expect(resourceActions).toContain('files/*:READ');
      expect(resourceActions).toContain('files/*:UPDATE');
      expect(resourceActions).not.toContain('docs/*:READ');

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
      await pool.query('DELETE FROM users WHERE user_id = $1', [userC]);
    });
  });

  describe('getTrustRoles function', () => {
    beforeEach(() => {
      // Clear cache before each test
      permissionCache.clear();
    });

    test('should return exposed roles from active trust relationships', async () => {
      // Create trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      // Get trust roles for tenant B
      const trustRoles = await rbacService.getTrustRoles(userB, tenantB);

      expect(trustRoles.length).toBeGreaterThanOrEqual(1);
      const roleIds = trustRoles.map(r => r.role_id);
      expect(roleIds).toContain(roleA.role_id);

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });

    test('should return empty array when no trust relationships exist', async () => {
      const trustRoles = await rbacService.getTrustRoles(userB, tenantB);
      expect(Array.isArray(trustRoles)).toBe(true);
      expect(trustRoles.length).toBe(0);
    });

    test('should not return roles from inactive trust relationships', async () => {
      // Create and deactivate trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      await trustService.deactivateTrust(trust.trust_id);

      // Get trust roles for tenant B
      const trustRoles = await rbacService.getTrustRoles(userB, tenantB);

      const roleIds = trustRoles.map(r => r.role_id);
      expect(roleIds).not.toContain(roleA.role_id);

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });
  });

  describe('hasPermission with trust relationships', () => {
    beforeEach(() => {
      // Clear cache before each test
      permissionCache.clear();
    });

    test('should return true for permissions granted through trust', async () => {
      // Create trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      // Check if userB has permission from trust role
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const hasReadPermission = await rbacService.hasPermission(
        userB,
        tenantB,
        'files/document.txt',
        'READ'
      );

      const hasUpdatePermission = await rbacService.hasPermission(
        userB,
        tenantB,
        'files/document.txt',
        'UPDATE'
      );

      expect(hasReadPermission).toBe(true);
      expect(hasUpdatePermission).toBe(true);

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });

    test('should return false for permissions when trust is deactivated', async () => {
      // Create and deactivate trust relationship
      await pool.query(`SET app.current_tenant_id = '${tenantA}'`);
      const trust = await trustService.createTrustRelationship(
        tenantA,
        tenantB,
        roleA.role_id
      );

      await trustService.deactivateTrust(trust.trust_id);

      // Check if userB has permission (should not have it anymore)
      await pool.query(`SET app.current_tenant_id = '${tenantB}'`);
      const hasReadPermission = await rbacService.hasPermission(
        userB,
        tenantB,
        'files/document.txt',
        'READ'
      );

      expect(hasReadPermission).toBe(false);

      // Clean up
      await trustService.deleteTrustRelationship(trust.trust_id);
    });
  });
});
