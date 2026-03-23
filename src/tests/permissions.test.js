/**
 * Unit Tests for Permission Management API Endpoints
 * 
 * Tests the permission management endpoints including:
 * - POST /api/tenants/:tenantId/permissions - create permission
 * - GET /api/tenants/:tenantId/permissions - list permissions
 * - PUT /api/tenants/:tenantId/permissions/:permissionId - update permission
 * - DELETE /api/tenants/:tenantId/permissions/:permissionId - delete permission
 * 
 * Requirements: 4.1
 */

const request = require('supertest');
const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const app = require('../server');
const { pool } = require('../config/database');
const { generateJWT } = require('../utils/jwtUtils');
const { hashPassword } = require('../utils/passwordUtils');

describe('Permission Management API Endpoints', () => {
  let testTenantId;
  let testUserId;
  let testToken;
  let testPermissionId;
  let testIssuerId;

  beforeAll(async () => {
    // Create test issuer
    const issuerResult = await pool.query(
      'INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id',
      ['Test Issuer']
    );
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(
      'INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id',
      [testIssuerId, 'Test Tenant']
    );
    testTenantId = tenantResult.rows[0].tenant_id;

    // Create test user
    const hashedPassword = await hashPassword('testpassword123');
    const userResult = await pool.query(
      'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id',
      [testTenantId, 'test@example.com', hashedPassword]
    );
    testUserId = userResult.rows[0].user_id;

    // Create admin role with all permissions
    const roleResult = await pool.query(
      'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id',
      [testTenantId, 'Admin']
    );

    const adminRoleId = roleResult.rows[0].role_id;

    // Assign admin role to test user
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)',
      [testUserId, adminRoleId, testTenantId]
    );

    // Create permissions for permission management
    const permissions = [
      { resource: 'permissions', action: 'CREATE' },
      { resource: 'permissions', action: 'READ' },
      { resource: 'permissions', action: 'UPDATE' },
      { resource: 'permissions', action: 'DELETE' },
    ];

    for (const perm of permissions) {
      const permResult = await pool.query(
        'INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3) RETURNING permission_id',
        [testTenantId, perm.resource, perm.action]
      );
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)',
        [adminRoleId, permResult.rows[0].permission_id, testTenantId]
      );
    }

    // Generate JWT for test user
    testToken = generateJWT({
      user_id: testUserId,
      tenant_id: testTenantId,
      email: 'test@example.com',
      role: 'Admin',
    });
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up permissions created during tests (except permission management permissions)
    await pool.query(
      'DELETE FROM permissions WHERE tenant_id = $1 AND resource_name != $2',
      [testTenantId, 'permissions']
    );
  });

  describe('POST /api/tenants/:tenantId/permissions', () => {
    it('should create a new permission with valid data', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'files/*',
          action: 'READ',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('permission');
      expect(response.body.permission).toHaveProperty('permission_id');
      expect(response.body.permission.tenant_id).toBe(testTenantId);
      expect(response.body.permission.resource_name).toBe('files/*');
      expect(response.body.permission.action).toBe('READ');
      expect(response.body.permission).toHaveProperty('created_at');

      testPermissionId = response.body.permission.permission_id;
    });


    it('should create permission with each valid action type', async () => {
      const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];
      
      for (const action of actions) {
        const response = await request(app)
          .post(`/api/tenants/${testTenantId}/permissions`)
          .set('Authorization', `Bearer ${testToken}`)
          .send({
            resource_name: `test-resource-${action}`,
            action: action,
          });

        expect(response.status).toBe(201);
        expect(response.body.permission.action).toBe(action);
      }
    });

    it('should reject permission creation with invalid action', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'files/*',
          action: 'INVALID_ACTION',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid action');
    });

    it('should reject permission creation without resource_name', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          action: 'READ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('resource_name');
    });

    it('should reject permission creation without action', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'files/*',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('action');
    });

    it('should reject permission creation with invalid tenant ID format', async () => {
      const response = await request(app)
        .post('/api/tenants/invalid-uuid/permissions')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'files/*',
          action: 'READ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid tenant ID format');
    });

    it('should reject permission creation when tenant ID does not match JWT', async () => {
      const otherTenantId = '12345678-1234-1234-1234-123456789012';
      const response = await request(app)
        .post(`/api/tenants/${otherTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'files/*',
          action: 'READ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('does not match authenticated user tenant');
    });


    it('should reject permission creation with resource_name too long', async () => {
      const longResourceName = 'a'.repeat(256);
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: longResourceName,
          action: 'READ',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Resource name must be between 1 and 255 characters');
    });

    it('should reject duplicate permission (same resource and action)', async () => {
      // Create first permission
      await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'duplicate-test',
          action: 'READ',
        });

      // Try to create duplicate
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'duplicate-test',
          action: 'READ',
        });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('already exists');
    });
  });

  describe('GET /api/tenants/:tenantId/permissions', () => {
    beforeEach(async () => {
      // Create test permissions
      await pool.query(
        'INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3)',
        [testTenantId, 'files/*', 'READ']
      );
      await pool.query(
        'INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3)',
        [testTenantId, 'files/*', 'UPDATE']
      );
    });

    it('should list all permissions for a tenant', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('permissions');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.permissions)).toBe(true);
      expect(response.body.count).toBeGreaterThanOrEqual(2);
    });

    it('should reject listing with invalid tenant ID format', async () => {
      const response = await request(app)
        .get('/api/tenants/invalid-uuid/permissions')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    it('should reject listing when tenant ID does not match JWT', async () => {
      const otherTenantId = '12345678-1234-1234-1234-123456789012';
      const response = await request(app)
        .get(`/api/tenants/${otherTenantId}/permissions`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });
  });


  describe('PUT /api/tenants/:tenantId/permissions/:permissionId', () => {
    let updateTestPermissionId;

    beforeEach(async () => {
      // Create a permission to update
      const result = await pool.query(
        'INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3) RETURNING permission_id',
        [testTenantId, 'update-test', 'READ']
      );
      updateTestPermissionId = result.rows[0].permission_id;
    });

    it('should update permission resource_name', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${updateTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'updated-resource',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('permission');
      expect(response.body.permission.resource_name).toBe('updated-resource');
      expect(response.body.permission.action).toBe('READ');
    });

    it('should update permission action', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${updateTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          action: 'UPDATE',
        });

      expect(response.status).toBe(200);
      expect(response.body.permission.action).toBe('UPDATE');
      expect(response.body.permission.resource_name).toBe('update-test');
    });

    it('should update both resource_name and action', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${updateTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'fully-updated',
          action: 'DELETE',
        });

      expect(response.status).toBe(200);
      expect(response.body.permission.resource_name).toBe('fully-updated');
      expect(response.body.permission.action).toBe('DELETE');
    });

    it('should reject update with invalid action', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${updateTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          action: 'INVALID',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid action');
    });

    it('should reject update with no fields provided', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${updateTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('At least one field must be provided');
    });

    it('should reject update with invalid permission ID format', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/invalid-uuid`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'test',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid permission ID format');
    });

    it('should return 404 for non-existent permission', async () => {
      const nonExistentId = '12345678-1234-1234-1234-123456789012';
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/permissions/${nonExistentId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          resource_name: 'test',
        });

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('not found');
    });
  });


  describe('DELETE /api/tenants/:tenantId/permissions/:permissionId', () => {
    let deleteTestPermissionId;

    beforeEach(async () => {
      // Create a permission to delete
      const result = await pool.query(
        'INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3) RETURNING permission_id',
        [testTenantId, 'delete-test', 'READ']
      );
      deleteTestPermissionId = result.rows[0].permission_id;
    });

    it('should delete a permission successfully', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/permissions/${deleteTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Permission deleted successfully');
      expect(response.body.permission_id).toBe(deleteTestPermissionId);

      // Verify permission is deleted
      const checkResult = await pool.query(
        'SELECT * FROM permissions WHERE permission_id = $1',
        [deleteTestPermissionId]
      );
      expect(checkResult.rows.length).toBe(0);
    });

    it('should reject delete with invalid permission ID format', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/permissions/invalid-uuid`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(response.body.error.message).toContain('Invalid permission ID format');
    });

    it('should return 404 for non-existent permission', async () => {
      const nonExistentId = '12345678-1234-1234-1234-123456789012';
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/permissions/${nonExistentId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(500);
      expect(response.body.error.message).toContain('not found');
    });

    it('should cascade delete role-permission assignments', async () => {
      // Create a role
      const roleResult = await pool.query(
        'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id',
        [testTenantId, 'TestRole']
      );
      const roleId = roleResult.rows[0].role_id;

      // Assign permission to role
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)',
        [roleId, deleteTestPermissionId, testTenantId]
      );

      // Delete permission
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/permissions/${deleteTestPermissionId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);

      // Verify role-permission assignment is also deleted
      const checkResult = await pool.query(
        'SELECT * FROM role_permissions WHERE permission_id = $1',
        [deleteTestPermissionId]
      );
      expect(checkResult.rows.length).toBe(0);
    });
  });

  describe('Authorization checks', () => {
    it('should reject requests without JWT token', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/permissions`);

      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid JWT token', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/permissions`)
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });
});
