const express = require('express');
const { queryAuditLogs } = require('../services/auditService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
const VALID_ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];

router.get('/:tenantId/audit-logs',
  ...requirePermission('audit-logs', 'READ'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;

    if (req.user.tenant_id !== tenantId) {
      return res.status(403).json({
        error: { code: 'AUTHZ_FORBIDDEN', message: 'You can only query audit logs for your own tenant' },
      });
    }

    const { user_id: userId, resource, action, decision, start_date: startDateStr, end_date: endDateStr, limit, offset } = req.query;

    let startDate, endDate;

    if (startDateStr) {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid start_date format. Use ISO 8601 format.' } });
      }
    }

    if (endDateStr) {
      endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid end_date format. Use ISO 8601 format.' } });
      }
    }

    if (decision && decision !== 'ALLOW' && decision !== 'DENY') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid decision value. Must be ALLOW or DENY.' } });
    }

    if (action && !VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid action value. Must be one of: ${VALID_ACTIONS.join(', ')}` } });
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid limit value. Must be between 1 and 1000.' } });
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid offset value. Must be 0 or greater.' } });
    }

    const result = await queryAuditLogs(tenantId, { userId, resource, action, decision, startDate, endDate, limit: parsedLimit, offset: parsedOffset });

    res.json({
      audit_logs: result.logs,
      pagination: { total: result.total, page: result.page, limit: parsedLimit, offset: parsedOffset },
    });
  })
);

module.exports = router;
