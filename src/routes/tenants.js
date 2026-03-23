/**
 * Tenant Management API Routes
 * 
 * Implements tenant management endpoints for creating, listing, updating, and deleting tenants.
 * Requirements: 1.1, 11.1, 11.5
 */

const express = require('express');
const {
  provisionTenant,
  listTenants,
  getTenant,
  updateTenant,
  deleteTenant,
} = require('../services/tenantService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * POST /api/issuers/:issuerId/tenants
 * 
 * Create a new tenant with default roles, permissions, and admin user.
 * This endpoint provisions a complete tenant environment atomically.
 * 
 * Request Body:
 * - name: Tenant name (required)
 * - admin_email: Email for initial admin user (required)
 * - admin_password: Password for initial admin user (required)
 * 
 * Response:
 * - tenant: Created tenant information
 * - admin_user: Initial admin user information
 * - default_roles: List of default roles created
 * 
 * Requirements:
 * - 1.1: Store tenant records with unique tenant_id
 * - 1.2: Create tenant with default roles and permissions
 * - 11.1: Provide API endpoint for tenant creation
 * - 11.5: Return tenant_id and admin credentials in response
 */
router.post(
  '/issuers/:issuerId/tenants',
  asyncHandler(async (req, res) => {
    const { issuerId } = req.params;
    const { name, admin_email, admin_password } = req.body;

    // Validate required fields
    if (!name || !admin_email || !admin_password) {
      throw new ValidationError('Missing required fields: name, admin_email, admin_password');
    }

    // Validate name length
    if (name.length < 1 || name.length > 255) {
      throw new ValidationError('Tenant name must be between 1 and 255 characters');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(admin_email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate password strength
    if (admin_password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Validate issuer ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(issuerId)) {
      throw new ValidationError('Invalid issuer ID format');
    }

    // Provision tenant (atomic operation with rollback on failure)
    const result = await provisionTenant(issuerId, name, admin_email, admin_password);

    // Return 201 Created with tenant information
    res.status(201).json({
      tenant: result.tenant,
      admin_user: {
        user_id: result.admin_user.user_id,
        email: result.admin_user.email,
        created_at: result.admin_user.created_at,
      },
      default_roles: result.default_roles,
    });
  })
);

/**
 * GET /api/issuers/:issuerId/tenants
 * 
 * List all tenants for a specific issuer.
 * 
 * Requirements:
 * - 11.5: Provide API endpoint for listing tenants
 */
router.get(
  '/issuers/:issuerId/tenants',
  ...requirePermission('tenants', 'READ'),
  asyncHandler(async (req, res) => {
    const { issuerId } = req.params;

    // Validate issuer ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(issuerId)) {
      throw new ValidationError('Invalid issuer ID format');
    }

    // List tenants for issuer
    const tenants = await listTenants(issuerId);

    res.json({
      tenants,
      count: tenants.length,
    });
  })
);

/**
 * PUT /api/tenants/:tenantId
 * 
 * Update tenant information (currently only name can be updated).
 * 
 * Request Body:
 * - name: New tenant name (optional)
 * 
 * Requirements:
 * - 11.5: Provide API endpoint for updating tenants
 */
router.put(
  '/tenants/:tenantId',
  ...requirePermission('tenants', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { name } = req.body;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Validate update fields
    if (!name) {
      throw new ValidationError('At least one field must be provided for update');
    }

    if (name && (name.length < 1 || name.length > 255)) {
      throw new ValidationError('Tenant name must be between 1 and 255 characters');
    }

    // Update tenant
    const updates = {};
    if (name) updates.name = name;

    const updatedTenant = await updateTenant(tenantId, updates);

    res.json({
      tenant: updatedTenant,
    });
  })
);

/**
 * DELETE /api/tenants/:tenantId
 * 
 * Delete tenant and all associated data (cascade delete).
 * This operation is irreversible and will delete:
 * - All users in the tenant
 * - All roles and permissions
 * - All role assignments
 * - All trust relationships
 * - All audit logs
 * 
 * Requirements:
 * - 11.5: Provide API endpoint for deleting tenants
 * - 13.3: Foreign key constraints with cascade delete
 */
router.delete(
  '/tenants/:tenantId',
  ...requirePermission('tenants', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;

    // Validate tenant ID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new ValidationError('Invalid tenant ID format');
    }

    // Delete tenant (cascade delete will remove all associated data)
    await deleteTenant(tenantId);

    res.json({
      success: true,
      message: 'Tenant deleted successfully',
      tenant_id: tenantId,
    });
  })
);

module.exports = router;
