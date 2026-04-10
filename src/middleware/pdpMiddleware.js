const { validateJWT } = require('../utils/jwtUtils');
const { hasPermission } = require('../services/rbacService');
const { pool } = require('../config/database');
const { logAuthorizationDecision } = require('../services/auditService');
const {
  TokenRequiredError,
  InvalidTokenError,
  AuthorizationError,
} = require('./errorHandler');

function extractJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new TokenRequiredError('Authorization header is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new InvalidTokenError('Authorization header must use Bearer token format');
    }

    const token = authHeader.substring(7);

    if (!token || token.trim() === '') {
      throw new TokenRequiredError('JWT token is required');
    }

    req.user = validateJWT(token);
    next();
  } catch (error) {
    if (error.message === 'Token has expired') {
      next(new InvalidTokenError('Authentication token has expired'));
    } else if (error.message === 'Invalid token signature') {
      next(new InvalidTokenError('Authentication token signature is invalid'));
    } else if (error.message.includes('Token')) {
      next(new InvalidTokenError(error.message));
    } else {
      next(error);
    }
  }
}

async function setTenantContext(req, res, next) {
  if (!req.user || !req.user.tenant_id) {
    return next(new InvalidTokenError('User context not found. JWT extraction required.'));
  }

  const { tenant_id } = req.user;

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenant_id)) {
      await client.query('ROLLBACK');
      client.release();
      return next(new InvalidTokenError('Invalid tenant ID format in JWT'));
    }

    await client.query(`SET LOCAL app.current_tenant_id = '${tenant_id}'`);
    req.dbClient = client;

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

    res.on('finish', cleanup);
    res.on('close', cleanup);

    next();
  } catch (error) {
    console.error('Failed to set tenant context:', error);

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

function authorize(resource, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return next(new InvalidTokenError('User context not found. JWT extraction required.'));
    }

    const { user_id, tenant_id, email } = req.user;

    try {
      const userHasPermission = await hasPermission(user_id, tenant_id, resource, action);

      if (!userHasPermission) {
        logAuthorizationDecision(user_id, tenant_id, resource, action, 'DENY', req.ip);

        throw new AuthorizationError(
          'You do not have permission to perform this action',
          {
            required_permission: { resource, action },
            user: { user_id, tenant_id, email },
          }
        );
      }

      logAuthorizationDecision(user_id, tenant_id, resource, action, 'ALLOW', req.ip);
      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        next(error);
      } else {
        console.error('Authorization check failed:', error);
        next(new Error('Authorization check failed'));
      }
    }
  };
}

function requirePermission(resource, action) {
  return [extractJWT, setTenantContext, authorize(resource, action)];
}

module.exports = { extractJWT, setTenantContext, authorize, requirePermission };
