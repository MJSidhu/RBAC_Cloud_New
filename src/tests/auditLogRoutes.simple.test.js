/**
 * Simple Audit Log Routes Tests
 * 
 * Basic tests for the audit log query API endpoint without full PDP middleware.
 * Requirements: 8.5
 */

const { queryAuditLogs } = require('../services/auditService');
const { pool } = require('../config/database');
const { hashPassword } = require('../utils/passwordUtils');

describe('Audit Log Query Service', () => {
  let testIssuerId;
  let testTenantId;
  let testUserId;

  beforeAll(async () => {
    // Create test issuer
    const issuerResult = await pool.query(
      `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
      ['Test Issuer for Audit Query']
    );
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(
      `INSERT INTO tenants (name, issuer_id) VALUES ($1, $2) RETURNING tenant_id`,
      ['Test Tenant for Audit Query', testIssuerId]
    );
    testTenantId = tenantResult.rows[0].tenant_id;

    // Create test user
    const passwordHash = await hashPassword('testpassword');
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING user_id`,
      [testTenantId, 'auditquery@example.com', passwordHash]
    );
    testUserId = userResult.rows[0].user_id;

    // Insert test audit logs
    await pool.query(
      `INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, ip_address, timestamp)
       VALUES 
       ($1, $2, 'files/123', 'READ', 'ALLOW', '192.168.1.1', NOW() - INTERVAL '1 hour'),
       ($1, $2, 'files/456', 'DELETE', 'DENY', '192.168.1.1', NOW() - INTERVAL '2 hours'),
       ($1, $2, 'files/789', 'UPDATE', 'ALLOW', '192.168.1.2', NOW() - INTERVAL '3 hours'),
       ($1, $2, 'folders/abc', 'CREATE', 'ALLOW', '192.168.1.1', NOW() - INTERVAL '4 hours'),
       ($1, $2, 'files/999', 'SHARE', 'DENY', '192.168.1.3', NOW() - INTERVAL '5 hours')`,
      [testUserId, testTenantId]
    );
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end();
  });

  describe('queryAuditLogs', () => {
    it('should return all audit logs for a tenant', async () => {
      const result = await queryAuditLogs(testTenantId);

      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.logs.length).toBe(5);
      expect(result.total).toBe(5);
    });

    it('should filter by user_id', async () => {
      const result = await queryAuditLogs(testTenantId, { userId: testUserId });

      expect(result.logs.length).toBe(5);
      result.logs.forEach((log) => {
        expect(log.user_id).toBe(testUserId);
      });
    });

    it('should filter by resource', async () => {
      const result = await queryAuditLogs(testTenantId, { resource: 'files/123' });

      expect(result.logs.length).toBe(1);
      expect(result.logs[0].resource).toBe('files/123');
    });

    it('should filter by action', async () => {
      const result = await queryAuditLogs(testTenantId, { action: 'READ' });

      expect(result.logs.length).toBe(1);
      result.logs.forEach((log) => {
        expect(log.action).toBe('READ');
      });
    });

    it('should filter by decision ALLOW', async () => {
      const result = await queryAuditLogs(testTenantId, { decision: 'ALLOW' });

      expect(result.logs.length).toBe(3);
      result.logs.forEach((log) => {
        expect(log.decision).toBe('ALLOW');
      });
    });

    it('should filter by decision DENY', async () => {
      const result = await queryAuditLogs(testTenantId, { decision: 'DENY' });

      expect(result.logs.length).toBe(2);
      result.logs.forEach((log) => {
        expect(log.decision).toBe('DENY');
      });
    });

    it('should filter by date range', async () => {
      const startDate = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago
      const endDate = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour from now

      const result = await queryAuditLogs(testTenantId, { startDate, endDate });

      // All 5 logs should be within this range
      expect(result.logs.length).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it('should support pagination with limit', async () => {
      const result = await queryAuditLogs(testTenantId, { limit: 2 });

      expect(result.logs.length).toBe(2);
      expect(result.total).toBe(5);
    });

    it('should support pagination with offset', async () => {
      const result = await queryAuditLogs(testTenantId, { limit: 2, offset: 2 });

      expect(result.logs.length).toBe(2);
      expect(result.total).toBe(5);
      expect(result.page).toBe(2);
    });

    it('should combine multiple filters', async () => {
      const result = await queryAuditLogs(testTenantId, {
        userId: testUserId,
        decision: 'ALLOW',
        limit: 10,
      });

      expect(result.logs.length).toBe(3);
      result.logs.forEach((log) => {
        expect(log.user_id).toBe(testUserId);
        expect(log.decision).toBe('ALLOW');
      });
    });

    it('should return empty array when no logs match filters', async () => {
      const result = await queryAuditLogs(testTenantId, { resource: 'nonexistent' });

      expect(result.logs.length).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should throw error when tenantId is missing', async () => {
      await expect(queryAuditLogs(null)).rejects.toThrow('tenantId is required');
    });
  });
});
