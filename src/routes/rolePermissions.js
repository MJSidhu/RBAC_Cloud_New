/**
 * Role-Permission Assignment Routes
 * POST /api/tenants/:tenantId/roles/:roleId/permissions
 * GET  /api/tenants/:tenantId/roles/:roleId/permissions
 * DELETE /api/tenants/:tenantId/roles/:roleId/permissions/:permissionId
 */
const express = require('express');
const { assignPermissionToRole, removePermissionFromRole, getRolePermissions } = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateTenant(req) {
  if (!uuidRegex.test(req.params.tenantId)) throw new ValidationError('Invalid tenant ID');
  if (req.user.tenant_id !== req.params.tenantId) throw new ValidationError('Tenant mismatch');
}

router.get('/:tenantId/roles/:roleId/permissions',
  ...requirePermission('roles', 'READ'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, roleId } = req.params;
    const permissions = await getRolePermissions(tenantId, roleId);
    res.json({ permissions, count: permissions.length });
  })
);

router.post('/:tenantId/roles/:roleId/permissions',
  ...requirePermission('roles', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, roleId } = req.params;
    const { permission_id } = req.body;
    if (!permission_id) throw new ValidationError('permission_id is required');
    const assignment = await assignPermissionToRole(tenantId, roleId, permission_id);
    res.status(201).json({ assignment });
  })
);

router.delete('/:tenantId/roles/:roleId/permissions/:permissionId',
  ...requirePermission('roles', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, roleId, permissionId } = req.params;
    await removePermissionFromRole(tenantId, roleId, permissionId);
    res.json({ success: true, message: 'Permission removed from role' });
  })
);

module.exports = router;
