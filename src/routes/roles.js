/**
 * Role Management API Routes
 * 
 * Implements role management endpoints for creating, listing, updating, and deleting roles.
 * All endpoints are protected by PDP middleware to enforce authorization.
 * 
 * Requirements: 3.1
 */

const express = require('express');
const {
  createRole,
  listRoles,
  getRole,
  updateRole,
  deleteRole,
} = require('../services/rbacService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError, ResourceNotFoundError } = require('../middleware/errorHandler');
const { permissionCache } = require('../services/permissionCache');

const router = express.Router();

/**
 * POST /api/tenants/:tenantId/roles
 * 
 * Create a new role within a tenant.
 * Supports role hierarchy by specifying an optional parent_role_id.
 * 
 * Request Body:
 * - role_name: Name of the role (required, 1-100 characters)
 * - parent_role_id: UUID of parent role for hierarchy (optional)
 * 
 * Response:
 * - role_id: UUID of created role
 * - tenant_id: UUID of tenant
 * - role_name: Name of the role
 * - parent_role_id: UUID of parent role (null if no parent)
 * - created_at: Timestamp of creation
 * 
 * Requirements:
 * - 3.1: Store role records with unique role_id, role_name, tenant_id, and optional parent_role_id
 */
router.post(
  '/:tenantId/roles',
  ...requirePermission('roles', 'CREATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { role_name, parent_role_id } = req.body;

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
    if (!role_name) {
      throw new ValidationError('Missing required field: role_name');
    }

    // Validate role_name length and format
    if (role_name.length < 1 || role_name.length > 100) {
      throw new ValidationError('Role name must be between 1 and 100 characters');
    }

    // Validate parent_role_id format if provided
    if (parent_role_id !== undefined && parent_role_id !== null) {
      if (!uuidRegex.test(parent_role_id)) {
        throw new ValidationError('Invalid parent_role_id format');
      }
    }

    // Create role (will validate hierarchy depth and cycles)
    const role = await createRole(tenantId, role_name, parent_role_id || null);

    // Return 201 Created with role information
    res.status(201).json({
      role,
    });
  })
);

/**
 * GET /api/tenants/:tenantId/roles
 * 
 * List all roles for a specific tenant.
 * Returns roles ordered by role_name.
 * 
 * Response:
 * - roles: Array of role objects
 * - count: Number of roles returned
 * 
 * Requirements:
 * - 3.1: List roles within a tenant
 */
router.get(
  '/:tenantId/roles',
  ...requirePermission('roles', 'READ'),
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

    // List roles for tenant
    const roles = await listRoles(tenantId);

    res.json({
      roles,
      count: roles.length,
    });
  })
);

/**
 * PUT /api/tenants/:tenantId/roles/:roleId
 * 
 * Update role information (name and/or parent role).
 * 
 * Request Body:
 * - role_name: New role name (optional)
 * - parent_role_id: New parent role UUID or null to remove parent (optional)
 * 
 * Response:
 * - role: Updated role object
 * 
 * Requirements:
 * - 3.1: Update role records
 */
router.put(
  '/:tenantId/roles/:roleId',
  ...requirePermission('roles', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId, roleId } = req.params;
    const { role_name, parent_role_id } = req.body;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate role ID format
    if (!uuidRegex.test(roleId)) {
      throw new ValidationError('Invalid role ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // Validate at least one field is provided
    if (role_name === undefined && parent_role_id === undefined) {
      throw new ValidationError('At least one field must be provided for update');
    }

    // Validate role_name if provided
    if (role_name !== undefined) {
      if (role_name.length < 1 || role_name.length > 100) {
        throw new ValidationError('Role name must be between 1 and 100 characters');
      }
    }

    // Validate parent_role_id format if provided
    if (parent_role_id !== undefined && parent_role_id !== null) {
      if (!uuidRegex.test(parent_role_id)) {
        throw new ValidationError('Invalid parent_role_id format');
      }
    }

    // Build updates object
    const updates = {};
    if (role_name !== undefined) updates.roleName = role_name;
    if (parent_role_id !== undefined) updates.parentRoleId = parent_role_id;

    // Update role (will validate hierarchy if parent is changed)
    const updatedRole = await updateRole(tenantId, roleId, updates);

    // Invalidate cache for all users in tenant — permissions may have changed
    permissionCache.invalidateTenant(tenantId);

    res.json({
      role: updatedRole,
    });
  })
);

/**
 * DELETE /api/tenants/:tenantId/roles/:roleId
 * 
 * Delete a role from the tenant.
 * This will cascade delete all role assignments and permissions.
 * 
 * Response:
 * - success: Boolean indicating success
 * - message: Success message
 * - role_id: UUID of deleted role
 * 
 * Requirements:
 * - 3.1: Delete role records
 */
router.delete(
  '/:tenantId/roles/:roleId',
  ...requirePermission('roles', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId, roleId } = req.params;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate role ID format
    if (!uuidRegex.test(roleId)) {
      throw new ValidationError('Invalid role ID format');
    }

    // Validate tenant ID matches JWT tenant for security
    if (req.user.tenant_id !== tenantId) {
      throw new ValidationError('Tenant ID in URL does not match authenticated user tenant');
    }

    // Delete role (will cascade delete assignments and permissions)
    await deleteRole(tenantId, roleId);

    // Invalidate cache for all users in tenant
    permissionCache.invalidateTenant(tenantId);

    res.json({
      success: true,
      message: 'Role deleted successfully',
      role_id: roleId,
    });
  })
);

module.exports = router;
