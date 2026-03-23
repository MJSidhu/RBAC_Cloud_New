/**
 * Unit Tests for Role Management API Endpoints
 * 
 * Tests the role management endpoints including:
 * - POST /api/tenants/:tenantId/roles - create role
 * - GET /api/tenants/:tenantId/roles - list roles
 * - PUT /api/tenants/:tenantId/roles/:roleId - update role
 * - DELETE /api/tenants/:tenantId/roles/:roleId - delete role
 * 
 * Requirements: 3.1
 */

const request = require('supertest');
const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const app = require('../server');
const { pool } = require('../config/database');
const { generateJWT } = require('../utils/jwtUtils');
const { hashPassword } = require('../utils/passwordUtils');

describe('Role Management API Endpoints', () => {
  let testTenantId;
  let testUserId;
  let testToken;
  let testRoleId;
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

    // Create permissions for role management
    const permissions = [
      { resource: 'roles', action: 'CREATE' },
      { resource: 'roles', action: 'READ' },
      { resource: 'roles', action: 'UPDATE' },
      { resource: 'roles', action: 'DELETE' },
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
    // Clean up roles created during tests (except Admin)
    await pool.query(
      'DELETE FROM roles WHERE tenant_id = $1 AND role_name != $2',
      [testTenantId, 'Admin']
    );
  });

  describe('POST /api/tenants/:tenantId/roles', () => {
    it('should create a new role successfully', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Developer',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('role');
      expect(response.body.role).toHaveProperty('role_id');
      expect(response.body.role.role_name).toBe('Developer');
      expect(response.body.role.tenant_id).toBe(testTenantId);
      expect(response.body.role.parent_role_id).toBeNull();

      testRoleId = response.body.role.role_id;
    });

    it('should create a role with parent role (hierarchy)', async () => {
      // Create parent role first
      const parentResponse = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Manager',
        });

      const parentRoleId = parentResponse.body.role.role_id;

      // Create child role
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'TeamLead',
          parent_role_id: parentRoleId,
        });

      expect(response.status).toBe(201);
      expect(response.body.role.parent_role_id).toBe(parentRoleId);
    });

    it('should reject role creation without role_name', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    it('should reject role creation with invalid tenant ID format', async () => {
      const response = await request(app)
        .post('/api/tenants/invalid-uuid/roles')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Developer',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    it('should reject role creation with mismatched tenant ID', async () => {
      const differentTenantId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .post(`/api/tenants/${differentTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Developer',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_INVALID_INPUT');
    });

    it('should reject duplicate role name in same tenant', async () => {
      // Create first role
      await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Duplicate',
        });

      // Try to create duplicate
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'Duplicate',
        });

      expect(response.status).toBe(500);
    });

    it('should reject role creation without authentication', async () => {
      const response = await request(app)
        .post(`/api/tenants/${testTenantId}/roles`)
        .send({
          role_name: 'Developer',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/tenants/:tenantId/roles', () => {
    beforeEach(async () => {
      // Create test roles
      await pool.query(
        'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2), ($1, $3)',
        [testTenantId, 'Developer', 'Viewer']
      );
    });

    it('should list all roles for a tenant', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('roles');
      expect(response.body).toHaveProperty('count');
      expect(response.body.count).toBeGreaterThanOrEqual(3); // Admin + Developer + Viewer
      expect(Array.isArray(response.body.roles)).toBe(true);
    });

    it('should return roles ordered by role_name', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/roles`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      const roleNames = response.body.roles.map(r => r.role_name);
      const sortedNames = [...roleNames].sort();
      expect(roleNames).toEqual(sortedNames);
    });

    it('should reject listing with invalid tenant ID format', async () => {
      const response = await request(app)
        .get('/api/tenants/invalid-uuid/roles')
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(400);
    });

    it('should reject listing without authentication', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/roles`);

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/tenants/:tenantId/roles/:roleId', () => {
    let updateRoleId;

    beforeEach(async () => {
      // Create a role to update
      const result = await pool.query(
        'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id',
        [testTenantId, 'ToUpdate']
      );
      updateRoleId = result.rows[0].role_id;
    });

    it('should update role name successfully', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/${updateRoleId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'UpdatedName',
        });

      expect(response.status).toBe(200);
      expect(response.body.role.role_name).toBe('UpdatedName');
      expect(response.body.role.role_id).toBe(updateRoleId);
    });

    it('should update parent role successfully', async () => {
      // Create parent role
      const parentResult = await pool.query(
        'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id',
        [testTenantId, 'ParentRole']
      );
      const parentRoleId = parentResult.rows[0].role_id;

      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/${updateRoleId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          parent_role_id: parentRoleId,
        });

      expect(response.status).toBe(200);
      expect(response.body.role.parent_role_id).toBe(parentRoleId);
    });

    it('should reject update without any fields', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/${updateRoleId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({});

      expect(response.status).toBe(400);
    });

    it('should reject update with invalid role ID format', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/invalid-uuid`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'NewName',
        });

      expect(response.status).toBe(400);
    });

    it('should reject update for non-existent role', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/${nonExistentId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          role_name: 'NewName',
        });

      expect(response.status).toBe(500);
    });

    it('should reject update without authentication', async () => {
      const response = await request(app)
        .put(`/api/tenants/${testTenantId}/roles/${updateRoleId}`)
        .send({
          role_name: 'NewName',
        });

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/tenants/:tenantId/roles/:roleId', () => {
    let deleteRoleId;

    beforeEach(async () => {
      // Create a role to delete
      const result = await pool.query(
        'INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id',
        [testTenantId, 'ToDelete']
      );
      deleteRoleId = result.rows[0].role_id;
    });

    it('should delete role successfully', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/roles/${deleteRoleId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.role_id).toBe(deleteRoleId);

      // Verify role is deleted
      const checkResult = await pool.query(
        'SELECT * FROM roles WHERE role_id = $1',
        [deleteRoleId]
      );
      expect(checkResult.rows.length).toBe(0);
    });

    it('should reject delete with invalid role ID format', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/roles/invalid-uuid`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(400);
    });

    it('should reject delete for non-existent role', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/roles/${nonExistentId}`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(response.status).toBe(500);
    });

    it('should reject delete without authentication', async () => {
      const response = await request(app)
        .delete(`/api/tenants/${testTenantId}/roles/${deleteRoleId}`);

      expect(response.status).toBe(401);
    });
  });
});
