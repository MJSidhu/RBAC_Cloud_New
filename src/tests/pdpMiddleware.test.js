/**
 * PDP Middleware Tests
 * 
 * Tests for the Policy Decision Point (Gatekeeper) middleware.
 * Covers JWT extraction, tenant context setting, and authorization checks.
 * 
 * Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.1, 10.2
 */

const { extractJWT, setTenantContext, authorize } = require('../middleware/pdpMiddleware');
const { generateJWT } = require('../utils/jwtUtils');
const { pool } = require('../config/database');
const { hasPermission } = require('../services/rbacService');
const { logAuthorizationDecision } = require('../services/auditService');

// Mock dependencies
jest.mock('../services/rbacService');
jest.mock('../services/auditService');
jest.mock('../config/database');

describe('PDP Middleware - extractJWT', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {};
    next = jest.fn();
  });

  test('should extract and validate JWT from Authorization header', () => {
    // Generate valid JWT
    const payload = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '223e4567-e89b-12d3-a456-426614174000',
      role: 'Admin',
      email: 'test@example.com',
    };
    const token = generateJWT(payload);

    // Set Authorization header
    req.headers.authorization = `Bearer ${token}`;

    // Execute middleware
    extractJWT(req, res, next);

    // Verify user context was attached
    expect(req.user).toBeDefined();
    expect(req.user.user_id).toBe(payload.user_id);
    expect(req.user.tenant_id).toBe(payload.tenant_id);
    expect(req.user.role).toBe(payload.role);
    expect(req.user.email).toBe(payload.email);
    expect(req.user.iat).toBeDefined();
    expect(req.user.exp).toBeDefined();

    // Verify next was called
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('should return 401 when Authorization header is missing', () => {
    // No Authorization header
    extractJWT(req, res, next);

    // Verify error was passed to next
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
  });

  test('should return 401 when Authorization header does not use Bearer format', () => {
    req.headers.authorization = 'Basic abc123';

    extractJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_INVALID_TOKEN');
  });

  test('should return 401 when token is empty', () => {
    req.headers.authorization = 'Bearer ';

    extractJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
  });

  test('should return 401 when token signature is invalid', () => {
    // Invalid token with wrong signature
    req.headers.authorization = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMTIzIn0.invalid_signature';

    extractJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_INVALID_TOKEN');
  });

  test('should return 401 when token is malformed', () => {
    req.headers.authorization = 'Bearer not.a.valid.jwt';

    extractJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
  });
});

