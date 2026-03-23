/**
 * Session Service
 * 
 * Manages refresh tokens and session lifecycle.
 * Implements Requirements 10.3, 10.4, 10.5
 */

const crypto = require('crypto');
const { pool } = require('../config/database');

const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

/**
 * Convert expiry string to milliseconds
 * @param {string} expiry - Expiry string like '7d', '24h', '60m'
 * @returns {number} Milliseconds
 */
function parseExpiry(expiry) {
  const match = expiry.match(/^(\d+)([dhm])$/);
  if (!match) {
    throw new Error('Invalid expiry format. Use format like "7d", "24h", "60m"');
  }
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: throw new Error('Invalid expiry unit');
  }
}

/**
 * Generate a cryptographically secure refresh token
 * @returns {string} Random token string
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a refresh token for storage
 * @param {string} token - Plain text refresh token
 * @returns {string} Hashed token
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session with refresh token
 * 
 * @param {string} userId - User UUID
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<{sessionId: string, refreshToken: string, expiresAt: Date}>}
 * 
 * Requirements:
 * - 10.3: Support JWT refresh tokens with 7-day expiration
 */
async function createSession(userId, tenantId) {
  if (!userId || !tenantId) {
    throw new Error('userId and tenantId are required');
  }

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  
  // Calculate expiration date (7 days from now)
  const expiryMs = parseExpiry(REFRESH_TOKEN_EXPIRY);
  const expiresAt = new Date(Date.now() + expiryMs);

  const query = `
    INSERT INTO sessions (user_id, tenant_id, refresh_token_hash, expires_at, is_revoked)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING session_id, expires_at
  `;

  try {
    const result = await pool.query(query, [
      userId,
      tenantId,
      refreshTokenHash,
      expiresAt,
      false
    ]);

    return {
      sessionId: result.rows[0].session_id,
      refreshToken, // Return plain token to client
      expiresAt: result.rows[0].expires_at
    };
  } catch (error) {
    console.error('Failed to create session:', error);
    throw new Error('Failed to create session');
  }
}

/**
 * Validate a refresh token and return session info
 * 
 * @param {string} refreshToken - Plain text refresh token
 * @returns {Promise<{sessionId: string, userId: string, tenantId: string}>}
 * @throws {Error} If token is invalid, expired, or revoked
 * 
 * Requirements:
 * - 10.3: Validate refresh token expiration
 * - 10.5: Check if token is revoked (one-time use)
 */
async function validateSession(refreshToken) {
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const query = `
    SELECT session_id, user_id, tenant_id, expires_at, is_revoked
    FROM sessions
    WHERE refresh_token_hash = $1
  `;

  try {
    const result = await pool.query(query, [refreshTokenHash]);

    if (result.rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const session = result.rows[0];

    // Check if token is revoked (one-time use enforcement)
    if (session.is_revoked) {
      throw new Error('Refresh token has already been used');
    }

    // Check if token is expired
    if (new Date(session.expires_at) < new Date()) {
      throw new Error('Refresh token has expired');
    }

    return {
      sessionId: session.session_id,
      userId: session.user_id,
      tenantId: session.tenant_id
    };
  } catch (error) {
    if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('used')) {
      throw error;
    }
    console.error('Failed to validate session:', error);
    throw new Error('Failed to validate session');
  }
}

/**
 * Revoke a session (mark refresh token as used)
 * 
 * @param {string} sessionId - Session UUID
 * @returns {Promise<void>}
 * 
 * Requirements:
 * - 10.5: Invalidate refresh tokens after use (one-time use)
 */
async function revokeSession(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const query = `
    UPDATE sessions
    SET is_revoked = true
    WHERE session_id = $1
  `;

  try {
    await pool.query(query, [sessionId]);
  } catch (error) {
    console.error('Failed to revoke session:', error);
    throw new Error('Failed to revoke session');
  }
}

/**
 * Revoke a session by refresh token
 * 
 * @param {string} refreshToken - Plain text refresh token
 * @returns {Promise<void>}
 */
async function revokeSessionByToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const query = `
    UPDATE sessions
    SET is_revoked = true
    WHERE refresh_token_hash = $1
  `;

  try {
    await pool.query(query, [refreshTokenHash]);
  } catch (error) {
    console.error('Failed to revoke session by token:', error);
    throw new Error('Failed to revoke session');
  }
}

/**
 * Revoke all sessions for a user
 * 
 * @param {string} userId - User UUID
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<number>} Number of sessions revoked
 */
async function revokeAllUserSessions(userId, tenantId) {
  if (!userId || !tenantId) {
    throw new Error('userId and tenantId are required');
  }

  const query = `
    UPDATE sessions
    SET is_revoked = true
    WHERE user_id = $1 AND tenant_id = $2 AND is_revoked = false
    RETURNING session_id
  `;

  try {
    const result = await pool.query(query, [userId, tenantId]);
    return result.rowCount;
  } catch (error) {
    console.error('Failed to revoke all user sessions:', error);
    throw new Error('Failed to revoke user sessions');
  }
}

/**
 * Clean up expired sessions (background job)
 * 
 * @returns {Promise<number>} Number of sessions deleted
 */
async function cleanupExpiredSessions() {
  const query = `
    DELETE FROM sessions
    WHERE expires_at < NOW()
    RETURNING session_id
  `;

  try {
    const result = await pool.query(query);
    return result.rowCount;
  } catch (error) {
    console.error('Failed to cleanup expired sessions:', error);
    throw new Error('Failed to cleanup expired sessions');
  }
}

module.exports = {
  createSession,
  validateSession,
  revokeSession,
  revokeSessionByToken,
  revokeAllUserSessions,
  cleanupExpiredSessions,
  generateRefreshToken,
  hashRefreshToken,
  parseExpiry
};
