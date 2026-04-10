const express = require('express');
const { createPermission, listPermissions, updatePermission, deletePermission } = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];

function validateTenantAccess(req, tenantId) {
  if (!uuidRegex.test(tenantId)) throw new ValidationError('Invalid tenant ID format');
  if (req.user.tenant_id !== tenantId) throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
}

router.post('/:tenantId/permissions',
  ...requirePermission('permissions', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { resource_name, action } = req.body;
    validateTenantAccess(req, tenantId);
    if (!resource_name) throw new ValidationError('Missing required field: resource_name');
    if (!action) throw new ValidationError('Missing required field: action');
    if (!VALID_ACTIONS.includes(action)) throw new ValidationError(`Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
    if (resource_name.length < 1 || resource_name.length > 255) throw new ValidationError('Resource name must be between 1 and 255 characters');
    const permission = await createPermission(tenantId, resource_name, action);
    res.status(201).json({ permission });
  })
);

router.get('/:tenantId/permissions',
  ...requirePermission('permissions', 'READ'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    validateTenantAccess(req, tenantId);
    const permissions = await listPermissions(tenantId);
    res.json({ permissions, count: permissions.length });
  })
);

router.put('/:tenantId/permissions/:permissionId',
  ...requirePermission('permissions', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId, permissionId } = req.params;
    const { resource_name, action } = req.body;
    validateTenantAccess(req, tenantId);
    if (!uuidRegex.test(permissionId)) throw new ValidationError('Invalid permission ID format');
    if (resource_name === undefined && action === undefined) throw new ValidationError('At least one field must be provided for update');
    if (resource_name !== undefined && (resource_name.length < 1 || resource_name.length > 255)) throw new ValidationError('Resource name must be between 1 and 255 characters');
    if (action !== undefined && !VALID_ACTIONS.includes(action)) throw new ValidationError(`Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);

    const updates = {};
    if (resource_name !== undefined) updates.resourceName = resource_name;
    if (action !== undefined) updates.action = action;

    const updatedPermission = await updatePermission(tenantId, permissionId, updates);
    res.json({ permission: updatedPermission });
  })
);

router.delete('/:tenantId/permissions/:permissionId',
  ...requirePermission('permissions', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId, permissionId } = req.params;
    validateTenantAccess(req, tenantId);
    if (!uuidRegex.test(permissionId)) throw new ValidationError('Invalid permission ID format');
    await deletePermission(tenantId, permissionId);
    res.json({ success: true, message: 'Permission deleted successfully', permission_id: permissionId });
  })
);

module.exports = router;
