/**
 * Audit Log Routes Tests
 * 
 * Tests for the audit log query API endpoint.
 * Requirements: 8.5
 */

const request = require('supertest');
const app = require('../server');
const { pool } = require('../config/database');
const { generateJWT } = require('../utils/jwtUtils');
const { hashPassword } = require('../utils/passwordUtils');

describe('Audit Log Routes', () => {
  let testIssuerId;
  let testTenantId;
  let testUserId;
  let testRoleId;
  let testPermissionId;
  let testToken;
  let otherTenantId;
  let otherUserId;
  let otherToken;

  beforeAll(async () => {
    // Create test issuer
    const issuerResult = await pool.query(
      `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
      ['Test Issuer for Audit Logs']
    );
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(
      `INSERT INTO tenants (name, issuer_id) 
       VALUES ($1, $2)
       RETURNING tenant_id`,
      ['Test Tenant for Audit Logs', testIssuerId]
    );
    testTenantId = tenantResult.rows[0].tenant_id;

    // Create test user
    const passwordHash = await hashPassword('testpassword');
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [testTenantId, 'auditlogtest@example.com', passwordHash]
    );
    testUserId = userResult.rows[0].user_id;

    // Create test role
    const roleResult = await pool.query(
      `INSERT INTO roles (tenant_id, role_name)
       VALUES ($1, $2)
       RETURNING role_id`,
      [testTenantId, 'AuditViewer']
    );
    testRoleId = roleResult.rows[0].role_id;

    // Create permission for audit logs
    const permissionResult = await pool.query(
      `INSERT INTO permissions (tenant_id, resource_name, action)
       VALUES ($1, $2, $3)
       RETURNING permission_id`,
      [testTenantId, 'audit-logs', 'READ']
    );
    testPermissionId = permissionResult.rows[0].permission_id;

    // Assign permission to role
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id, tenant_id)
       VALUES ($1, $2, $3)`,
      [testRoleId, testPermissionId, testTenantId]
    );

    // Assign role to user
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id)
       VALUES ($1, $2, $3)`,
      [testUserId, testRoleId, testTenantId]
    );

    // Generate JWT for test user
    testToken = generateJWT({
      user_id: testUserId,
      tenant_id: testTenantId,
      role: 'AuditViewer',
      email: 'auditlogtest@example.com',
    });

    // Create another tenant for cross-tenant test
    const otherTenantResult = await pool.query(
      `INSERT INTO tenants (name, issuer_id) 
       VALUES ($1, $2)
       RETURNING tenant_id`,
      ['Other Tenant for Audit Logs', testIssuerId]
    );
    otherTenantId = otherTenantResult.rows[0].tenant_id;

    // Create user in other tenant
    const otherUserResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [otherTenantId, 'otherauditlogtest@example.com', passwordHash]
    );
    otherUserId = otherUserResult.rows[0].user_id;

    // Generate JWT for other user
    otherToken = generateJWT({
      user_id: otherUserId,
      tenant_id: otherTenantId,
      role: 'User',
      email: 'otherauditlogtest@example.com',
    });

    // Insert some test audit logs
    await pool.query(
      `INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, ip_address, timestamp)
       VALUES 
       ($1, $2, 'files/123', 'READ', 'ALLOW', '192.168.1.1', NOW() - INTERVAL '1 hour'),
       ($1, $2, 'files/456', 'DELETE', 'DENY', '192.168.1.1', NOW() - INTERVAL '2 hours'),
       ($1, $2, 'files/789', 'UPDATE', 'ALLOW', '192.168.1.2', NOW() - INTERVAL '3 hours'),
       ($1, $2, 'folders/abc', 'CREATE', 'ALLOW', '192.168.1.1', NOW() - INTERVAL '4 hours')`,
      [testUserId, testTenantId]
    );
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1 OR tenant_id = $2', [
      testTenantId,
      otherTenantId,
    ]);
    await pool.query('DELETE FROM user_roles WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM role_permissions WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM permissions WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM roles WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM users WHERE tenant_id = $1 OR tenant_id = $2', [
      testTenantId,
      otherTenantId,
    ]);
    await pool.query('DELETE FROM tenants WHERE tenant_id = $1 OR tenant_id = $2', [
      testTenantId,
      otherTenantId,
    ]);
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end();
  });

  describe('GET /api/tenants/:tenantId/audit-logs', () => {
    it('should return audit logs for the tenant', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.logs)).toBe(true);
      expect(response.body.logs.length).toBeGreaterThan(0);
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('page');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('offset');
    });

    it('should filter audit logs by user_id', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ user_id: testUserId })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeGreaterThan(0);
      response.body.logs.forEach((log) => {
        expect(log.user_id).toBe(testUserId);
      });
    });

    it('should filter audit logs by resource', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ resource: 'files/123' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeGreaterThan(0);
      response.body.logs.forEach((log) => {
        expect(log.resource).toBe('files/123');
      });
    });

    it('should filter audit logs by action', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ action: 'READ' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeGreaterThan(0);
      response.body.logs.forEach((log) => {
        expect(log.action).toBe('READ');
      });
    });

    it('should filter audit logs by decision', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ decision: 'ALLOW' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeGreaterThan(0);
      response.body.logs.forEach((log) => {
        expect(log.decision).toBe('ALLOW');
      });
    });

    it('should filter audit logs by date range', async () => {
      const startDate = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5 hours ago
      const endDate = new Date().toISOString(); // now

      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ start_date: startDate, end_date: endDate })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeGreaterThan(0);
    });

    it('should support pagination with limit and offset', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ limit: 2, offset: 0 })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.logs.length).toBeLessThanOrEqual(2);
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should reject request without authentication', async () => {
      await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .expect(401);
    });

    it('should reject request for different tenant', async () => {
      const response = await request(app)
        .get(`/api/tenants/${otherTenantId}/audit-logs`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(403);

      expect(response.body.error.code).toBe('AUTHZ_FORBIDDEN');
    });

    it('should reject invalid decision value', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ decision: 'INVALID' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid action value', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ action: 'INVALID' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid date format', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ start_date: 'invalid-date' })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid limit value', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ limit: 2000 })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid offset value', async () => {
      const response = await request(app)
        .get(`/api/tenants/${testTenantId}/audit-logs`)
        .query({ offset: -1 })
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
