/**
 * Trust Relationship Management Service
 * 
 * Manages cross-tenant trust relationships that allow one tenant (truster) 
 * to expose specific roles to another tenant (trustee).
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

const { pool } = require('../config/database');

/**
 * Validates that the exposed role belongs to the truster tenant
 * 
 * @param {string} trusterTenantId - The tenant exposing the role
 * @param {string} exposedRoleId - The role being exposed
 * @returns {Promise<boolean>} - True if valid, false otherwise
 */
async function validateExposedRole(trusterTenantId, exposedRoleId) {
  const query = `
    SELECT role_id 
    FROM roles 
    WHERE role_id = $1 AND tenant_id = $2
  `;
  
  const result = await pool.query(query, [exposedRoleId, trusterTenantId]);
  return result.rows.length > 0;
}

/**
 * Detects circular trust relationships using graph traversal
 * 
 * Checks if creating a trust from trusterTenantId to trusteeTenantId
 * would create a cycle in the trust graph.
 * 
 * A cycle exists if: trustee can reach truster through existing trust relationships
 * Example: If A trusts B, and we try to create B trusts A, that's a cycle
 * 
 * @param {string} trusterTenantId - The tenant exposing the role
 * @param {string} trusteeTenantId - The tenant receiving access
 * @returns {Promise<boolean>} - True if circular trust detected, false otherwise
 */
async function detectCircularTrust(trusterTenantId, trusteeTenantId) {
  // If trustee can reach truster through existing trusts,
  // then truster trusting trustee would create a cycle
  
  // We need to check if there's a path from trustee to truster
  // A path exists if trustee trusts someone who trusts someone... who trusts truster
  
  const visited = new Set();
  const queue = [trusteeTenantId];
  
  while (queue.length > 0) {
    const currentTenant = queue.shift();
    
    if (visited.has(currentTenant)) {
      continue;
    }
    
    visited.add(currentTenant);
    
    // If we reach the truster tenant, we found a path back, which means a cycle
    if (currentTenant === trusterTenantId) {
      return true;
    }
    
    // Get all tenants that currentTenant trusts (where currentTenant is the truster)
    // This gives us the direction: currentTenant -> other tenants
    const query = `
      SELECT DISTINCT trustee_tenant_id 
      FROM tenant_trust 
      WHERE truster_tenant_id = $1 AND is_active = true
    `;
    
    const result = await pool.query(query, [currentTenant]);
    
    for (const row of result.rows) {
      if (!visited.has(row.trustee_tenant_id)) {
        queue.push(row.trustee_tenant_id);
      }
    }
  }
  
  return false;
}

/**
 * Creates a new trust relationship between two tenants
 * 
 * Validates:
 * - Exposed role belongs to truster tenant (Requirement 5.3)
 * - No circular trust relationships (Requirement 5.5)
 * 
 * @param {string} trusterTenantId - The tenant exposing the role
 * @param {string} trusteeTenantId - The tenant receiving access
 * @param {string} exposedRoleId - The role being exposed
 * @returns {Promise<Object>} - The created trust relationship
 * @throws {Error} - If validation fails
 */
async function createTrustRelationship(trusterTenantId, trusteeTenantId, exposedRoleId) {
  // Validate inputs
  if (!trusterTenantId || !trusteeTenantId || !exposedRoleId) {
    throw new Error('Missing required parameters: trusterTenantId, trusteeTenantId, and exposedRoleId are required');
  }
  
  if (trusterTenantId === trusteeTenantId) {
    throw new Error('Cannot create trust relationship with the same tenant');
  }
  
  // Validate that exposed_role_id belongs to truster tenant (Requirement 5.3)
  const isValidRole = await validateExposedRole(trusterTenantId, exposedRoleId);
  if (!isValidRole) {
    throw new Error('Exposed role does not belong to the truster tenant');
  }
  
  // Detect circular trust relationships (Requirement 5.5)
  const hasCircularTrust = await detectCircularTrust(trusterTenantId, trusteeTenantId);
  if (hasCircularTrust) {
    throw new Error('Cannot create trust relationship: would create circular trust dependency');
  }
  
  // Create the trust relationship
  const query = `
    INSERT INTO tenant_trust (truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active)
    VALUES ($1, $2, $3, true)
    RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at
  `;
  
  try {
    const result = await pool.query(query, [trusterTenantId, trusteeTenantId, exposedRoleId]);
    return result.rows[0];
  } catch (error) {
    // Handle unique constraint violation
    if (error.code === '23505') {
      throw new Error('Trust relationship already exists between these tenants for this role');
    }
    throw error;
  }
}

