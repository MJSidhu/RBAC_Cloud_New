/**
 * PDP (Policy Decision Point) Middleware - The Gatekeeper
 * 
 * This is the CORE AUTHORIZATION ENFORCEMENT point for the entire system.
 * Every protected API request flows through this middleware to validate permissions.
 * 
 * Components:
 * 1. extractJWT - Validates JWT and attaches user context to request
 * 2. setTenantContext - Sets database session variable for RLS
 * 3. authorize - Checks if user has required permission for resource/action
 * 
 * Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.1, 10.2
 */

const { validateJWT } = require('../utils/jwtUtils');
const { hasPermission } = require('../services/rbacService');
const { pool } = require('../config/database');
const { logAuthorizationDecision } = require('../services/auditService');
const {
  TokenRequiredError,
  InvalidTokenError,
  AuthorizationError,
} = require('./errorHandler');

/**
 * Task 7.1: JWT Extraction Middleware
 * 
 * Extracts and validates JWT from Authorization header.
 * Attaches decoded payload to req.user for downstream middleware.
 * 
 * Requirements:
 * - 10.1: Validate JWT signature on every authenticated request
 * - 10.2: Reject expired JWT tokens with 401
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function extractJWT(req, res, next) {
  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    // Check if Authorization header exists
    if (!authHeader) {
      throw new TokenRequiredError('Authorization header is required');
    }

    // Check if Authorization header follows Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      throw new InvalidTokenError('Authorization header must use Bearer token format');
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.substring(7);

    if (!token || token.trim() === '') {
      throw new TokenRequiredError('JWT token is required');
    }

    // Validate JWT signature and expiration
    // This will throw an error if:
    // - Token signature is invalid
    // - Token is expired
    // - Token is malformed
    const decoded = validateJWT(token);

    // Attach decoded payload to request object for downstream middleware
    // Payload contains: user_id, tenant_id, role, email, iat, exp
    req.user = decoded;

    // Continue to next middleware
    next();
  } catch (error) {
    // Handle JWT validation errors
    if (error.message === 'Token has expired') {
      next(new InvalidTokenError('Authentication token has expired'));
    } else if (error.message === 'Invalid token signature') {
      next(new InvalidTokenError('Authentication token signature is invalid'));
    } else if (error.message.includes('Token')) {
      next(new InvalidTokenError(error.message));
    } else {
      // Pass through custom errors (TokenRequiredError, InvalidTokenError)
      next(error);
    }
  }
}

/**
 * Task 7.2: Tenant Context Setter Middleware
 * 
 * Sets PostgreSQL session variable for Row-Level Security (RLS).
 * This enables automatic tenant data isolation at the database level.
 * 
 * CRITICAL: This must run AFTER extractJWT and BEFORE any database queries.
 * 
 * Requirements:
 * - 6.4: Set app.current_tenant_id session variable before executing queries
 * - 7.6: PDP sets database session variable for RLS enforcement
 * 
 * Note: This middleware attaches a database client to req.dbClient.
 * The client MUST be released after the request completes.
 * 
 * @param {Object} req - Express request object (must have req.user from extractJWT)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function setTenantContext(req, res, next) {
  // Ensure JWT was extracted first
  if (!req.user || !req.user.tenant_id) {
    return next(new InvalidTokenError('User context not found. JWT extraction required.'));
  }

  const { tenant_id } = req.user;

  try {
    // Get a database client from the pool
    const client = await pool.connect();

    // Begin transaction
    await client.query('BEGIN');

    // Set tenant context for RLS
    // Using SET LOCAL ensures the setting is transaction-scoped
    // Validate UUID format to prevent SQL injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenant_id)) {
      await client.query('ROLLBACK');
      client.release();
      return next(new InvalidTokenError('Invalid tenant ID format in JWT'));
    }

    // Set the session variable for RLS policies
    await client.query(`SET LOCAL app.current_tenant_id = '${tenant_id}'`);

    // Attach client to request for use in route handlers
    req.dbClient = client;

    // Set up cleanup on response finish - guard against double-release
    let released = false;
    const cleanup = async () => {
      if (released) return;
      released = true;
      try {
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      } finally {
        client.release();
      }
    };

    // Register cleanup handlers
    res.on('finish', cleanup);
    res.on('close', cleanup);

    // Continue to next middleware
    next();
  } catch (error) {
    console.error('Failed to set tenant context:', error);
    
    // Clean up client if it was acquired
    if (req.dbClient) {
      try {
        await req.dbClient.query('ROLLBACK');
        req.dbClient.release();
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }

    next(new Error('Failed to set tenant context'));
  }
}

/**
 * Task 7.3: Authorization Check Middleware Factory
 * 
 * Creates middleware that checks if user has required permission.
 * This is the CORE GATEKEEPER - enforces authorization on every request.
 * 
 * Requirements:
 * - 7.1: PDP middleware executes on every protected API request
 * - 7.2: PDP extracts tenant_id and role from JWT
 * - 7.3: PDP queries user's effective permissions (including inherited)
 * - 7.4: Allow request if user has required permission
 * - 7.5: Return 403 Forbidden if user lacks permission
 * 
 * Usage:
 *   app.delete('/api/files/:id', 
 *     extractJWT, 
 *     setTenantContext, 
 *     authorize('files/*', 'DELETE'),
 *     fileController.deleteFile
 *   );
 * 
 * @param {string} resource - Resource pattern (e.g., 'files/*', 'files/123')
 * @param {string} action - Action type (CREATE, READ, UPDATE, DELETE, SHARE)
 * @returns {Function} Express middleware function
 */
function authorize(resource, action) {
  return async (req, res, next) => {
    // Ensure JWT was extracted and tenant context was set
    if (!req.user) {
      return next(new InvalidTokenError('User context not found. JWT extraction required.'));
    }

    const { user_id, tenant_id, email } = req.user;

    try {
      // Get effective permissions from cache or database
      // This includes:
      // - Direct role permissions
      // - Inherited permissions from role hierarchy
      // - Permissions from cross-tenant trust relationships
      const userHasPermission = await hasPermission(user_id, tenant_id, resource, action);

      if (!userHasPermission) {
        // User lacks required permission - DENY access
        // Log the DENY decision
        logAuthorizationDecision(
          user_id,
          tenant_id,
          resource,
          action,
          'DENY',
          req.ip
        );

        throw new AuthorizationError(
          'You do not have permission to perform this action',
          {
            required_permission: {
              resource,
              action,
            },
            user: {
              user_id,
              tenant_id,
              email,
            },
          }
        );
      }

      // User has permission - ALLOW request to proceed
      // Log the ALLOW decision
      logAuthorizationDecision(
        user_id,
        tenant_id,
        resource,
        action,
        'ALLOW',
        req.ip
      );

      next();
    } catch (error) {
      // Pass authorization errors to error handler
      if (error instanceof AuthorizationError) {
        next(error);
      } else {
        console.error('Authorization check failed:', error);
        next(new Error('Authorization check failed'));
      }
    }
  };
}

/**
 * Convenience function to apply full PDP middleware chain
 * 
 * Usage:
 *   app.delete('/api/files/:id', 
 *     ...requirePermission('files/*', 'DELETE'),
 *     fileController.deleteFile
 *   );
 * 
 * @param {string} resource - Resource pattern
 * @param {string} action - Action type
 * @returns {Array<Function>} Array of middleware functions
 */
function requirePermission(resource, action) {
  return [extractJWT, setTenantContext, authorize(resource, action)];
}

module.exports = {
  extractJWT,
  setTenantContext,
  authorize,
  requirePermission,
};
