/**
 * Unit tests for Audit Service
 * 
 * Tests audit logging functionality including:
 * - Asynchronous audit log writing
 * - Graceful degradation on failures
 * - Audit log querying with filters
 * - Old log cleanup
 */

const { pool } = require('../config/database');
const {
  logAuthorizationDecision,
  queryAuditLogs,
  cleanupOldLogs
} = require('../services/auditService');

// Helper to wait for async operations
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Audit Service', () => {
  let testTenantId;
  let testUserId;
  let testIssuerId;

  beforeAll(async () => {
    // Create test issuer first
    const issuerResult = await pool.query(`
      INSERT INTO issuers (issuer_id, name)
      VALUES (gen_random_uuid(), 'Test Issuer Audit')
      RETURNING issuer_id
    `);
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(`
      INSERT INTO tenants (tenant_id, issuer_id, name)
      VALUES (gen_random_uuid(), $1, 'Test Tenant Audit')
      RETURNING tenant_id
    `, [testIssuerId]);
    testTenantId = tenantResult.rows[0].tenant_id;

    const userResult = await pool.query(`
      INSERT INTO users (user_id, tenant_id, email, password_hash)
      VALUES (gen_random_uuid(), $1, 'audit-test@example.com', 'hash')
      RETURNING user_id
    `, [testTenantId]);
    testUserId = userResult.rows[0].user_id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [testTenantId]);
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end(); // Close the pool to prevent hanging
  });

  beforeEach(async () => {
    // Clean audit logs before each test
    await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [testTenantId]);
  });

  describe('logAuthorizationDecision', () => {
    test('should write audit log asynchronously with all fields', async () => {
      // Call the function (it returns immediately)
      logAuthorizationDecision(
        testUserId,
        testTenantId,
        'files/123',
        'READ',
        'ALLOW',
        '192.168.1.1'
      );

      // Wait for async operation to complete
      await wait(100);

      // Verify the log was written
      const result = await pool.query(`
        SELECT * FROM audit_logs
        WHERE tenant_id = $1 AND user_id = $2
      `, [testTenantId, testUserId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].resource).toBe('files/123');
      expect(result.rows[0].action).toBe('READ');
      expect(result.rows[0].decision).toBe('ALLOW');
      expect(result.rows[0].ip_address).toBe('192.168.1.1');
      expect(result.rows[0].timestamp).toBeDefined();
    });

    test('should handle null user_id for unauthenticated requests', async () => {
      logAuthorizationDecision(
        null,
        testTenantId,
        'public/resource',
        'READ',
        'DENY',
        '10.0.0.1'
      );

      await wait(200); // Increased wait time

      const result = await pool.query(`
        SELECT * FROM audit_logs
        WHERE tenant_id = $1 AND user_id IS NULL AND resource = 'public/resource'
      `, [testTenantId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].user_id).toBeNull();
      expect(result.rows[0].decision).toBe('DENY');
    });

    test('should handle null ip_address', async () => {
      logAuthorizationDecision(
        testUserId,
        testTenantId,
        'files/456',
        'UPDATE',
        'ALLOW',
        null
      );

      await wait(100);

      const result = await pool.query(`
        SELECT * FROM audit_logs
        WHERE tenant_id = $1 AND resource = 'files/456'
      `, [testTenantId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].ip_address).toBeNull();
    });

    test('should accept DENY decision', async () => {
      logAuthorizationDecision(
        testUserId,
        testTenantId,
        'files/789',
        'DELETE',
        'DENY',
        '172.16.0.1'
      );

      await wait(100);

      const result = await pool.query(`
        SELECT * FROM audit_logs
        WHERE tenant_id = $1 AND decision = 'DENY'
      `, [testTenantId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].decision).toBe('DENY');
    });

    test('should fail gracefully with missing required fields', async () => {
      // Missing tenantId - should not throw
      expect(() => {
        logAuthorizationDecision(
          testUserId,
          null,
          'files/123',
          'READ',
          'ALLOW',
          '192.168.1.1'
        );
      }).not.toThrow();

      await wait(100);

      // Verify no log was written
      const result = await pool.query(`
        SELECT * FROM audit_logs WHERE user_id = $1
      `, [testUserId]);

      expect(result.rows.length).toBe(0);
    });

    test('should fail gracefully with invalid decision', async () => {
      // Invalid decision - should not throw
      expect(() => {
        logAuthorizationDecision(
          testUserId,
          testTenantId,
          'files/123',
          'READ',
          'INVALID',
          '192.168.1.1'
        );
      }).not.toThrow();

      await wait(100);

      // Verify no log was written
      const result = await pool.query(`
        SELECT * FROM audit_logs WHERE tenant_id = $1
      `, [testTenantId]);

      expect(result.rows.length).toBe(0);
    });

    test('should be non-blocking (returns immediately)', () => {
      const startTime = Date.now();
      
      logAuthorizationDecision(
        testUserId,
        testTenantId,
        'files/123',
        'READ',
        'ALLOW',
        '192.168.1.1'
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should return in less than 10ms (non-blocking)
      expect(duration).toBeLessThan(10);
    });
  });

  describe('queryAuditLogs', () => {
    beforeEach(async () => {
      // Clean audit logs before each test
      await pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [testTenantId]);
      
      // Insert test audit logs
      await pool.query(`
        INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, ip_address, timestamp)
        VALUES
          ($1, $2, 'files/1', 'READ', 'ALLOW', '192.168.1.1', NOW() - INTERVAL '1 hour'),
          ($1, $2, 'files/2', 'UPDATE', 'ALLOW', '192.168.1.2', NOW() - INTERVAL '2 hours'),
          ($1, $2, 'files/3', 'DELETE', 'DENY', '192.168.1.3', NOW() - INTERVAL '3 hours'),
          ($1, $2, 'folders/1', 'CREATE', 'ALLOW', '192.168.1.4', NOW() - INTERVAL '4 hours')
      `, [testUserId, testTenantId]);
    });

    test('should query all logs for a tenant', async () => {
      const result = await queryAuditLogs(testTenantId);

      expect(result.logs.length).toBe(4);
      expect(result.total).toBe(4);
      expect(result.page).toBe(1);
    });

    test('should filter by user_id', async () => {
      const result = await queryAuditLogs(testTenantId, { userId: testUserId });

      expect(result.logs.length).toBe(4);
      expect(result.logs.every(log => log.user_id === testUserId)).toBe(true);
    });

    test('should filter by resource', async () => {
      const result = await queryAuditLogs(testTenantId, { resource: 'files/1' });

      expect(result.logs.length).toBe(1);
      expect(result.logs[0].resource).toBe('files/1');
    });

    test('should filter by action', async () => {
      const result = await queryAuditLogs(testTenantId, { action: 'READ' });

      expect(result.logs.length).toBe(1);
      expect(result.logs[0].action).toBe('READ');
    });

    test('should filter by decision', async () => {
      const result = await queryAuditLogs(testTenantId, { decision: 'DENY' });

      expect(result.logs.length).toBe(1);
      expect(result.logs[0].decision).toBe('DENY');
    });

    test('should filter by date range', async () => {
      // Insert a log with a specific old timestamp for testing
      await pool.query(`
        INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, timestamp)
        VALUES ($1, $2, 'old/file', 'READ', 'ALLOW', NOW() - INTERVAL '100 days')
      `, [testUserId, testTenantId]);
      
      // Query with a date range that excludes the old log
      const startDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const endDate = new Date(); // Now

      const result = await queryAuditLogs(testTenantId, { startDate, endDate });

      // Should get only the 4 recent logs, not the 100-day-old one
      expect(result.logs.length).toBe(4);
      expect(result.logs.every(log => log.resource !== 'old/file')).toBe(true);
    });

    test('should support pagination with limit', async () => {
      const result = await queryAuditLogs(testTenantId, { limit: 2 });

      expect(result.logs.length).toBe(2);
      expect(result.total).toBe(4);
      expect(result.page).toBe(1);
    });

    test('should support pagination with offset', async () => {
      const result = await queryAuditLogs(testTenantId, { limit: 2, offset: 2 });

      expect(result.logs.length).toBe(2);
      expect(result.total).toBe(4);
      expect(result.page).toBe(2);
    });

    test('should combine multiple filters', async () => {
      const result = await queryAuditLogs(testTenantId, {
        userId: testUserId,
        decision: 'ALLOW',
        limit: 10
      });

      expect(result.logs.length).toBe(3);
      expect(result.logs.every(log => log.decision === 'ALLOW')).toBe(true);
    });

    test('should return logs in descending timestamp order', async () => {
      const result = await queryAuditLogs(testTenantId);

      // Verify timestamps are in descending order
      for (let i = 0; i < result.logs.length - 1; i++) {
        const current = new Date(result.logs[i].timestamp);
        const next = new Date(result.logs[i + 1].timestamp);
        expect(current >= next).toBe(true);
      }
    });

    test('should throw error if tenantId is missing', async () => {
      await expect(queryAuditLogs(null)).rejects.toThrow('tenantId is required');
    });
  });

  describe('cleanupOldLogs', () => {
    test('should delete logs older than retention period', async () => {
      // Insert old logs
      await pool.query(`
        INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, timestamp)
        VALUES
          ($1, $2, 'old/1', 'READ', 'ALLOW', NOW() - INTERVAL '100 days'),
          ($1, $2, 'old/2', 'READ', 'ALLOW', NOW() - INTERVAL '95 days'),
          ($1, $2, 'recent/1', 'READ', 'ALLOW', NOW() - INTERVAL '50 days')
      `, [testUserId, testTenantId]);

      const deletedCount = await cleanupOldLogs(90);

      expect(deletedCount).toBe(2);

      // Verify only recent log remains
      const result = await pool.query(`
        SELECT * FROM audit_logs WHERE tenant_id = $1
      `, [testTenantId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].resource).toBe('recent/1');
    });

    test('should support custom retention period', async () => {
      // Insert logs
      await pool.query(`
        INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, timestamp)
        VALUES
          ($1, $2, 'old/1', 'READ', 'ALLOW', NOW() - INTERVAL '40 days'),
          ($1, $2, 'recent/1', 'READ', 'ALLOW', NOW() - INTERVAL '20 days')
      `, [testUserId, testTenantId]);

      const deletedCount = await cleanupOldLogs(30);

      expect(deletedCount).toBe(1);

      // Verify only recent log remains
      const result = await pool.query(`
        SELECT * FROM audit_logs WHERE tenant_id = $1
      `, [testTenantId]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].resource).toBe('recent/1');
    });

    test('should return 0 if no old logs exist', async () => {
      // Insert only recent logs
      await pool.query(`
        INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, timestamp)
        VALUES ($1, $2, 'recent/1', 'READ', 'ALLOW', NOW())
      `, [testUserId, testTenantId]);

      const deletedCount = await cleanupOldLogs(90);

      expect(deletedCount).toBe(0);
    });
  });
});
