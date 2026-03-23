/**
 * Trust Relationship Routes
 * POST   /api/tenants/:tenantId/trust
 * GET    /api/tenants/:tenantId/trust
 * PUT    /api/tenants/:tenantId/trust/:trustId
 * DELETE /api/tenants/:tenantId/trust/:trustId
 */
const express = require('express');
const {
  createTrustRelationship,
  activateTrust,
  deactivateTrust,
  listTrustRelationships,
  deleteTrustRelationship,
} = require('../services/trustService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

const router = express.Router();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateTenant(req) {
  if (!uuidRegex.test(req.params.tenantId)) throw new ValidationError('Invalid tenant ID');
  if (req.user.tenant_id !== req.params.tenantId) throw new ValidationError('Tenant mismatch');
}

router.post('/:tenantId/trust',
  ...requirePermission('trust', 'CREATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId } = req.params;
    const { trustee_tenant_id, exposed_role_id } = req.body;
    if (!trustee_tenant_id || !exposed_role_id) {
      throw new ValidationError('trustee_tenant_id and exposed_role_id are required');
    }
    const trust = await createTrustRelationship(tenantId, trustee_tenant_id, exposed_role_id);
    res.status(201).json({ trust });
  })
);

router.get('/:tenantId/trust',
  ...requirePermission('trust', 'READ'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { tenantId } = req.params;
    const relationships = await listTrustRelationships(tenantId);
    res.json({ relationships, count: relationships.length });
  })
);

router.put('/:tenantId/trust/:trustId',
  ...requirePermission('trust', 'UPDATE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { trustId } = req.params;
    const { is_active } = req.body;
    if (is_active === undefined) throw new ValidationError('is_active is required');
    const trust = is_active ? await activateTrust(trustId) : await deactivateTrust(trustId);
    res.json({ trust });
  })
);

router.delete('/:tenantId/trust/:trustId',
  ...requirePermission('trust', 'DELETE'),
  asyncHandler(async (req, res) => {
    validateTenant(req);
    const { trustId } = req.params;
    await deleteTrustRelationship(trustId);
    res.json({ success: true, message: 'Trust relationship deleted' });
  })
);

module.exports = router;
