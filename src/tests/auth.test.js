/**
 * Authentication API Endpoint Tests
 * 
 * Tests for login, refresh, and logout endpoints.
 * Requirements: 2.2, 2.5, 10.4
 */

const request = require('supertest');
const { pool } = require('../config/database');
const { hashPassword } = require('../utils/passwordUtils');
const app = require('../server');

describe('Authentication API Endpoints', () => {
  let testIssuerId;
  let testTenantId;
  let testUserId;
  let testEmail;
  let testPassword;
  let testRoleId;

  beforeAll(async () => {
    // Create test issuer
    const issuerResult = await pool.query(`
      INSERT INTO issuers (name)
      VALUES ('Test Issuer')
      RETURNING issuer_id
    `);
    testIssuerId = issuerResult.rows[0].issuer_id;

    // Create test tenant
    const tenantResult = await pool.query(`
      INSERT INTO tenants (name, issuer_id)
      VALUES ('Test Tenant', $1)
      RETURNING tenant_id
    `, [testIssuerId]);
    testTenantId = tenantResult.rows[0].tenant_id;

    // Create test role
    const roleResult = await pool.query(`
      INSERT INTO roles (tenant_id, role_name)
      VALUES ($1, 'TestRole')
      RETURNING role_id
    `, [testTenantId]);
    testRoleId = roleResult.rows[0].role_id;

    // Create test user
    testEmail = `test-${Date.now()}@example.com`;
    testPassword = 'TestPassword123!';
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
  });

  afterAll(async () => {
    // Clean up test data
    if (testUserId) {
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    }
    if (testRoleId) {
      await pool.query('DELETE FROM roles WHERE role_id = $1', [testRoleId]);
    }
    if (testTenantId) {
      await pool.query('DELETE FROM tenants WHERE tenant_id = $1', [testTenantId]);
    }
    if (testIssuerId) {
      await pool.query('DELETE FROM issuers WHERE issuer_id = $1', [testIssuerId]);
    }
    await pool.end();
  });

  describe('POST /api/auth/login', () => {
    test('should successfully login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testEmail);
      expect(response.body.user.tenant_id).toBe(testTenantId);
      expect(response.body.user.role).toBe('TestRole');
    });

    test('should return uniform error for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testPassword
        })
        .expect(401);

      expect(response.body.error.message).toBe('Invalid credentials');
      expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    test('should return uniform error for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body.error.message).toBe('Invalid credentials');
      expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    test('should return error for missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(401);

      expect(response.body.error.message).toBe('Invalid credentials');
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      // Login to get a refresh token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });
      refreshToken = loginResponse.body.refresh_token;
    });

    test('should successfully refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refresh_token: refreshToken
        })
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body.refresh_token).not.toBe(refreshToken); // Should be a new token
    });

    test('should reject already used refresh token (one-time use)', async () => {
      // Use the refresh token once
      await request(app)
        .post('/api/auth/refresh')
        .send({
          refresh_token: refreshToken
        })
        .expect(200);

      // Try to use it again
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refresh_token: refreshToken
        })
        .expect(401);

      expect(response.body.error.message).toContain('already been used');
    });

    test('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refresh_token: 'invalid-token-12345'
        })
        .expect(401);

      expect(response.body.error.code).toBe('AUTH_INVALID_TOKEN');
    });

    test('should return error for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(401);

      expect(response.body.error.message).toContain('required');
    });
  });

  describe('POST /api/auth/logout', () => {
    let refreshToken;

    beforeEach(async () => {
      // Login to get a refresh token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });
      refreshToken = loginResponse.body.refresh_token;
    });

    test('should successfully logout with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({
          refresh_token: refreshToken
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out successfully');
    });

    test('should not allow using refresh token after logout', async () => {
      // Logout
      await request(app)
        .post('/api/auth/logout')
        .send({
          refresh_token: refreshToken
        })
        .expect(200);

      // Try to refresh with the logged out token
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({
          refresh_token: refreshToken
        })
        .expect(401);

      expect(response.body.error.message).toContain('already been used');
    });

    test('should return error for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({})
        .expect(401);

      expect(response.body.error.message).toContain('required');
    });
  });
});
