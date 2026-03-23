/**
 * User-Role Assignment Routes
 * GET    /api/tenants/:tenantId/users
 * GET    /api/tenants/:tenantId/users/:userId/roles
 * POST   /api/tenants/:tenantId/users/:userId/roles
 * DELETE /api/tenants/:tenantId/users/:userId/roles/:roleId
 */
const express = require('express');
const { assignRoleToUser, removeRoleFromUser, getUserRoles } = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { pool } = require('../config/database');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateTenant(req) {
  if (!uuidRegex.test(req.params.tenantId)) throw new ValidationError('Invalid tenant ID');
  if (req.user.tenant_id !== req.params.tenantId) throw new ValidationError('Tenant mismatch');
}

// List all users in a tenant
router.get('/:tenantId/users',
  ...requirePermission('users', 'READ'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId } = req.params;
    const result = await pool.query(
      `SELECT u.user_id, u.email, u.created_at,
        COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.user_id = ur.user_id AND ur.tenant_id = $1
       LEFT JOIN roles r ON ur.role_id = r.role_id
       WHERE u.tenant_id = $1
       GROUP BY u.user_id ORDER BY u.created_at DESC`,
      [tenantId]
    );
    res.json({ users: result.rows, count: result.rows.length });
  })
);

// Get roles for a specific user
router.get('/:tenantId/users/:userId/roles',
  ...requirePermission('users', 'READ'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, userId } = req.params;
    const roles = await getUserRoles(tenantId, userId);
    res.json({ roles, count: roles.length });
  })
);

// Assign role to user
router.post('/:tenantId/users/:userId/roles',
  ...requirePermission('users', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, userId } = req.params;
    const { role_id } = req.body;
    if (!role_id) throw new ValidationError('role_id is required');
    const assignment = await assignRoleToUser(tenantId, userId, role_id);
    res.status(201).json({ assignment });
  })
);

// Remove role from user
router.delete('/:tenantId/users/:userId/roles/:roleId',
  ...requirePermission('users', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, userId, roleId } = req.params;
    await removeRoleFromUser(tenantId, userId, roleId);
    res.json({ success: true, message: 'Role removed from user' });
  })
);

module.exports = router;
