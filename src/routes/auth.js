/**
 * Authentication API Routes
 * 
 * Implements authentication endpoints for login, token refresh, and logout.
 * Requirements: 2.2, 2.5, 10.4
 */

const express = require('express');
const { pool } = require('../config/database');
const { generateJWT, validateJWT } = require('../utils/jwtUtils');
const { comparePassword } = require('../utils/passwordUtils');
const { 
  createSession, 
  validateSession, 
  revokeSessionByToken 
} = require('../services/sessionService');
const { 
  AuthenticationError, 
  InvalidTokenError,
  asyncHandler 
} = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /api/auth/login
 * 
 * Authenticate user with email and password, return JWT and refresh token.
 * 
 * Requirements:
 * - 2.2: Authenticate user and generate JWT
 * - 2.5: Return uniform error message for failed authentication
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    throw new AuthenticationError('Invalid credentials');
  }

  // Query user by email
  const userQuery = `
    SELECT u.user_id, u.tenant_id, u.email, u.password_hash, r.role_name
    FROM users u
    LEFT JOIN user_roles ur ON u.user_id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.role_id
    WHERE u.email = $1
    LIMIT 1
  `;

  const userResult = await pool.query(userQuery, [email]);

  // Uniform error message - don't reveal if email exists or not (Requirement 2.5)
  if (userResult.rows.length === 0) {
    throw new AuthenticationError('Invalid credentials');
  }

  const user = userResult.rows[0];

  // Verify password
  const isPasswordValid = await comparePassword(password, user.password_hash);

  // Uniform error message - don't reveal if email or password was wrong (Requirement 2.5)
  if (!isPasswordValid) {
    throw new AuthenticationError('Invalid credentials');
  }

  // Generate JWT with user information (Requirement 2.2)
  const accessToken = generateJWT({
    user_id: user.user_id,
    tenant_id: user.tenant_id,
    role: user.role_name || 'User',
    email: user.email
  });

  // Create session with refresh token (Requirement 10.3)
  const session = await createSession(user.user_id, user.tenant_id);

  // Return tokens and user info
  res.json({
    access_token: accessToken,
    refresh_token: session.refreshToken,
    user: {
      user_id: user.user_id,
      email: user.email,
      tenant_id: user.tenant_id,
      role: user.role_name || 'User'
    }
  });
}));

/**
 * POST /api/auth/refresh
 * 
 * Exchange refresh token for new access token and refresh token.
 * 
 * Requirements:
 * - 10.4: Issue new JWT and refresh token pair when refresh token is used
 * - 10.5: Invalidate refresh token after use (one-time use)
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  // Validate input
  if (!refresh_token) {
    throw new InvalidTokenError('Refresh token is required');
  }

  // Validate refresh token and get session info
  let session;
  try {
    session = await validateSession(refresh_token);
  } catch (error) {
    // Convert session validation errors to InvalidTokenError
    throw new InvalidTokenError(error.message);
  }

  // Revoke the old refresh token (one-time use - Requirement 10.5)
  await revokeSessionByToken(refresh_token);

  // Get user information for new JWT
  const userQuery = `
    SELECT u.user_id, u.tenant_id, u.email, r.role_name
    FROM users u
    LEFT JOIN user_roles ur ON u.user_id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.role_id
    WHERE u.user_id = $1
    LIMIT 1
  `;

  const userResult = await pool.query(userQuery, [session.userId]);

  if (userResult.rows.length === 0) {
    throw new InvalidTokenError('User not found');
  }

  const user = userResult.rows[0];

  // Generate new JWT
  const accessToken = generateJWT({
    user_id: user.user_id,
    tenant_id: user.tenant_id,
    role: user.role_name || 'User',
    email: user.email
  });

  // Create new session with new refresh token (Requirement 10.4)
  const newSession = await createSession(user.user_id, user.tenant_id);

  // Return new tokens
  res.json({
    access_token: accessToken,
    refresh_token: newSession.refreshToken
  });
}));

/**
 * POST /api/auth/logout
 * 
 * Revoke refresh token to log out user.
 * 
 * Requirements:
 * - 10.5: Invalidate refresh token on logout
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  // Validate input
  if (!refresh_token) {
    throw new InvalidTokenError('Refresh token is required');
  }

  // Revoke the refresh token
  await revokeSessionByToken(refresh_token);

  // Return success response
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

/**
 * POST /api/auth/register
 *
 * Register a new organization (creates issuer + tenant + admin user atomically).
 *
 * Request Body:
 * - org_name: Organization/tenant name (required)
 * - admin_email: Admin user email (required)
 * - admin_password: Admin user password (required, min 8 chars)
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { org_name, admin_email, admin_password } = req.body;

  if (!org_name || !admin_email || !admin_password) {
    const { ValidationError } = require('../middleware/errorHandler');
    throw new ValidationError('Missing required fields: org_name, admin_email, admin_password');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(admin_email)) {
    const { ValidationError } = require('../middleware/errorHandler');
    throw new ValidationError('Invalid email format');
  }

  if (admin_password.length < 8) {
    const { ValidationError } = require('../middleware/errorHandler');
    throw new ValidationError('Password must be at least 8 characters');
  }

  const { provisionTenant } = require('../services/tenantService');

  // Create issuer first, then provision tenant under it
  const issuerResult = await pool.query(
    `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id, name`,
    [org_name]
  );
  const issuer = issuerResult.rows[0];

  const result = await provisionTenant(issuer.issuer_id, org_name, admin_email, admin_password);

  res.status(201).json({
    message: 'Organization registered successfully',
    tenant: result.tenant,
    admin_user: result.admin_user,
    default_roles: result.default_roles,
  });
}));

/**
 * POST /api/auth/invite
 *
 * Admin creates a new user within their tenant and assigns a role.
 * Requires: users:CREATE permission
 *
 * Request Body:
 * - email: New user's email (required)
 * - password: New user's password (required, min 8 chars)
 * - role_id: Role UUID to assign (required)
 */
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

    // Check email not already taken globally (across all tenants)
    const existing = await pool.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      throw new ValidationError('A user with this email already exists');
    }

    // Verify role belongs to this tenant
    const roleCheck = await pool.query(
      'SELECT role_id, role_name FROM roles WHERE role_id = $1 AND tenant_id = $2',
      [role_id, tenant_id]
    );
    if (roleCheck.rows.length === 0) {
      throw new ValidationError('Role not found in your organization');
    }

    const password_hash = await hashPassword(password);

    // Insert user
    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING user_id, email, tenant_id, created_at`,
      [tenant_id, email, password_hash]
    );
    const newUser = userResult.rows[0];

    // Assign role
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
