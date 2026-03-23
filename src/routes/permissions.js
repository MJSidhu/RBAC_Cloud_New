/**
 * Permission Management API Routes
 * 
 * Implements permission management endpoints for creating, listing, updating, and deleting permissions.
 * All endpoints are protected by PDP middleware to enforce authorization.
 * 
 * Requirements: 4.1
 */

const express = require('express');
const {
  createPermission,
  listPermissions,
  getPermission,
  updatePermission,
  deletePermission,
} = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError, ResourceNotFoundError } = require('../middleware/errorHandler');

const router = express.Router();

// Valid action types
const VALID_ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];

/**
 * POST /api/tenants/:tenantId/permissions
 * 
 * Create a new permission within a tenant.
 * 
 * Request Body:
 * - resource_name: Name/pattern of the resource (required)
 * - action: Action type (required, one of: CREATE, READ, UPDATE, DELETE, SHARE)
 * 
 * Response:
 * - permission_id: UUID of created permission
 * - tenant_id: UUID of tenant
 * - resource_name: Name/pattern of the resource
 * - action: Action type
 * - created_at: Timestamp of creation
 * 
 * Requirements:
 * - 4.1: Store permission records with unique permission_id, resource_name, action, and tenant_id
 */
router.post(
  '/:tenantId/permissions',
  ...requirePermission('permissions', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { resource_name, action } = req.body;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // Validate required fields
    if (!resource_name) {
      throw new ValidationError('Missing required field: resource_name');
    }

    if (!action) {
      throw new ValidationError('Missing required field: action');
    }

    // Validate action is one of the valid actions
    if (!VALID_ACTIONS.includes(action)) {
      throw new ValidationError(`Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
    }

    // Validate resource_name length
    if (resource_name.length < 1 || resource_name.length > 255) {
      throw new ValidationError('Resource name must be between 1 and 255 characters');
    }

    // Create permission
    const permission = await createPermission(tenantId, resource_name, action);

    // Return 201 Created with permission information
    res.status(201).json({
      permission,
    });
  })
);

/**
 * GET /api/tenants/:tenantId/permissions
 * 
 * List all permissions for a specific tenant.
 * Returns permissions ordered by resource_name.
 * 
 * Response:
 * - permissions: Array of permission objects
 * - count: Number of permissions returned
 * 
 * Requirements:
 * - 4.1: List permissions within a tenant
 */
router.get(
  '/:tenantId/permissions',
  ...requirePermission('permissions', 'READ'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // List permissions for tenant
    const permissions = await listPermissions(tenantId);

    res.json({
      permissions,
      count: permissions.length,
    });
  })
);

/**
 * PUT /api/tenants/:tenantId/permissions/:permissionId
 * 
 * Update permission information (resource_name and/or action).
 * 
 * Request Body:
 * - resource_name: New resource name/pattern (optional)
 * - action: New action type (optional, one of: CREATE, READ, UPDATE, DELETE, SHARE)
 * 
 * Response:
 * - permission: Updated permission object
 * 
 * Requirements:
 * - 4.1: Update permission records
 */
router.put(
  '/:tenantId/permissions/:permissionId',
  ...requirePermission('permissions', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId, permissionId } = req.params;
    const { resource_name, action } = req.body;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate permission ID format
    if (!uuidRegex.test(permissionId)) {
      throw new ValidationError('Invalid permission ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // Validate at least one field is provided
    if (resource_name === undefined && action === undefined) {
      throw new ValidationError('At least one field must be provided for update');
    }

    // Validate resource_name if provided
    if (resource_name !== undefined) {
      if (resource_name.length < 1 || resource_name.length > 255) {
        throw new ValidationError('Resource name must be between 1 and 255 characters');
      }
    }

    // Validate action if provided
    if (action !== undefined) {
      if (!VALID_ACTIONS.includes(action)) {
        throw new ValidationError(`Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
      }
    }

    // Build updates object
    const updates = {};
    if (resource_name !== undefined) updates.resourceName = resource_name;
    if (action !== undefined) updates.action = action;

    // Update permission
    const updatedPermission = await updatePermission(tenantId, permissionId, updates);

    res.json({
      permission: updatedPermission,
    });
  })
);

/**
 * DELETE /api/tenants/:tenantId/permissions/:permissionId
 * 
 * Delete a permission from the tenant.
 * This will cascade delete all role-permission assignments.
 * 
 * Response:
 * - success: Boolean indicating success
 * - message: Success message
 * - permission_id: UUID of deleted permission
 * 
 * Requirements:
 * - 4.1: Delete permission records
 */
router.delete(
  '/:tenantId/permissions/:permissionId',
  ...requirePermission('permissions', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId, permissionId } = req.params;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate permission ID format
    if (!uuidRegex.test(permissionId)) {
      throw new ValidationError('Invalid permission ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // Delete permission (will cascade delete role assignments)
    await deletePermission(tenantId, permissionId);

    res.json({
      success: true,
      message: 'Permission deleted successfully',
      permission_id: permissionId,
    });
  })
);

module.exports = router;
