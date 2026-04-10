const { pool } = require('../config/database');

async function validateExposedRole(trusterTenantId, exposedRoleId) {
  const result = await pool.query(
    `SELECT role_id FROM roles WHERE role_id = $1 AND tenant_id = $2`,
    [exposedRoleId, trusterTenantId]
  );
  return result.rows.length > 0;
}

async function detectCircularTrust(trusterTenantId, trusteeTenantId) {
  const visited = new Set();
  const queue = [trusteeTenantId];

  while (queue.length > 0) {
    const currentTenant = queue.shift();

    if (visited.has(currentTenant)) continue;
    visited.add(currentTenant);

    if (currentTenant === trusterTenantId) return true;

    const result = await pool.query(
      `SELECT DISTINCT trustee_tenant_id FROM tenant_trust
       WHERE truster_tenant_id = $1 AND is_active = true`,
      [currentTenant]
    );

    for (const row of result.rows) {
      if (!visited.has(row.trustee_tenant_id)) queue.push(row.trustee_tenant_id);
    }
  }

  return false;
}

async function createTrustRelationship(trusterTenantId, trusteeTenantId, exposedRoleId) {
  if (!trusterTenantId || !trusteeTenantId || !exposedRoleId) {
    throw new Error('Missing required parameters: trusterTenantId, trusteeTenantId, and exposedRoleId are required');
  }

  if (trusterTenantId === trusteeTenantId) {
    throw new Error('Cannot create trust relationship with the same tenant');
  }

  if (!await validateExposedRole(trusterTenantId, exposedRoleId)) {
    throw new Error('Exposed role does not belong to the truster tenant');
  }

  if (await detectCircularTrust(trusterTenantId, trusteeTenantId)) {
    throw new Error('Cannot create trust relationship: would create circular trust dependency');
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenant_trust (truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at`,
      [trusterTenantId, trusteeTenantId, exposedRoleId]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Trust relationship already exists between these tenants for this role');
    }
    throw error;
  }
}

async function activateTrust(trustId) {
  if (!trustId) throw new Error('Trust ID is required');

  const result = await pool.query(
    `UPDATE tenant_trust SET is_active = true WHERE trust_id = $1
     RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at`,
    [trustId]
  );

  if (result.rows.length === 0) throw new Error('Trust relationship not found');

  return result.rows[0];
}

async function deactivateTrust(trustId) {
  if (!trustId) throw new Error('Trust ID is required');

  const result = await pool.query(
    `UPDATE tenant_trust SET is_active = false WHERE trust_id = $1
     RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at`,
    [trustId]
  );

  if (result.rows.length === 0) throw new Error('Trust relationship not found');

  return result.rows[0];
}

async function listTrustRelationships(tenantId, options = {}) {
  if (!tenantId) throw new Error('Tenant ID is required');

  const { role = 'all', activeOnly = false } = options;

  let query = `
    SELECT
      tt.trust_id, tt.truster_tenant_id, tt.trustee_tenant_id,
      tt.exposed_role_id, tt.is_active, tt.created_at,
      t_truster.name as truster_tenant_name,
      t_trustee.name as trustee_tenant_name,
      r.role_name as exposed_role_name
    FROM tenant_trust tt
    JOIN tenants t_truster ON tt.truster_tenant_id = t_truster.tenant_id
    JOIN tenants t_trustee ON tt.trustee_tenant_id = t_trustee.tenant_id
    JOIN roles r ON tt.exposed_role_id = r.role_id
    WHERE 1=1
  `;

  const params = [tenantId];

  if (role === 'truster') {
    query += ` AND tt.truster_tenant_id = $1`;
  } else if (role === 'trustee') {
    query += ` AND tt.trustee_tenant_id = $1`;
  } else {
    query += ` AND (tt.truster_tenant_id = $1 OR tt.trustee_tenant_id = $1)`;
  }

  if (activeOnly) query += ` AND tt.is_active = true`;

  query += ` ORDER BY tt.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

async function getTrustRelationship(trustId) {
  if (!trustId) throw new Error('Trust ID is required');

  const result = await pool.query(
    `SELECT
      tt.trust_id, tt.truster_tenant_id, tt.trustee_tenant_id,
      tt.exposed_role_id, tt.is_active, tt.created_at,
      t_truster.name as truster_tenant_name,
      t_trustee.name as trustee_tenant_name,
      r.role_name as exposed_role_name
     FROM tenant_trust tt
     JOIN tenants t_truster ON tt.truster_tenant_id = t_truster.tenant_id
     JOIN tenants t_trustee ON tt.trustee_tenant_id = t_trustee.tenant_id
     JOIN roles r ON tt.exposed_role_id = r.role_id
     WHERE tt.trust_id = $1`,
    [trustId]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

async function deleteTrustRelationship(trustId) {
  if (!trustId) throw new Error('Trust ID is required');

  const result = await pool.query(`DELETE FROM tenant_trust WHERE trust_id = $1`, [trustId]);
  return result.rowCount > 0;
}

module.exports = {
  createTrustRelationship,
  activateTrust,
  deactivateTrust,
  listTrustRelationships,
  getTrustRelationship,
  deleteTrustRelationship,
  validateExposedRole,
  detectCircularTrust,
};