/**
 * Activates a trust relationship
 * 
 * @param {string} trustId - The trust relationship ID
 * @returns {Promise<Object>} - The updated trust relationship
 * @throws {Error} - If trust relationship not found
 */
async function activateTrust(trustId) {
  if (!trustId) {
    throw new Error('Trust ID is required');
  }
  
  const query = `
    UPDATE tenant_trust 
    SET is_active = true 
    WHERE trust_id = $1
    RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at
  `;
  
  const result = await pool.query(query, [trustId]);
  
  if (result.rows.length === 0) {
    throw new Error('Trust relationship not found');
  }
  
  return result.rows[0];
}

/**
 * Deactivates a trust relationship
 * 
 * When deactivated, users from the trustee tenant will no longer have access
 * to resources using the exposed role's permissions (Requirement 5.4)
 * 
 * @param {string} trustId - The trust relationship ID
 * @returns {Promise<Object>} - The updated trust relationship
 * @throws {Error} - If trust relationship not found
 */
async function deactivateTrust(trustId) {
  if (!trustId) {
    throw new Error('Trust ID is required');
  }
  
  const query = `
    UPDATE tenant_trust 
    SET is_active = false 
    WHERE trust_id = $1
    RETURNING trust_id, truster_tenant_id, trustee_tenant_id, exposed_role_id, is_active, created_at
  `;
  
  const result = await pool.query(query, [trustId]);
  
  if (result.rows.length === 0) {
    throw new Error('Trust relationship not found');
  }
  
  return result.rows[0];
}

/**
 * Lists all trust relationships for a tenant
 * 
 * Can list relationships where the tenant is either the truster or trustee
 * 
 * @param {string} tenantId - The tenant ID
 * @param {Object} options - Query options
 * @param {string} options.role - Filter by role: 'truster', 'trustee', or 'all' (default)
 * @param {boolean} options.activeOnly - Filter to only active relationships (default: false)
 * @returns {Promise<Array>} - Array of trust relationships
 */
async function listTrustRelationships(tenantId, options = {}) {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  
  const { role = 'all', activeOnly = false } = options;
  
  let query = `
    SELECT 
      tt.trust_id,
      tt.truster_tenant_id,
      tt.trustee_tenant_id,
      tt.exposed_role_id,
      tt.is_active,
      tt.created_at,
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
  
  // Filter by role
  if (role === 'truster') {
    query += ` AND tt.truster_tenant_id = $1`;
  } else if (role === 'trustee') {
    query += ` AND tt.trustee_tenant_id = $1`;
  } else {
    query += ` AND (tt.truster_tenant_id = $1 OR tt.trustee_tenant_id = $1)`;
  }
  
  // Filter by active status
  if (activeOnly) {
    query += ` AND tt.is_active = true`;
  }
  
  query += ` ORDER BY tt.created_at DESC`;
  
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Gets a specific trust relationship by ID
 * 
 * @param {string} trustId - The trust relationship ID
 * @returns {Promise<Object|null>} - The trust relationship or null if not found
 */
async function getTrustRelationship(trustId) {
  if (!trustId) {
    throw new Error('Trust ID is required');
  }
  
  const query = `
    SELECT 
      tt.trust_id,
      tt.truster_tenant_id,
      tt.trustee_tenant_id,
      tt.exposed_role_id,
      tt.is_active,
      tt.created_at,
      t_truster.name as truster_tenant_name,
      t_trustee.name as trustee_tenant_name,
      r.role_name as exposed_role_name
    FROM tenant_trust tt
    JOIN tenants t_truster ON tt.truster_tenant_id = t_truster.tenant_id
    JOIN tenants t_trustee ON tt.trustee_tenant_id = t_trustee.tenant_id
    JOIN roles r ON tt.exposed_role_id = r.role_id
    WHERE tt.trust_id = $1
  `;
  
  const result = await pool.query(query, [trustId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Deletes a trust relationship
 * 
 * @param {string} trustId - The trust relationship ID
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteTrustRelationship(trustId) {
  if (!trustId) {
    throw new Error('Trust ID is required');
  }
  
  const query = `DELETE FROM tenant_trust WHERE trust_id = $1`;
  const result = await pool.query(query, [trustId]);
  
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
  detectCircularTrust
};
