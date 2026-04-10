const { pool } = require('../config/database');

const AUDITED_RESOURCES = ['files/*', 'reports/*', 'settings', 'users/*'];

function shouldAudit(resource, decision) {
  if (decision === 'DENY') return true;
  return AUDITED_RESOURCES.some(r => resource === r || resource.startsWith(r.replace('*', '')));
}

function logAuthorizationDecision(userId, tenantId, resource, action, decision, ipAddress) {
  if (!tenantId || !resource || !action || !decision) return;
  if (decision !== 'ALLOW' && decision !== 'DENY') return;
  if (!shouldAudit(resource, decision)) return;

  setImmediate(async () => {
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, tenant_id, resource, action, decision, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId || null, tenantId, resource, action, decision, ipAddress || null]
      );
    } catch (error) {
      console.error('Failed to write audit log:', error.message);
    }
  });
}

async function queryAuditLogs(tenantId, filters = {}) {
  if (!tenantId) throw new Error('tenantId is required');

  const { userId, resource, action, decision, startDate, endDate, limit = 100, offset = 0 } = filters;

  const conditions = ['tenant_id = $1'];
  const params = [tenantId];
  let p = 2;

  if (userId)    { conditions.push(`user_id = $${p++}`); params.push(userId); }
  if (resource)  { conditions.push(`resource = $${p++}`); params.push(resource); }
  if (action)    { conditions.push(`action = $${p++}`); params.push(action); }
  if (decision)  { conditions.push(`decision = $${p++}`); params.push(decision); }
  if (startDate) { conditions.push(`timestamp >= $${p++}`); params.push(startDate); }
  if (endDate)   { conditions.push(`timestamp <= $${p++}`); params.push(endDate); }

  const where = conditions.join(' AND ');

  try {
    const countResult = await pool.query(`SELECT COUNT(*) as total FROM audit_logs WHERE ${where}`, params);
    const dataResult = await pool.query(
      `SELECT log_id, user_id, tenant_id, resource, action, decision, ip_address, timestamp FROM audit_logs WHERE ${where} ORDER BY timestamp DESC LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );

    return {
      logs: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      page: Math.floor(offset / limit) + 1,
    };
  } catch (error) {
    console.error('Failed to query audit logs:', error);
    throw new Error('Failed to query audit logs');
  }
}

async function cleanupOldLogs(retentionDays = 90) {
  try {
    const result = await pool.query(
      "DELETE FROM audit_logs WHERE timestamp < NOW() - ($1 || ' days')::interval RETURNING log_id",
      [retentionDays]
    );
    return result.rowCount;
  } catch (error) {
    console.error('Failed to cleanup old audit logs:', error);
    throw new Error('Failed to cleanup old audit logs');
  }
}

module.exports = { logAuthorizationDecision, queryAuditLogs, cleanupOldLogs };
