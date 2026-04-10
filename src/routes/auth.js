const express = require('express');
const { pool } = require('../config/database');
const { generateJWT } = require('../utils/jwtUtils');
const { comparePassword } = require('../utils/passwordUtils');
const { createSession, validateSession, revokeSessionByToken } = require('../services/sessionService');
const { AuthenticationError, InvalidTokenError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AuthenticationError('Invalid credentials');
  }

  const userResult = await pool.query(
    `SELECT u.user_id, u.tenant_id, u.email, u.password_hash, r.role_name
     FROM users u
     LEFT JOIN user_roles ur ON u.user_id = ur.user_id
     LEFT JOIN roles r ON ur.role_id = r.role_id
     WHERE u.email = $1 LIMIT 1`,
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new AuthenticationError('Invalid credentials');
  }

  const user = userResult.rows[0];

  if (!await comparePassword(password, user.password_hash)) {
    throw new AuthenticationError('Invalid credentials');
  }

  const accessToken = generateJWT({
    user_id: user.user_id,
    tenant_id: user.tenant_id,
    role: user.role_name || 'User',
    email: user.email,
  });

  const session = await createSession(user.user_id, user.tenant_id);

  res.json({
    access_token: accessToken,
    refresh_token: session.refreshToken,
    user: {
      user_id: user.user_id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role_name || 'User',
    },
  });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    throw new InvalidTokenError('Refresh token is required');
  }

  let session;
  try {
    session = await validateSession(refresh_token);
  } catch (error) {
    throw new InvalidTokenError(error.message);
  }

  await revokeSessionByToken(refresh_token);

  const userResult = await pool.query(
    `SELECT u.user_id, u.tenant_id, u.email, r.role_name
     FROM users u
     LEFT JOIN user_roles ur ON u.user_id = ur.user_id
     LEFT JOIN roles r ON ur.role_id = r.role_id
     WHERE u.user_id = $1 LIMIT 1`,
    [session.userId]
  );

  if (userResult.rows.length === 0) {
    throw new InvalidTokenError('User not found');
  }

  const user = userResult.rows[0];

  const accessToken = generateJWT({
    user_id: user.user_id,
    tenant_id: user.tenant_id,
    role: user.role_name || 'User',
    email: user.email,
  });

  const newSession = await createSession(user.user_id, user.tenant_id);

  res.json({
    access_token: accessToken,
    refresh_token: newSession.refreshToken,
  });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    throw new InvalidTokenError('Refresh token is required');
  }

  await revokeSessionByToken(refresh_token);

  res.json({ success: true, message: 'Logged out successfully' });
}));

router.post('/register', asyncHandler(async (req, res) => {
  const { org_name, admin_email, admin_password } = req.body;
  const { ValidationError } = require('../middleware/errorHandler');

  if (!org_name || !admin_email || !admin_password) {
    throw new ValidationError('Missing required fields: org_name, admin_email, admin_password');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin_email)) {
    throw new ValidationError('Invalid email format');
  }

  if (admin_password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const { provisionTenant } = require('../services/tenantService');

  const issuerResult = await pool.query(
    `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id, name`,
    [org_name]
  );

  const result = await provisionTenant(issuerResult.rows[0].issuer_id, org_name, admin_email, admin_password);

  res.status(201).json({
    message: 'Organization registered successfully',
    tenant: result.tenant,
    admin_user: result.admin_user,
    default_roles: result.default_roles,
  });
}));

const { requirePermission } = require('../middleware/pdpMiddleware');
const { hashPassword } = require('../utils/passwordUtils');

router.post('/invite',
  ...requirePermission('users/*', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { email, password, role_id } = req.body;
    const { ValidationError } = require('../middleware/errorHandler');

    if (!email || !password || !role_id) {
      throw new ValidationError('Missing required fields: email, password, role_id');
    }
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters');
    }

    const tenant_id = req.user.tenant_id;

    const existing = await pool.query(`SELECT user_id FROM users WHERE email = $1`, [email]);
    if (existing.rows.length > 0) {
      throw new ValidationError('A user with this email already exists');
    }

    const roleCheck = await pool.query(
      `SELECT role_id, role_name FROM roles WHERE role_id = $1 AND tenant_id = $2`,
      [role_id, tenant_id]
    );
    if (roleCheck.rows.length === 0) {
      throw new ValidationError('Role not found in your organization');
    }

    const password_hash = await hashPassword(password);

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING user_id, email, tenant_id, created_at`,
      [tenant_id, email, password_hash]
    );
    const newUser = userResult.rows[0];

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
      [newUser.user_id, role_id, tenant_id]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: {
        user_id: newUser.user_id,
        email: newUser.email,
        tenant_id: newUser.tenant_id,
        role: roleCheck.rows[0].role_name,
        created_at: newUser.created_at,
      },
    });
  })
);

module.exports = router;
