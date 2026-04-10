const express = require('express');
const { createRole, listRoles, getRole, updateRole, deleteRole } = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { permissionCache } = require('../services/permissionCache');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateTenantAccess(req, tenantId) {
  if (!uuidRegex.test(tenantId)) throw new ValidationError('Invalid tenant ID format');
  if (req.user.tenant_id !== tenantId) throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
}

router.post('/:tenantId/roles',
  ...requirePermission('roles', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { role_name, parent_role_id } = req.body;
    validateTenantAccess(req, tenantId);
    if (!role_name) throw new ValidationError('Missing required field: role_name');
    if (role_name.length < 1 || role_name.length > 100) throw new ValidationError('Role name must be between 1 and 100 characters');
    if (parent_role_id != null && !uuidRegex.test(parent_role_id)) throw new ValidationError('Invalid parent_role_id format');
    const role = await createRole(tenantId, role_name, parent_role_id || null);
    res.status(201).json({ role });
  })
);

router.get('/:tenantId/roles',
  ...requirePermission('roles', 'READ'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    validateTenantAccess(req, tenantId);
    const roles = await listRoles(tenantId);
    res.json({ roles, count: roles.length });
  })
);

router.put('/:tenantId/roles/:roleId',
  ...requirePermission('roles', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId, roleId } = req.params;
    const { role_name, parent_role_id } = req.body;
    validateTenantAccess(req, tenantId);
    if (!uuidRegex.test(roleId)) throw new ValidationError('Invalid role ID format');
    if (role_name === undefined && parent_role_id === undefined) throw new ValidationError('At least one field must be provided for update');
    if (role_name !== undefined && (role_name.length < 1 || role_name.length > 100)) throw new ValidationError('Role name must be between 1 and 100 characters');
    if (parent_role_id != null && !uuidRegex.test(parent_role_id)) throw new ValidationError('Invalid parent_role_id format');

    const updates = {};
    if (role_name !== undefined) updates.roleName = role_name;
    if (parent_role_id !== undefined) updates.parentRoleId = parent_role_id;

    const updatedRole = await updateRole(tenantId, roleId, updates);
    permissionCache.invalidateTenant(tenantId);
    res.json({ role: updatedRole });
  })
);

router.delete('/:tenantId/roles/:roleId',
  ...requirePermission('roles', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId, roleId } = req.params;
    validateTenantAccess(req, tenantId);
    if (!uuidRegex.test(roleId)) throw new ValidationError('Invalid role ID format');
    await deleteRole(tenantId, roleId);
    permissionCache.invalidateTenant(tenantId);
    res.json({ success: true, message: 'Role deleted successfully', role_id: roleId });
  })
);

module.exports = router;
