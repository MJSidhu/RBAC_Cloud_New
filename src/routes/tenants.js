const express = require('express');
const { provisionTenant, listTenants, updateTenant, deleteTenant } = require('../services/tenantService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post('/issuers/:issuerId/tenants', asyncHandler(async (req, res) => {
  const { issuerId } = req.params;
  const { name, admin_email, admin_password } = req.body;

  if (!name || !admin_email || !admin_password) {
    throw new ValidationError('Missing required fields: name, admin_email, admin_password');
  }
  if (name.length < 1 || name.length > 255) {
    throw new ValidationError('Tenant name must be between 1 and 255 characters');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin_email)) {
    throw new ValidationError('Invalid email format');
  }
  if (admin_password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }
  if (!uuidRegex.test(issuerId)) {
    throw new ValidationError('Invalid issuer ID format');
  }

  const result = await provisionTenant(issuerId, name, admin_email, admin_password);

  res.status(201).json({
    tenant: result.tenant,
    admin_user: {
      user_id: result.admin_user.user_id,
      email: result.admin_user.email,
      created_at: result.admin_user.created_at,
    },
    default_roles: result.default_roles,
  });
}));

router.get('/issuers/:issuerId/tenants',
  ...requirePermission('tenants', 'READ'),
  asyncHandler(async (req, res) => {
    const { issuerId } = req.params;
    if (!uuidRegex.test(issuerId)) throw new ValidationError('Invalid issuer ID format');
    const tenants = await listTenants(issuerId);
    res.json({ tenants, count: tenants.length });
  })
);

router.put('/tenants/:tenantId',
  ...requirePermission('tenants', 'UPDATE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const { name } = req.body;
    if (!uuidRegex.test(tenantId)) throw new ValidationError('Invalid tenant ID format');
    if (!name) throw new ValidationError('At least one field must be provided for update');
    if (name.length < 1 || name.length > 255) throw new ValidationError('Tenant name must be between 1 and 255 characters');
    const updatedTenant = await updateTenant(tenantId, { name });
    res.json({ tenant: updatedTenant });
  })
);

router.delete('/tenants/:tenantId',
  ...requirePermission('tenants', 'DELETE'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    if (!uuidRegex.test(tenantId)) throw new ValidationError('Invalid tenant ID format');
    await deleteTenant(tenantId);
    res.json({ success: true, message: 'Tenant deleted successfully', tenant_id: tenantId });
  })
);

module.exports = router;
