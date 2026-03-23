/**
 * Session Service Tests
 * 
 * Tests for refresh token management functionality.
 * Validates Requirements 10.3, 10.4, 10.5
 */

const {
  createSession,
  validateSession,
  revokeSession,
  revokeSessionByToken,
  revokeAllUserSessions,
  cleanupExpiredSessions,
  generateRefreshToken,
  hashRefreshToken,
  parseExpiry
} = require('../services/sessionService');
const { pool } = require('../config/database');

describe('Session Service', () => {
  let testUserId;
  let testTenantId;
  let testIssuerId;

  beforeAll(async () => {
    // Create test issuer, tenant, and user
    const issuerResult = await pool.query(`
      INSERT INTO issuers (name)
      VALUES ('Test Issuer Session')
      RETURNING issuer_id
    `);
    testIssuerId = issuerResult.rows[0].issuer_id;

    const tenantResult = await pool.query(`
      INSERT INTO tenants (issuer_id, name)
      VALUES ($1, 'Test Tenant Session')
      RETURNING tenant_id
    `, [testIssuerId]);
    testTenantId = tenantResult.rows[0].tenant_id;

    const userResult = await pool.query(`
      INSERT INTO users (tenant_id, email, password_hash)
      VALUES ($1, 'session-test@example.com', 'hash')
      RETURNING user_id
    `, [testTenantId]);
    testUserId = userResult.rows[0].user_id;
  });

  afterAll(async () => {
    // Cleanup test data (cascade will handle related records)
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    await pool.end(); // Close pool to prevent hanging
  });

  afterEach(async () => {
    // Clean up sessions after each test
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
  });

  describe('Utility Functions', () => {
    test('generateRefreshToken should return a 64-character hex string', () => {
      const token = generateRefreshToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    test('hashRefreshToken should return consistent hash for same token', () => {
      const token = 'test-token-123';
      const hash1 = hashRefreshToken(token);
      const hash2 = hashRefreshToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    test('parseExpiry should convert time strings to milliseconds', () => {
      expect(parseExpiry('7d')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseExpiry('24h')).toBe(24 * 60 * 60 * 1000);
      expect(parseExpiry('60m')).toBe(60 * 60 * 1000);
    });

    test('parseExpiry should throw error for invalid format', () => {
      expect(() => parseExpiry('invalid')).toThrow('Invalid expiry format');
      expect(() => parseExpiry('7x')).toThrow('Invalid expiry format');
    });
  });

  describe('createSession', () => {
    test('should create a new session with refresh token', async () => {
      const session = await createSession(testUserId, testTenantId);

      expect(session).toHaveProperty('sessionId');
      expect(session).toHaveProperty('refreshToken');
      expect(session).toHaveProperty('expiresAt');
      expect(session.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(session.expiresAt).toBeInstanceOf(Date);

      // Verify expiration is approximately 7 days from now
      const expectedExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(session.expiresAt - expectedExpiry);
      expect(timeDiff).toBeLessThan(1000); // Within 1 second
    });

    test('should store hashed token in database', async () => {
      const session = await createSession(testUserId, testTenantId);

      const result = await pool.query(
        'SELECT refresh_token_hash FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );

      const storedHash = result.rows[0].refresh_token_hash;
      const expectedHash = hashRefreshToken(session.refreshToken);
      expect(storedHash).toBe(expectedHash);
    });

    test('should throw error if userId is missing', async () => {
      await expect(createSession(null, testTenantId)).rejects.toThrow(
        'userId and tenantId are required'
      );
    });

    test('should throw error if tenantId is missing', async () => {
      await expect(createSession(testUserId, null)).rejects.toThrow(
        'userId and tenantId are required'
      );
    });
  });

  describe('validateSession', () => {
    test('should validate a valid refresh token', async () => {
      const session = await createSession(testUserId, testTenantId);
      const validated = await validateSession(session.refreshToken);

      expect(validated.sessionId).toBe(session.sessionId);
      expect(validated.userId).toBe(testUserId);
      expect(validated.tenantId).toBe(testTenantId);
    });

    test('should throw error for invalid refresh token', async () => {
      await expect(validateSession('invalid-token')).rejects.toThrow(
        'Invalid refresh token'
      );
    });

    test('should throw error for revoked refresh token', async () => {
      const session = await createSession(testUserId, testTenantId);
      await revokeSession(session.sessionId);

      await expect(validateSession(session.refreshToken)).rejects.toThrow(
        'Refresh token has already been used'
      );
    });

    test('should throw error for expired refresh token', async () => {
      const session = await createSession(testUserId, testTenantId);

      // Manually set expiration to past
      await pool.query(
        'UPDATE sessions SET expires_at = $1 WHERE session_id = $2',
        [new Date(Date.now() - 1000), session.sessionId]
      );

      await expect(validateSession(session.refreshToken)).rejects.toThrow(
        'Refresh token has expired'
      );
    });

    test('should throw error if refresh token is missing', async () => {
      await expect(validateSession(null)).rejects.toThrow(
        'Refresh token is required'
      );
    });
  });

  describe('revokeSession', () => {
    test('should revoke a session by session ID', async () => {
      const session = await createSession(testUserId, testTenantId);
      await revokeSession(session.sessionId);

      const result = await pool.query(
        'SELECT is_revoked FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );

      expect(result.rows[0].is_revoked).toBe(true);
    });

    test('should throw error if sessionId is missing', async () => {
      await expect(revokeSession(null)).rejects.toThrow(
        'sessionId is required'
      );
    });
  });

  describe('revokeSessionByToken', () => {
    test('should revoke a session by refresh token', async () => {
      const session = await createSession(testUserId, testTenantId);
      await revokeSessionByToken(session.refreshToken);

      const result = await pool.query(
        'SELECT is_revoked FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );

      expect(result.rows[0].is_revoked).toBe(true);
    });

    test('should throw error if refresh token is missing', async () => {
      await expect(revokeSessionByToken(null)).rejects.toThrow(
        'Refresh token is required'
      );
    });
  });

  describe('revokeAllUserSessions', () => {
    test('should revoke all sessions for a user', async () => {
      // Create multiple sessions
      const session1 = await createSession(testUserId, testTenantId);
      const session2 = await createSession(testUserId, testTenantId);
      const session3 = await createSession(testUserId, testTenantId);

      const count = await revokeAllUserSessions(testUserId, testTenantId);
      expect(count).toBe(3);

      // Verify all are revoked
      const result = await pool.query(
        'SELECT is_revoked FROM sessions WHERE user_id = $1',
        [testUserId]
      );

      expect(result.rows.every(row => row.is_revoked)).toBe(true);
    });

    test('should return 0 if no active sessions exist', async () => {
      const count = await revokeAllUserSessions(testUserId, testTenantId);
      expect(count).toBe(0);
    });

    test('should throw error if userId or tenantId is missing', async () => {
      await expect(revokeAllUserSessions(null, testTenantId)).rejects.toThrow(
        'userId and tenantId are required'
      );
      await expect(revokeAllUserSessions(testUserId, null)).rejects.toThrow(
        'userId and tenantId are required'
      );
    });
  });

  describe('cleanupExpiredSessions', () => {
    test('should delete expired sessions', async () => {
      // Create a session and manually expire it
      const session = await createSession(testUserId, testTenantId);
      
      // Set expiration to 1 day in the past (clearly expired)
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await pool.query(
        'UPDATE sessions SET expires_at = $1 WHERE session_id = $2',
        [expiredDate, session.sessionId]
      );

      // Verify session exists and is expired before cleanup
      const beforeResult = await pool.query(
        'SELECT session_id, expires_at, expires_at < NOW() as is_expired FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );
      expect(beforeResult.rows.length).toBe(1);
      expect(beforeResult.rows[0].is_expired).toBe(true);

      // Run cleanup
      const deletedCount = await cleanupExpiredSessions();
      
      // Verify the session was deleted
      const afterResult = await pool.query(
        'SELECT * FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );
      expect(afterResult.rows.length).toBe(0);
      expect(deletedCount).toBeGreaterThanOrEqual(1);
    });

    test('should not delete active sessions', async () => {
      const session = await createSession(testUserId, testTenantId);
      await cleanupExpiredSessions();

      // Verify session still exists
      const result = await pool.query(
        'SELECT * FROM sessions WHERE session_id = $1',
        [session.sessionId]
      );
      expect(result.rows.length).toBe(1);
    });
  });

  describe('One-Time Use Enforcement (Requirement 10.5)', () => {
    test('should prevent reuse of refresh token after validation and revocation', async () => {
      const session = await createSession(testUserId, testTenantId);

      // First use - should succeed
      const validated = await validateSession(session.refreshToken);
      expect(validated.sessionId).toBe(session.sessionId);

      // Revoke after use (simulating token exchange)
      await revokeSession(session.sessionId);

      // Second use - should fail
      await expect(validateSession(session.refreshToken)).rejects.toThrow(
        'Refresh token has already been used'
      );
    });
  });

  describe('7-Day Expiry (Requirement 10.3)', () => {
    test('should set expiration to 7 days from creation', async () => {
      const beforeCreate = Date.now();
      const session = await createSession(testUserId, testTenantId);
      const afterCreate = Date.now();

      const expectedMinExpiry = new Date(beforeCreate + 7 * 24 * 60 * 60 * 1000);
      const expectedMaxExpiry = new Date(afterCreate + 7 * 24 * 60 * 60 * 1000);

      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry.getTime());
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry.getTime());
    });
  });
});
