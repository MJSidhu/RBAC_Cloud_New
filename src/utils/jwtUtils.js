/**
 * JWT Utilities
 * 
 * Provides JWT generation and validation functions for authentication.
 * Implements Requirements 2.2, 2.3, 2.4, 10.1, 10.2
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

/**
 * Generate a JWT token for an authenticated user
 * 
 * @param {Object} payload - The JWT payload
 * @param {string} payload.user_id - User UUID
 * @param {string} payload.tenant_id - Tenant UUID
 * @param {string} payload.role - User's role name
 * @param {string} payload.email - User's email address
 * @returns {string} Signed JWT token with 24-hour expiry
 * 
 * Requirements:
 * - 2.2: Generate JWT on successful authentication
 * - 2.3: JWT contains tenant_id, user_id, and role information
 * - 2.4: JWT expires after 24 hours
 */
function generateJWT(payload) {
  const { user_id, tenant_id, role, email } = payload;

  // Validate required fields
  if (!user_id || !tenant_id || !role || !email) {
    throw new Error('Missing required JWT payload fields: user_id, tenant_id, role, email');
  }

  // Create JWT payload with required fields
  const jwtPayload = {
    user_id,
    tenant_id,
    role,
    email
  };

  // Generate token with 24-hour expiry
  // The jwt.sign function automatically adds iat (issued at) and exp (expiration) claims
  const token = jwt.sign(jwtPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRY
  });

  return token;
}

/**
 * Validate and decode a JWT token
 * 
 * @param {string} token - The JWT token to validate
 * @returns {Object} Decoded JWT payload containing user_id, tenant_id, role, email, iat, exp
 * @throws {Error} If token is invalid, expired, or malformed
 * 
 * Requirements:
 * - 10.1: Validate JWT signature on every authenticated request
 * - 10.2: Reject expired JWT tokens
 */
function validateJWT(token) {
  if (!token) {
    throw new Error('Token is required');
  }

  try {
    // Verify token signature and expiration
    // This will throw an error if:
    // - Signature is invalid
    // - Token is expired
    // - Token is malformed
    const decoded = jwt.verify(token, JWT_SECRET);

    // Validate that required fields are present
    if (!decoded.user_id || !decoded.tenant_id || !decoded.role || !decoded.email) {
      const error = new Error('Invalid token payload: missing required fields');
      error.name = 'InvalidPayloadError';
      throw error;
    }

    return decoded;
  } catch (error) {
    // Re-throw with more specific error messages
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token signature');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token not yet valid');
    } else if (error.name === 'InvalidPayloadError') {
      throw error;
    } else {
      throw error;
    }
  }
}

module.exports = {
  generateJWT,
  validateJWT
};
