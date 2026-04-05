/**
 * Role-Permission Assignment Routes
 * POST /api/tenants/:tenantId/roles/:roleId/permissions
 * GET  /api/tenants/:tenantId/roles/:roleId/permissions
 * DELETE /api/tenants/:tenantId/roles/:roleId/permissions/:permissionId
 */
const express = require('express');
const { assignPermissionToRole, removePermissionFromRole, getRolePermissions, getRole, traverseRoleHierarchy } = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { permissionCache } = require('../services/permissionCache');

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
    const direct = await getRolePermissions(tenantId, roleId);

    // Also get inherited permissions from parent roles
    const role = await getRole(tenantId, roleId);
    let inherited = [];
    if (role && role.parent_role_id) {
      const all = await traverseRoleHierarchy(tenantId, role.parent_role_id);
      // Mark inherited ones (exclude those already in direct)
      const directIds = new Set(direct.map(p => p.permission_id));
      inherited = all
        .filter(p => !directIds.has(p.permission_id))
        .map(p => ({ ...p, inherited: true }));
    }

    const permissions = [
      ...direct.map(p => ({ ...p, inherited: false })),
      ...inherited,
    ];
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
    permissionCache.invalidateTenant(tenantId);
    res.status(201).json({ assignment });
  })
);

router.delete('/:tenantId/roles/:roleId/permissions/:permissionId',
  ...requirePermission('roles', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId, roleId, permissionId } = req.params;
    await removePermissionFromRole(tenantId, roleId, permissionId);
    permissionCache.invalidateTenant(tenantId);
    res.json({ success: true, message: 'Permission removed from role' });
  })
);

module.exports = router;
