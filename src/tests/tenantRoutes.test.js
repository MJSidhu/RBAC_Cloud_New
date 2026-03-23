/**
 * Tenant Management API Endpoint Tests
 * 
 * Tests for tenant creation, listing, updating, and deletion endpoints.
 * Requirements: 1.1, 11.1, 11.5
 */

const request = require('supertest');
const { pool } = require('../config/database');
const { hashPassword } = require('../utils/passwordUtils');
const { generateJWT } = require('../utils/jwtUtils');
const app = require('../server');

  describe('Tenant Management API Endpoints', () => {
  let testIssuerId;
  let testTenantId;
  let testUserId;
  let testRoleId;
  let testPermissionId;
  let accessToken;

  // Increase timeout for slow tenant provisioning operations
  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create test issuer
    const issuerResult = await pool.query(`
      INSERT INTO issuers (name)
      VALUES ('Test Issuer for Tenant Routes')
      RETURNING issuer_id
    `);
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(`
      INSERT INTO tenants (name, issuer_id)
      VALUES ('Test Tenant for Routes', $1)
      RETURNING tenant_id
    `, [testIssuerId]);
    testTenantId = tenantResult.rows[0].tenant_id;

    // Create test role
    const roleResult = await pool.query(`
      INSERT INTO roles (tenant_id, role_name)
      VALUES ($1, 'Admin')
      RETURNING role_id
    `, [testTenantId]);
    testRoleId = roleResult.rows[0].role_id;

    // Create permissions for tenant management
    const permissionResult = await pool.query(`
      INSERT INTO permissions (tenant_id, resource_name, action)
      VALUES 
        ($1, 'tenants', 'READ'),
        ($1, 'tenants', 'UPDATE'),
        ($1, 'tenants', 'DELETE')
      RETURNING permission_id
    `, [testTenantId]);
    testPermissionId = permissionResult.rows[0].permission_id;

    // Assign permissions to role
    await pool.query(`
      INSERT INTO role_permissions (role_id, permission_id, tenant_id)
      SELECT $1, permission_id, $2
      FROM permissions
      WHERE tenant_id = $2 AND resource_name = 'tenants'
    `, [testRoleId, testTenantId]);

    // Create test user
    const testEmail = `tenant-test-${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';
    const passwordHash = await hashPassword(testPassword);

    const userResult = await pool.query(`
      INSERT INTO users (tenant_id, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING user_id
    `, [testTenantId, testEmail, passwordHash]);
    testUserId = userResult.rows[0].user_id;

    // Assign role to user
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id, tenant_id)
      VALUES ($1, $2, $3)
    `, [testUserId, testRoleId, testTenantId]);

    // Generate JWT for authenticated requests
    accessToken = generateJWT({
      user_id: testUserId,
      tenant_id: testTenantId,
      role: 'Admin',
      email: testEmail
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (testUserId) {
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    }
    if (testRoleId) {
      await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [testRoleId]);
      await pool.query('DELETE FROM roles WHERE role_id = $1', [testRoleId]);
    }
    if (testTenantId) {
      await pool.query('DELETE FROM permissions WHERE tenant_id = $1', [testTenantId]);
      await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [testTenantId]);
    }
    if (testIssuerId) {
      await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    }
    await pool.end();
  });

  describe('POST /api/issuers/:issuerId/tenants', () => {
    test('should successfully create a new tenant with default roles and admin user', async () => {
      const tenantName = `New Tenant ${Date.now()}`;
      const adminEmail = `admin-${Date.now()}@example.com`;
      const adminPassword = 'AdminPassword123!';

      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: tenantName,
          admin_email: adminEmail,
          admin_password: adminPassword
        })
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('tenant');
      expect(response.body).toHaveProperty('admin_user');
      expect(response.body).toHaveProperty('default_roles');

      // Verify tenant information
      expect(response.body.tenant.name).toBe(tenantName);
      expect(response.body.tenant.issuer_id).toBe(testIssuerId);
      expect(response.body.tenant).toHaveProperty('tenant_id');
      expect(response.body.tenant).toHaveProperty('created_at');

      // Verify admin user information
      expect(response.body.admin_user.email).toBe(adminEmail);
      expect(response.body.admin_user).toHaveProperty('user_id');
      expect(response.body.admin_user).toHaveProperty('created_at');

      // Verify default roles
      expect(response.body.default_roles).toHaveLength(3);
      const roleNames = response.body.default_roles.map(r => r.role_name);
      expect(roleNames).toContain('Admin');
      expect(roleNames).toContain('Developer');
      expect(roleNames).toContain('Viewer');

      // Clean up created tenant
      const createdTenantId = response.body.tenant.tenant_id;
      await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [createdTenantId]);
    });

    test('should return error for missing required fields', async () => {
      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: 'Incomplete Tenant'
          // Missing admin_email and admin_password
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('required fields');
    });

    test('should return error for invalid email format', async () => {
      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: 'Test Tenant',
          admin_email: 'invalid-email',
          admin_password: 'Password123!'
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('email format');
    });

    test('should return error for weak password', async () => {
      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: 'Test Tenant',
          admin_email: 'admin@example.com',
          admin_password: 'weak'
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('at least 8 characters');
    });

    test('should return error for invalid issuer ID format', async () => {
      const response = await request(app)
        .post('/api/issuers/invalid-uuid/tenants')
        .send({
          name: 'Test Tenant',
          admin_email: 'admin@example.com',
          admin_password: 'Password123!'
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid issuer ID format');
    });

    test('should return error for non-existent issuer', async () => {
      const nonExistentIssuerId = '00000000-0000-0000-0000-000000000000';
      
      const response = await request(app)
        .post(`/api/issuers/${nonExistentIssuerId}/tenants`)
        .send({
          name: 'Test Tenant',
          admin_email: `admin-${Date.now()}@example.com`,
          admin_password: 'Password123!'
        })
        .expect(500);

      expect(response.body.error.message).toContain('issuer does not exist');
    });

    test('should return error for duplicate tenant name within same issuer', async () => {
      const tenantName = `Duplicate Tenant ${Date.now()}`;
      const adminEmail1 = `admin1-${Date.now()}@example.com`;
      const adminEmail2 = `admin2-${Date.now()}@example.com`;

      // Create first tenant
      const firstResponse = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: tenantName,
          admin_email: adminEmail1,
          admin_password: 'Password123!'
        })
        .expect(201);

      const firstTenantId = firstResponse.body.tenant.tenant_id;

      // Try to create second tenant with same name
      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: tenantName,
          admin_email: adminEmail2,
          admin_password: 'Password123!'
        })
        .expect(500);

      expect(response.body.error.message).toContain('already exists');

      // Clean up
      await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [firstTenantId]);
    });
  });

  describe('GET /api/issuers/:issuerId/tenants', () => {
    test('should successfully list all tenants for an issuer', async () => {
      const response = await request(app)
        .get(`/api/issuers/${testIssuerId}/tenants`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('tenants');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.tenants)).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);

      // Verify tenant structure
      if (response.body.tenants.length > 0) {
        const tenant = response.body.tenants[0];
        expect(tenant).toHaveProperty('tenant_id');
        expect(tenant).toHaveProperty('issuer_id');
        expect(tenant).toHaveProperty('name');
        expect(tenant).toHaveProperty('created_at');
      }
    });

    test('should return error for invalid issuer ID format', async () => {
      const response = await request(app)
        .get('/api/issuers/invalid-uuid/tenants')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    test('should return error without authentication', async () => {
      const response = await request(app)
        .get(`/api/issuers/${testIssuerId}/tenants`)
        .expect(401);

      expect(response.body.error.code).toBe('AUTH_TOKEN_REQUIRED');
    });

    test('should return empty list for issuer with no tenants', async () => {
      // Create a new issuer with no tenants
      const newIssuerResult = await pool.query(`
        INSERT INTO issuers (name)
        VALUES ('Empty Issuer')
        RETURNING issuer_id
      `);
      const emptyIssuerId = newIssuerResult.rows[0].issuer_id;

      const response = await request(app)
        .get(`/api/issuers/${emptyIssuerId}/tenants`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.tenants).toHaveLength(0);
      expect(response.body.count).toBe(0);

      // Clean up
      await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [emptyIssuerId]);
    });
  });

  describe('PUT /api/tenants/:tenantId', () => {
    test('should successfully update tenant name', async () => {
      const newName = `Updated Tenant ${Date.now()}`;

      const response = await request(app)
        .put(`/api/tenants/${testTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: newName
        })
        .expect(200);

      expect(response.body).toHaveProperty('tenant');
      expect(response.body.tenant.name).toBe(newName);
      expect(response.body.tenant.tenant_id).toBe(testTenantId);
    });

    test('should return error for invalid tenant ID format', async () => {
      const response = await request(app)
        .put('/api/tenants/invalid-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'New Name'
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    test('should return error for missing update fields', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('At least one field');
    });

    test('should return error for invalid name length', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'a'.repeat(256) // Name too long
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('between 1 and 255 characters');
    });

    test('should return error without authentication', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}`)
        .send({
          name: 'New Name'
        })
        .expect(401);

      expect(response.body.error.code).toBe('AUTH_TOKEN_REQUIRED');
    });

    test('should return error for non-existent tenant', async () => {
      const nonExistentTenantId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .put(`/api/tenants/${nonExistentTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'New Name'
        });

      // The error could be either 403 or 500 depending on RLS behavior
      expect([403, 500]).toContain(response.status);
    });
  });

  describe('DELETE /api/tenants/:tenantId', () => {
    let deletableTenantId;

    beforeEach(async () => {
      // Create a tenant to delete
      const tenantName = `Deletable Tenant ${Date.now()}`;
      const adminEmail = `delete-admin-${Date.now()}@example.com`;
      const adminPassword = 'DeletePassword123!';

      const response = await request(app)
        .post(`/api/issuers/${testIssuerId}/tenants`)
        .send({
          name: tenantName,
          admin_email: adminEmail,
          admin_password: adminPassword
        });

      deletableTenantId = response.body.tenant.tenant_id;
    });

    test('should successfully delete a tenant', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${deletableTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted successfully');
      expect(response.body.tenant_id).toBe(deletableTenantId);

      // Verify tenant is actually deleted
      const checkResult = await pool.query(
        'SELECT * FROM tenants WHERE tenant_id = $1',
        [deletableTenantId]
      );
      expect(checkResult.rows.length).toBe(0);
    });

    test('should cascade delete all associated data', async () => {
      // Verify associated data exists before deletion
      const usersBeforeResult = await pool.query(
        'SELECT * FROM users WHERE tenant_id = $1',
        [deletableTenantId]
      );
      expect(usersBeforeResult.rows.length).toBeGreaterThan(0);

      const rolesBeforeResult = await pool.query(
        'SELECT * FROM roles WHERE tenant_id = $1',
        [deletableTenantId]
      );
      expect(rolesBeforeResult.rows.length).toBeGreaterThan(0);

      // Delete tenant
      await request(app)
        .delete(`/api/tenants/${deletableTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Verify associated data is deleted
      const usersAfterResult = await pool.query(
        'SELECT * FROM users WHERE tenant_id = $1',
        [deletableTenantId]
      );
      expect(usersAfterResult.rows.length).toBe(0);

      const rolesAfterResult = await pool.query(
        'SELECT * FROM roles WHERE tenant_id = $1',
        [deletableTenantId]
      );
      expect(rolesAfterResult.rows.length).toBe(0);
    });

    test('should return error for invalid tenant ID format', async () => {
      const response = await request(app)
        .delete('/api/tenants/invalid-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    test('should return error without authentication', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${deletableTenantId}`)
        .expect(401);

      expect(response.body.error.code).toBe('AUTH_TOKEN_REQUIRED');
    });

    test('should return error for non-existent tenant', async () => {
      const nonExistentTenantId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .delete(`/api/tenants/${nonExistentTenantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(500);

      expect(response.body.error.message).toContain('not found');
    });
  });
});
