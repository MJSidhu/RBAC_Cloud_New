const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

function generateJWT(payload) {
  const { user_id, tenant_id, role, email } = payload;

  if (!user_id || !tenant_id || !role || !email) {
    throw new Error('Missing required JWT payload fields: user_id, tenant_id, role, email');
  }

  const jwtPayload = { user_id, tenant_id, role, email };

  return jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function validateJWT(token) {
  if (!token) {
    throw new Error('Token is required');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.user_id || !decoded.tenant_id || !decoded.role || !decoded.email) {
      const error = new Error('Invalid token payload: missing required fields');
      error.name = 'InvalidPayloadError';
      throw error;
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token signature');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token not yet valid');
    } else {
      throw error;
    }
  }
}

module.exports = { generateJWT, validateJWT };
