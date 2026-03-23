/**
 * Audit Log API Routes
 * 
 * Implements audit log query endpoints with filtering and pagination.
 * Requirements: 8.5
 */

const express = require('express');
const { queryAuditLogs } = require('../services/auditService');
const { requirePermission } = require('../middleware/pdpMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/tenants/:tenantId/audit-logs
 * 
 * Query audit logs with optional filters and pagination.
 * 
 * Query Parameters:
 * - user_id: Filter by user ID (optional)
 * - resource: Filter by resource (optional)
 * - action: Filter by action (CREATE, READ, UPDATE, DELETE, SHARE) (optional)
 * - decision: Filter by decision (ALLOW, DENY) (optional)
 * - start_date: Filter by start date (ISO 8601 format) (optional)
 * - end_date: Filter by end date (ISO 8601 format) (optional)
 * - limit: Maximum number of results (default: 100) (optional)
 * - offset: Offset for pagination (default: 0) (optional)
 * 
 * Requirements:
 * - 8.5: Query audit logs with filters and pagination
 */
router.get(
  '/:tenantId/audit-logs',
  ...requirePermission('audit-logs', 'READ'),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    
    // Validate tenant ID matches JWT tenant (users can only query their own tenant's logs)
    if (req.user.tenant_id !== tenantId) {
      return res.status(403).json({
        error: {
          code: 'AUTHZ_FORBIDDEN',
          message: 'You can only query audit logs for your own tenant',
        },
      });
    }

    // Extract query parameters
    const {
      user_id: userId,
      resource,
      action,
      decision,
      start_date: startDateStr,
      end_date: endDateStr,
      limit,
      offset,
    } = req.query;

    // Parse and validate dates if provided
    let startDate, endDate;
    
    if (startDateStr) {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid start_date format. Use ISO 8601 format.',
          },
        });
      }
    }

    if (endDateStr) {
      endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid end_date format. Use ISO 8601 format.',
          },
        });
      }
    }

    // Validate decision if provided
    if (decision && decision !== 'ALLOW' && decision !== 'DENY') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid decision value. Must be ALLOW or DENY.',
        },
      });
    }

    // Validate action if provided
    const validActions = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'SHARE'];
    if (action && !validActions.includes(action)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid action value. Must be one of: ${validActions.join(', ')}`,
        },
      });
    }

    // Parse pagination parameters
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    // Validate pagination parameters
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid limit value. Must be between 1 and 1000.',
        },
      });
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid offset value. Must be 0 or greater.',
        },
      });
    }

    // Build filters object
    const filters = {
      userId,
      resource,
      action,
      decision,
      startDate,
      endDate,
      limit: parsedLimit,
      offset: parsedOffset,
    };

    // Query audit logs
    const result = await queryAuditLogs(tenantId, filters);

    // Return results
    res.json({
      audit_logs: result.logs,
      pagination: {
        total: result.total,
        page: result.page,
        limit: parsedLimit,
        offset: parsedOffset,
      },
    });
  })
);

module.exports = router;
