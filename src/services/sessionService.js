const crypto = require('crypto');
const { pool } = require('../config/database');

const REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d';

function parseExpiry(expiry) {
  const match = expiry.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error('Invalid expiry format. Use format like "7d", "24h", "60m"');

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    default: throw new Error('Invalid expiry unit');
  }
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(userId, tenantId) {
  if (!userId || !tenantId) throw new Error('userId and tenantId are required');

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + parseExpiry(REFRESH_TOKEN_EXPIRY));

  try {
    const result = await pool.query(
      `INSERT INTO sessions (user_id, tenant_id, refresh_token_hash, expires_at, is_revoked)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING session_id, expires_at`,
      [userId, tenantId, refreshTokenHash, expiresAt, false]
    );

    return {
      sessionId: result.rows[0].session_id,
      refreshToken,
      expiresAt: result.rows[0].expires_at,
    };
  } catch (error) {
    console.error('Failed to create session:', error);
    throw new Error('Failed to create session');
  }
}

async function validateSession(refreshToken) {
  if (!refreshToken) throw new Error('Refresh token is required');

  const refreshTokenHash = hashRefreshToken(refreshToken);

  try {
    const result = await pool.query(
      `SELECT session_id, user_id, tenant_id, expires_at, is_revoked
       FROM sessions WHERE refresh_token_hash = $1`,
      [refreshTokenHash]
    );

    if (result.rows.length === 0) throw new Error('Invalid refresh token');

    const session = result.rows[0];

    if (session.is_revoked) throw new Error('Refresh token has already been used');
    if (new Date(session.expires_at) < new Date()) throw new Error('Refresh token has expired');

    return {
      sessionId: session.session_id,
      userId: session.user_id,
      tenantId: session.tenant_id,
    };
  } catch (error) {
    if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('used')) {
      throw error;
    }
    console.error('Failed to validate session:', error);
    throw new Error('Failed to validate session');
  }
}

async function revokeSession(sessionId) {
  if (!sessionId) throw new Error('sessionId is required');

  try {
    await pool.query(`UPDATE sessions SET is_revoked = true WHERE session_id = $1`, [sessionId]);
  } catch (error) {
    console.error('Failed to revoke session:', error);
    throw new Error('Failed to revoke session');
  }
}

async function revokeSessionByToken(refreshToken) {
  if (!refreshToken) throw new Error('Refresh token is required');

  const refreshTokenHash = hashRefreshToken(refreshToken);

  try {
    await pool.query(`UPDATE sessions SET is_revoked = true WHERE refresh_token_hash = $1`, [refreshTokenHash]);
  } catch (error) {
    console.error('Failed to revoke session by token:', error);
    throw new Error('Failed to revoke session');
  }
}

async function revokeAllUserSessions(userId, tenantId) {
  if (!userId || !tenantId) throw new Error('userId and tenantId are required');

  try {
    const result = await pool.query(
      `UPDATE sessions SET is_revoked = true
       WHERE user_id = $1 AND tenant_id = $2 AND is_revoked = false
       RETURNING session_id`,
      [userId, tenantId]
    );
    return result.rowCount;
  } catch (error) {
    console.error('Failed to revoke all user sessions:', error);
    throw new Error('Failed to revoke user sessions');
  }
}

async function cleanupExpiredSessions() {
  try {
    const result = await pool.query(
      `DELETE FROM sessions WHERE expires_at < NOW() RETURNING session_id`
    );
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
  parseExpiry,
};
