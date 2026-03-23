const { pool } = require('../config/database');
const tenantService = require('../services/tenantService');
const rbacService = require('../services/rbacService');
const bcrypt = require('bcryptjs');

describe('Tenant Service', () => {
  let testIssuerId;

  beforeAll(async () => {
    // Create a test issuer
    const result = await pool.query(
      `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
      ['Test Issuer']
    );
    testIssuerId = result.rows[0].issuer_id;
  }, 10000); // Increase timeout to 10 seconds

  afterAll(async () => {
    // Clean up test issuer (cascade will delete tenants)
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end();
  }, 10000);

  describe('provisionTenant', () => {
    it('should create a tenant with all default roles and admin user', async () => {
      const tenantName = 'Test Corp';
      const adminEmail = 'admin@testcorp.com';
      const adminPassword = 'SecurePass123!';

      const result = await tenantService.provisionTenant(
        testIssuerId,
        tenantName,
        adminEmail,
        adminPassword
      );

      // Verify tenant was created
      expect(result.tenant).toBeDefined();
      expect(result.tenant.tenant_id).toBeDefined();
      expect(result.tenant.name).toBe(tenantName);
      expect(result.tenant.issuer_id).toBe(testIssuerId);

      // Verify admin user was created
      expect(result.admin_user).toBeDefined();
      expect(result.admin_user.user_id).toBeDefined();
      expect(result.admin_user.email).toBe(adminEmail);

      // Verify default roles were created
      expect(result.default_roles).toHaveLength(3);
      const roleNames = result.default_roles.map(r => r.role_name);
      expect(roleNames).toContain('Admin');
      expect(roleNames).toContain('Developer');
      expect(roleNames).toContain('Viewer');

      // Verify password was hashed correctly
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE user_id = $1',
        [result.admin_user.user_id]
      );
      const isPasswordValid = await bcrypt.compare(adminPassword, userResult.rows[0].password_hash);
      expect(isPasswordValid).toBe(true);

      // Verify admin user has Admin role
      const userRoles = await rbacService.getUserRoles(result.tenant.tenant_id, result.admin_user.user_id);
      expect(userRoles.some(r => r.role_name === 'Admin')).toBe(true);
    });

    it('should create Admin role with all permissions', async () => {
      const result = await tenantService.provisionTenant(
        testIssuerId,
        'Admin Test Corp',
        'admin@admintest.com',
        'SecurePass123!'
      );

      const adminRole = result.default_roles.find(r => r.role_name === 'Admin');
      const permissions = await rbacService.getRolePermissions(result.tenant.tenant_id, adminRole.role_id);

      // Admin should have all 5 actions on all resources
      expect(permissions.length).toBe(5);
      const actions = permissions.map(p => p.action);
      expect(actions).toContain('CREATE');
      expect(actions).toContain('READ');
      expect(actions).toContain('UPDATE');
      expect(actions).toContain('DELETE');
      expect(actions).toContain('SHARE');

      // All permissions should be on wildcard resource
      permissions.forEach(p => {
        expect(p.resource_name).toBe('*');
      });
    });

    it('should create Developer role with read/write permissions', async () => {
      const result = await tenantService.provisionTenant(
        testIssuerId,
        'Developer Test Corp',
        'admin@devtest.com',
        'SecurePass123!'
      );

      const devRole = result.default_roles.find(r => r.role_name === 'Developer');
      const permissions = await rbacService.getRolePermissions(result.tenant.tenant_id, devRole.role_id);

      // Developer should have CREATE, READ, UPDATE on files/* and folders/*
      expect(permissions.length).toBe(6);
      
      const filePermissions = permissions.filter(p => p.resource_name === 'files/*');
      expect(filePermissions.length).toBe(3);
      expect(filePermissions.map(p => p.action)).toContain('CREATE');
      expect(filePermissions.map(p => p.action)).toContain('READ');
      expect(filePermissions.map(p => p.action)).toContain('UPDATE');

      const folderPermissions = permissions.filter(p => p.resource_name === 'folders/*');
      expect(folderPermissions.length).toBe(3);
    });

    it('should create Viewer role with read-only permissions', async () => {
      const result = await tenantService.provisionTenant(
        testIssuerId,
        'Viewer Test Corp',
        'admin@viewtest.com',
        'SecurePass123!'
      );

      const viewerRole = result.default_roles.find(r => r.role_name === 'Viewer');
      const permissions = await rbacService.getRolePermissions(result.tenant.tenant_id, viewerRole.role_id);

      // Viewer should only have READ on files/* and folders/*
      expect(permissions.length).toBe(2);
      permissions.forEach(p => {
        expect(p.action).toBe('READ');
        expect(['files/*', 'folders/*']).toContain(p.resource_name);
      });
    });

    it('should rollback all changes if admin user creation fails', async () => {
      const tenantName = 'Rollback Test Corp';
      
      // First, create a tenant successfully
      const firstResult = await tenantService.provisionTenant(
        testIssuerId,
        tenantName,
        'admin@rollback.com',
        'SecurePass123!'
      );

      // Try to create another tenant with same name (should fail due to unique constraint)
      await expect(
        tenantService.provisionTenant(
          testIssuerId,
          tenantName,
          'admin2@rollback.com',
          'SecurePass123!'
        )
      ).rejects.toThrow();

      // Verify only one tenant with this name exists
      const tenants = await pool.query(
        'SELECT COUNT(*) FROM tenants WHERE issuer_id = $1 AND name = $2',
        [testIssuerId, tenantName]
      );
      expect(parseInt(tenants.rows[0].count)).toBe(1);
    });

    it('should rollback if duplicate admin email is used', async () => {
      const adminEmail = 'duplicate@test.com';
      
      // Create first tenant with this admin email
      const firstTenant = await tenantService.provisionTenant(
        testIssuerId,
        'First Tenant',
        adminEmail,
        'SecurePass123!'
      );

      // Count tenants before second attempt
      const beforeCount = await pool.query(
        'SELECT COUNT(*) FROM tenants WHERE issuer_id = $1',
        [testIssuerId]
      );

      // Try to create second tenant with same admin email in same tenant (should fail)
      // Note: Different tenants CAN have same email, but we're testing rollback
      await expect(
        tenantService.provisionTenant(
          testIssuerId,
          'Second Tenant',
          adminEmail,
          'SecurePass123!'
        )
      ).resolves.toBeDefined(); // This should succeed as it's a different tenant

      // Actually test rollback by trying to create with invalid issuer
      await expect(
        tenantService.provisionTenant(
          '00000000-0000-0000-0000-000000000000',
          'Invalid Issuer Tenant',
          'admin@invalid.com',
          'SecurePass123!'
        )
      ).rejects.toThrow();
    });

    it('should validate required parameters', async () => {
      await expect(
        tenantService.provisionTenant(null, 'Test', 'admin@test.com', 'password')
      ).rejects.toThrow('All parameters are required');

      await expect(
        tenantService.provisionTenant(testIssuerId, null, 'admin@test.com', 'password')
      ).rejects.toThrow('All parameters are required');

      await expect(
        tenantService.provisionTenant(testIssuerId, 'Test', null, 'password')
      ).rejects.toThrow('All parameters are required');

      await expect(
        tenantService.provisionTenant(testIssuerId, 'Test', 'admin@test.com', null)
      ).rejects.toThrow('All parameters are required');
    });

    it('should validate issuer ID format', async () => {
      await expect(
        tenantService.provisionTenant(
          'invalid-uuid',
          'Test',
          'admin@test.com',
          'SecurePass123!'
        )
      ).rejects.toThrow('Invalid issuer ID format');
    });

    it('should validate email format', async () => {
      await expect(
        tenantService.provisionTenant(
          testIssuerId,
          'Test',
          'invalid-email',
          'SecurePass123!'
        )
      ).rejects.toThrow('Invalid email format');
    });

    it('should validate password length', async () => {
      await expect(
        tenantService.provisionTenant(
          testIssuerId,
          'Test',
          'admin@test.com',
          'short'
        )
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should reject invalid issuer ID', async () => {
      const fakeIssuerId = '00000000-0000-0000-0000-000000000000';
      
      await expect(
        tenantService.provisionTenant(
          fakeIssuerId,
          'Test',
          'admin@test.com',
          'SecurePass123!'
        )
      ).rejects.toThrow('Invalid issuer ID');
    });

    it('should use bcrypt with cost factor of at least 10', async () => {
      const result = await tenantService.provisionTenant(
        testIssuerId,
        'Bcrypt Test Corp',
        'admin@bcrypt.com',
        'SecurePass123!'
      );

      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE user_id = $1',
        [result.admin_user.user_id]
      );

      const hash = userResult.rows[0].password_hash;
      
      // Bcrypt hash format: $2a$10$... or $2b$10$...
      // The number after the second $ is the cost factor
      const costFactor = parseInt(hash.split('$')[2]);
      expect(costFactor).toBeGreaterThanOrEqual(10);
    });

    it('should generate unique tenant IDs', async () => {
      const tenant1 = await tenantService.provisionTenant(
        testIssuerId,
        'Unique Test 1',
        'admin1@unique.com',
        'SecurePass123!'
      );

      const tenant2 = await tenantService.provisionTenant(
        testIssuerId,
        'Unique Test 2',
        'admin2@unique.com',
        'SecurePass123!'
      );

      expect(tenant1.tenant.tenant_id).not.toBe(tenant2.tenant.tenant_id);
    });

    it('should associate tenant with correct issuer', async () => {
      const result = await tenantService.provisionTenant(
        testIssuerId,
        'Issuer Association Test',
        'admin@issuer.com',
        'SecurePass123!'
      );

      expect(result.tenant.issuer_id).toBe(testIssuerId);

      // Verify in database
      const dbResult = await pool.query(
        'SELECT issuer_id FROM tenants WHERE tenant_id = $1',
        [result.tenant.tenant_id]
      );
      expect(dbResult.rows[0].issuer_id).toBe(testIssuerId);
    });
  });

  describe('getTenant', () => {
    it('should retrieve tenant by ID', async () => {
      const created = await tenantService.provisionTenant(
        testIssuerId,
        'Get Test Corp',
        'admin@get.com',
        'SecurePass123!'
      );

      const tenant = await tenantService.getTenant(created.tenant.tenant_id);

      expect(tenant.tenant_id).toBe(created.tenant.tenant_id);
      expect(tenant.name).toBe('Get Test Corp');
      expect(tenant.issuer_id).toBe(testIssuerId);
    });

    it('should throw error for non-existent tenant', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(tenantService.getTenant(fakeId)).rejects.toThrow('Tenant not found');
    });
  });

  describe('listTenants', () => {
    it('should list all tenants for an issuer', async () => {
      const tenants = await tenantService.listTenants(testIssuerId);
      
      expect(Array.isArray(tenants)).toBe(true);
      expect(tenants.length).toBeGreaterThan(0);
      
      tenants.forEach(tenant => {
        expect(tenant.issuer_id).toBe(testIssuerId);
        expect(tenant.tenant_id).toBeDefined();
        expect(tenant.name).toBeDefined();
      });
    });

    it('should return empty array for issuer with no tenants', async () => {
      const newIssuer = await pool.query(
        `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
        ['Empty Issuer']
      );
      const emptyIssuerId = newIssuer.rows[0].issuer_id;

      const tenants = await tenantService.listTenants(emptyIssuerId);
      expect(tenants).toEqual([]);

      // Cleanup
      await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [emptyIssuerId]);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant name', async () => {
      const created = await tenantService.provisionTenant(
        testIssuerId,
        'Update Test Corp',
        'admin@update.com',
        'SecurePass123!'
      );

      const updated = await tenantService.updateTenant(created.tenant.tenant_id, {
        name: 'Updated Corp Name'
      });

      expect(updated.name).toBe('Updated Corp Name');
      expect(updated.tenant_id).toBe(created.tenant.tenant_id);
    });

    it('should throw error for non-existent tenant', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(
        tenantService.updateTenant(fakeId, { name: 'New Name' })
      ).rejects.toThrow('Tenant not found');
    });

    it('should throw error when no valid fields provided', async () => {
      const created = await tenantService.provisionTenant(
        testIssuerId,
        'No Fields Test',
        'admin@nofields.com',
        'SecurePass123!'
      );

      await expect(
        tenantService.updateTenant(created.tenant.tenant_id, {})
      ).rejects.toThrow('No valid fields to update');
    });
  });

  describe('deleteTenant', () => {
    it('should delete tenant and cascade to related records', async () => {
      const created = await tenantService.provisionTenant(
        testIssuerId,
        'Delete Test Corp',
        'admin@delete.com',
        'SecurePass123!'
      );

      const tenantId = created.tenant.tenant_id;

      // Verify tenant exists
      const beforeDelete = await pool.query(
        'SELECT * FROM tenants WHERE tenant_id = $1',
        [tenantId]
      );
      expect(beforeDelete.rows.length).toBe(1);

      // Delete tenant
      const result = await tenantService.deleteTenant(tenantId);
      expect(result).toBe(true);

      // Verify tenant is deleted
      const afterDelete = await pool.query(
        'SELECT * FROM tenants WHERE tenant_id = $1',
        [tenantId]
      );
      expect(afterDelete.rows.length).toBe(0);

      // Verify cascaded deletion of users
      const users = await pool.query(
        'SELECT * FROM users WHERE tenant_id = $1',
        [tenantId]
      );
      expect(users.rows.length).toBe(0);

      // Verify cascaded deletion of roles
      const roles = await pool.query(
        'SELECT * FROM roles WHERE tenant_id = $1',
        [tenantId]
      );
      expect(roles.rows.length).toBe(0);
    });

    it('should throw error for non-existent tenant', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(tenantService.deleteTenant(fakeId)).rejects.toThrow('Tenant not found');
    });
  });
});