describe('PDP Middleware - setTenantContext', () => {
  let req, res, next, mockClient;

  beforeEach(() => {
    req = {
      user: {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '223e4567-e89b-12d3-a456-426614174000',
        role: 'Admin',
        email: 'test@example.com',
      },
    };
    res = {
      on: jest.fn(),
    };
    next = jest.fn();

    // Mock database client
    mockClient = {
      query: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
      _ended: false,
    };

    pool.connect = jest.fn().mockResolvedValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should set tenant context and attach client to request', async () => {
    await setTenantContext(req, res, next);

    // Verify transaction was started
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

    // Verify tenant context was set
    expect(mockClient.query).toHaveBeenCalledWith(
      `SET LOCAL app.current_tenant_id = '${req.user.tenant_id}'`
    );

    // Verify client was attached to request
    expect(req.dbClient).toBe(mockClient);

    // Verify cleanup handlers were registered
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));

    // Verify next was called
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('should return error when user context is missing', async () => {
    req.user = null;

    await setTenantContext(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_INVALID_TOKEN');
  });

  test('should return error when tenant_id is missing', async () => {
    req.user.tenant_id = null;

    await setTenantContext(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
  });

  test('should return error when tenant_id is not a valid UUID', async () => {
    req.user.tenant_id = 'not-a-uuid';

    await setTenantContext(req, res, next);

    // Verify transaction was rolled back
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

    // Verify client was released
    expect(mockClient.release).toHaveBeenCalled();

    // Verify error was passed to next
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
  });

  test('should handle database connection errors', async () => {
    pool.connect = jest.fn().mockRejectedValue(new Error('Connection failed'));

    await setTenantContext(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.message).toContain('Failed to set tenant context');
  });

  test('should cleanup and commit transaction on response finish', async () => {
    await setTenantContext(req, res, next);

    // Get the finish handler
    const finishHandler = res.on.mock.calls.find(call => call[0] === 'finish')[1];

    // Call the finish handler
    await finishHandler();

    // Verify transaction was committed
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // Verify client was released
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('PDP Middleware - authorize', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: {
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        tenant_id: '223e4567-e89b-12d3-a456-426614174000',
        role: 'Admin',
        email: 'test@example.com',
      },
    };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should allow request when user has required permission', async () => {
    // Mock hasPermission to return true
    hasPermission.mockResolvedValue(true);

    // Add req.ip for audit logging
    req.ip = '192.168.1.1';

    const middleware = authorize('files/123', 'READ');
    await middleware(req, res, next);

    // Verify hasPermission was called with correct parameters
    expect(hasPermission).toHaveBeenCalledWith(
      req.user.user_id,
      req.user.tenant_id,
      'files/123',
      'READ'
    );

    // Verify audit log was called with ALLOW decision
    expect(logAuthorizationDecision).toHaveBeenCalledWith(
      req.user.user_id,
      req.user.tenant_id,
      'files/123',
      'READ',
      'ALLOW',
      req.ip
    );

    // Verify next was called without error
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('should deny request when user lacks required permission', async () => {
    // Mock hasPermission to return false
    hasPermission.mockResolvedValue(false);

    // Add req.ip for audit logging
    req.ip = '192.168.1.1';

    const middleware = authorize('files/123', 'DELETE');
    await middleware(req, res, next);

    // Verify hasPermission was called
    expect(hasPermission).toHaveBeenCalledWith(
      req.user.user_id,
      req.user.tenant_id,
      'files/123',
      'DELETE'
    );

    // Verify audit log was called with DENY decision
    expect(logAuthorizationDecision).toHaveBeenCalledWith(
      req.user.user_id,
      req.user.tenant_id,
      'files/123',
      'DELETE',
      'DENY',
      req.ip
    );

    // Verify error was passed to next
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUTHZ_PERMISSION_DENIED');
    expect(error.details).toBeDefined();
    expect(error.details.required_permission).toEqual({
      resource: 'files/123',
      action: 'DELETE',
    });
  });

  test('should return error when user context is missing', async () => {
    req.user = null;

    const middleware = authorize('files/123', 'READ');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('AUTH_INVALID_TOKEN');
  });

  test('should handle permission check errors', async () => {
    // Mock hasPermission to throw error
    hasPermission.mockRejectedValue(new Error('Database error'));

    const middleware = authorize('files/123', 'READ');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeDefined();
    expect(error.message).toContain('Authorization check failed');
  });

  test('should work with wildcard resource patterns', async () => {
    hasPermission.mockResolvedValue(true);

    const middleware = authorize('files/*', 'READ');
    await middleware(req, res, next);

    expect(hasPermission).toHaveBeenCalledWith(
      req.user.user_id,
      req.user.tenant_id,
      'files/*',
      'READ'
    );

    expect(next).toHaveBeenCalledWith();
  });

  test('should work with all action types', async () => {
    const actions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];

    for (const action of actions) {
      hasPermission.mockResolvedValue(true);
      next.mockClear();

      const middleware = authorize('files/123', action);
      await middleware(req, res, next);

      expect(hasPermission).toHaveBeenCalledWith(
        req.user.user_id,
        req.user.tenant_id,
        'files/123',
        action
      );

      expect(next).toHaveBeenCalledWith();
    }
  });
});

describe('PDP Middleware - Integration', () => {
  test('should work as a complete middleware chain', async () => {
    const req = {
      headers: {},
    };
    const res = {
      on: jest.fn(),
    };
    const next = jest.fn();

    // Generate valid JWT
    const payload = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '223e4567-e89b-12d3-a456-426614174000',
      role: 'Admin',
      email: 'test@example.com',
    };
    const token = generateJWT(payload);
    req.headers.authorization = `Bearer ${token}`;

    // Mock database client
    const mockClient = {
      query: jest.fn().mockResolvedValue({}),
      release: jest.fn(),
      _ended: false,
    };
    pool.connect = jest.fn().mockResolvedValue(mockClient);

    // Mock hasPermission
    hasPermission.mockResolvedValue(true);

    // Execute middleware chain
    extractJWT(req, res, next);
    expect(req.user).toBeDefined();

    await setTenantContext(req, res, next);
    expect(req.dbClient).toBeDefined();

    const authMiddleware = authorize('files/123', 'READ');
    await authMiddleware(req, res, next);

    // Verify all middleware passed successfully
    expect(next).toHaveBeenCalledTimes(3);
    expect(next).toHaveBeenCalledWith();
  });
});
