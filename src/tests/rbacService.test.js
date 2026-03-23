/**
 * RBAC Service Tests
 * 
 * Tests for role management operations (Task 5.1)
 * Requirements: 3.1, 9.3, 9.5
 */

const { pool } = require('../config/database');

// Import functions directly since module.exports might not be set up yet
const rbacService = require('../services/rbacService');

describe('RBAC Service - Role Management (Task 5.1)', () => {
  let testTenantId;
  let testIssuerId;

  beforeAll(async () => {
    // Create a test issuer and tenant
    const issuerResult = await pool.query(
      'INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id',
      ['Test Issuer']
    );
    testIssuerId = issuerResult.rows[0].issuer_id;

    const tenantResult = await pool.query(
      'INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id',
      [testIssuerId, 'Test Tenant']
    );
    testTenantId = tenantResult.rows[0].tenant_id;

    // Set RLS context
    await pool.query(`SET app.current_tenant_id = '${testTenantId}'`);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end();
  });

  describe('createRole', () => {
    test('should create a role without parent', async () => {
      const role = await rbacService.createRole(testTenantId, 'TestRole1');
      
      expect(role).toBeDefined();
      expect(role.role_id).toBeDefined();
      expect(role.tenant_id).toBe(testTenantId);
      expect(role.role_name).toBe('TestRole1');
      expect(role.parent_role_id).toBeNull();
      expect(role.created_at).toBeDefined();
    });

    test('should create a role with parent', async () => {
      const parentRole = await rbacService.createRole(testTenantId, 'ParentRole');
      const childRole = await rbacService.createRole(testTenantId, 'ChildRole', parentRole.role_id);
      
      expect(childRole).toBeDefined();
      expect(childRole.parent_role_id).toBe(parentRole.role_id);
    });

    test('should reject duplicate role name in same tenant', async () => {
      await rbacService.createRole(testTenantId, 'DuplicateRole');
      
      await expect(
        rbacService.createRole(testTenantId, 'DuplicateRole')
      ).rejects.toThrow('already exists');
    });

    test('should reject role hierarchy exceeding depth limit', async () => {
      // Create a 6-level hierarchy (depths 0-5, which is the maximum)
      let parentId = null;
      const roles = [];
      for (let i = 0; i < 6; i++) {
        const role = await rbacService.createRole(testTenantId, `DepthLimit${i}_${Date.now()}`, parentId);
        roles.push(role);
        parentId = role.role_id;
      }
      
      // Attempt to create 7th level (depth 6) should fail
      await expect(
        rbacService.createRole(testTenantId, `DepthLimit7_${Date.now()}`, parentId)
      ).rejects.toThrow('depth cannot exceed 5 levels');
    }, 15000);
  });

  describe('getRole', () => {
    test('should retrieve an existing role', async () => {
      const created = await rbacService.createRole(testTenantId, 'GetTestRole');
      const retrieved = await rbacService.getRole(testTenantId, created.role_id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.role_id).toBe(created.role_id);
      expect(retrieved.role_name).toBe('GetTestRole');
    });

    test('should return null for non-existent role', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const result = await rbacService.getRole(testTenantId, fakeId);
      
      expect(result).toBeNull();
    });
  });

  describe('listRoles', () => {
    test('should list all roles for a tenant', async () => {
      // Create a few roles
      await rbacService.createRole(testTenantId, 'ListRole1');
      await rbacService.createRole(testTenantId, 'ListRole2');
      await rbacService.createRole(testTenantId, 'ListRole3');
      
      const roles = await rbacService.listRoles(testTenantId);
      
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.length).toBeGreaterThanOrEqual(3);
      
      const roleNames = roles.map(r => r.role_name);
      expect(roleNames).toContain('ListRole1');
      expect(roleNames).toContain('ListRole2');
      expect(roleNames).toContain('ListRole3');
    });
  });

  describe('updateRole', () => {
    test('should update role name', async () => {
      const role = await rbacService.createRole(testTenantId, 'OldName');
      const updated = await rbacService.updateRole(testTenantId, role.role_id, {
        roleName: 'NewName'
      });
      
      expect(updated.role_name).toBe('NewName');
    });

    test('should update parent role', async () => {
      const parent = await rbacService.createRole(testTenantId, 'NewParent');
      const child = await rbacService.createRole(testTenantId, 'UpdateChild');
      
      const updated = await rbacService.updateRole(testTenantId, child.role_id, {
        parentRoleId: parent.role_id
      });
      
      expect(updated.parent_role_id).toBe(parent.role_id);
    });

    test('should reject circular hierarchy', async () => {
      const roleA = await rbacService.createRole(testTenantId, 'CircularA');
      const roleB = await rbacService.createRole(testTenantId, 'CircularB', roleA.role_id);
      
      // Try to make roleA a child of roleB (creating a cycle)
      await expect(
        rbacService.updateRole(testTenantId, roleA.role_id, {
          parentRoleId: roleB.role_id
        })
      ).rejects.toThrow('circular');
    });

    test('should reject role being its own parent', async () => {
      const role = await rbacService.createRole(testTenantId, 'SelfParent');
      
      await expect(
        rbacService.updateRole(testTenantId, role.role_id, {
          parentRoleId: role.role_id
        })
      ).rejects.toThrow('cannot be its own parent');
    });
  });

  describe('deleteRole', () => {
    test('should delete an existing role', async () => {
      const role = await rbacService.createRole(testTenantId, 'DeleteMe');
      const result = await rbacService.deleteRole(testTenantId, role.role_id);
      
      expect(result).toBe(true);
      
      // Verify it's deleted
      const retrieved = await rbacService.getRole(testTenantId, role.role_id);
      expect(retrieved).toBeNull();
    });

    test('should throw error when deleting non-existent role', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      
      await expect(
        rbacService.deleteRole(testTenantId, fakeId)
      ).rejects.toThrow('not found');
    });
  });

  describe('validateRoleHierarchy', () => {
    test('should validate valid hierarchy', async () => {
      const parent = await rbacService.createRole(testTenantId, 'ValidParent');
      
      // Should not throw
      await expect(
        rbacService.validateRoleHierarchy(testTenantId, parent.role_id)
      ).resolves.not.toThrow();
    });

    test('should detect circular hierarchy', async () => {
      const roleX = await rbacService.createRole(testTenantId, 'RoleX');
      const roleY = await rbacService.createRole(testTenantId, 'RoleY', roleX.role_id);
      
      // Try to make roleX a child of roleY
      await expect(
        rbacService.validateRoleHierarchy(testTenantId, roleY.role_id, roleX.role_id)
      ).rejects.toThrow('circular');
    });

    test('should enforce depth limit', async () => {
      // Create a 6-level hierarchy (depths 0-5, which is the maximum)
      let parentId = null;
      const roles = [];
      for (let i = 0; i < 6; i++) {
        const role = await rbacService.createRole(testTenantId, `ValidateDepth${i}_${Date.now()}`, parentId);
        roles.push(role);
        parentId = role.role_id;
      }
      
      // Validation should fail for adding another level (would be depth 6)
      await expect(
        rbacService.validateRoleHierarchy(testTenantId, parentId)
      ).rejects.toThrow('depth cannot exceed 5 levels');
    }, 15000);
  });
});
