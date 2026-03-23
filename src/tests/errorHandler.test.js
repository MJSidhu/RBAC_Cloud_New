/**
 * Unit tests for error handling utilities
 * Tests error response format consistency and error code mapping
 */

const errorHandler = require('../middleware/errorHandler');
const {
  AppError,
  ValidationError,
  CircularHierarchyError,
  HierarchyDepthError,
  AuthenticationError,
  TokenRequiredError,
  InvalidTokenError,
  AuthorizationError,
  TenantIsolationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  DatabaseConnectionError,
  InternalServerError,
} = require('../middleware/errorHandler');

describe('Error Handler Utilities', () => {
  describe('Error Classes', () => {
    test('ValidationError should have correct properties', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_INVALID_INPUT');
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.isOperational).toBe(true);
    });

    test('CircularHierarchyError should have correct properties', () => {
      const error = new CircularHierarchyError();
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_CIRCULAR_HIERARCHY');
      expect(error.message).toBe('Operation would create a circular hierarchy');
    });

    test('HierarchyDepthError should have correct properties', () => {
      const error = new HierarchyDepthError();
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_HIERARCHY_DEPTH_EXCEEDED');
      expect(error.message).toBe('Role hierarchy depth cannot exceed 5 levels');
    });

    test('AuthenticationError should have correct properties', () => {
      const error = new AuthenticationError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(error.message).toBe('Authentication failed');
    });

    test('TokenRequiredError should have correct properties', () => {
      const error = new TokenRequiredError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_TOKEN_REQUIRED');
      expect(error.message).toBe('Authentication token is required');
    });

    test('InvalidTokenError should have correct properties', () => {
      const error = new InvalidTokenError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTH_INVALID_TOKEN');
      expect(error.message).toBe('Authentication token is invalid or expired');
    });

    test('AuthorizationError should have correct properties', () => {
      const error = new AuthorizationError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUTHZ_PERMISSION_DENIED');
      expect(error.message).toBe('Permission denied');
    });

    test('TenantIsolationError should have correct properties', () => {
      const error = new TenantIsolationError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUTHZ_TENANT_ISOLATION_VIOLATION');
      expect(error.message).toBe('Access to resources in other tenants is not allowed');
    });

    test('NotFoundError should have correct properties', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('RESOURCE_NOT_FOUND');
      expect(error.message).toBe('Resource not found');
    });

    test('ConflictError should have correct properties', () => {
      const error = new ConflictError('Duplicate resource');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT_DUPLICATE_RESOURCE');
      expect(error.message).toBe('Duplicate resource');
    });

    test('RateLimitError should have correct properties', () => {
      const error = new RateLimitError({ limit: 100, window: '60s' });
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.message).toBe('Too many requests. Please try again later.');
      expect(error.details).toEqual({ limit: 100, window: '60s' });
    });

    test('DatabaseError should have correct properties', () => {
      const error = new DatabaseError();
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('DATABASE_ERROR');
      expect(error.message).toBe('Database operation failed');
    });

    test('DatabaseConnectionError should have correct properties', () => {
      const error = new DatabaseConnectionError();
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('DATABASE_CONNECTION_ERROR');
      expect(error.message).toBe('Unable to connect to database');
    });

    test('InternalServerError should have correct properties', () => {
      const error = new InternalServerError();
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.message).toBe('An unexpected error occurred');
    });
  });

  describe('Error Handler Middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        id: 'test-request-id',
        url: '/api/test',
        method: 'GET',
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      next = jest.fn();
      
      // Suppress console output during tests
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      console.error.mockRestore();
      console.warn.mockRestore();
    });

    test('should handle ValidationError correctly', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'VALIDATION_INVALID_INPUT',
          message: 'Invalid input',
          details: { field: 'email' },
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle AuthenticationError correctly', () => {
      const error = new AuthenticationError();
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Authentication failed',
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle AuthorizationError correctly', () => {
      const error = new AuthorizationError('Permission denied', {
        required_permission: { resource: 'files/123', action: 'DELETE' },
      });
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'AUTHZ_PERMISSION_DENIED',
          message: 'Permission denied',
          details: {
            required_permission: { resource: 'files/123', action: 'DELETE' },
          },
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle NotFoundError correctly', () => {
      const error = new NotFoundError('Resource not found', {
        resource_type: 'role',
        resource_id: 'uuid-here',
      });
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Resource not found',
          details: {
            resource_type: 'role',
            resource_id: 'uuid-here',
          },
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle RateLimitError correctly', () => {
      const error = new RateLimitError({ limit: 100, window: '60s', retry_after: 45 });
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          details: { limit: 100, window: '60s', retry_after: 45 },
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle InternalServerError correctly', () => {
      const error = new InternalServerError();
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
      expect(console.error).toHaveBeenCalled();
    });

    test('should handle PostgreSQL unique violation (23505)', () => {
      const error = new Error('Unique violation');
      error.code = '23505';
      error.constraint = 'users_email_key';
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'CONFLICT_DUPLICATE_RESOURCE',
          message: 'A resource with this identifier already exists',
          details: { constraint: 'users_email_key' },
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle PostgreSQL foreign key violation (23503)', () => {
      const error = new Error('Foreign key violation');
      error.code = '23503';
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'VALIDATION_FOREIGN_KEY_VIOLATION',
          message: 'Referenced resource does not exist',
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should handle unknown errors with default 500 status', () => {
      const error = new Error('Unknown error');
      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unknown error',
          timestamp: expect.any(String),
          request_id: 'test-request-id',
        }),
      });
    });

    test('should include stack trace in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new ValidationError('Test error');
      errorHandler(error, req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        error: expect.objectContaining({
          stack: expect.any(String),
        }),
      });

      process.env.NODE_ENV = originalEnv;
    });

    test('should not include stack trace in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const error = new ValidationError('Test error');
      errorHandler(error, req, res, next);

      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.error.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Error Response Format', () => {
    test('all error responses should follow consistent format', () => {
      const req = { id: 'test-id', url: '/test', method: 'GET' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      
      jest.spyOn(console, 'warn').mockImplementation(() => {});

      const error = new ValidationError('Test');
      errorHandler(error, req, res);

      const response = res.json.mock.calls[0][0];
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response.error).toHaveProperty('timestamp');
      expect(response.error).toHaveProperty('request_id');
      
      console.warn.mockRestore();
    });
  });
});
