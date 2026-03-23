const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const rbacService = require('./rbacService');

/**
 * Default roles and permissions configuration for new tenants
 */
const DEFAULT_ROLES = [
  {
    name: 'Admin',
    permissions: [
      { resource: '*', action: 'CREATE' },
      { resource: '*', action: 'READ' },
      { resource: '*', action: 'UPDATE' },
      { resource: '*', action: 'DELETE' },
      { resource: '*', action: 'SHARE' }
    ]
  },
  {
    name: 'Developer',
    permissions: [
      { resource: 'files/*', action: 'CREATE' },
      { resource: 'files/*', action: 'READ' },
      { resource: 'files/*', action: 'UPDATE' },
      { resource: 'folders/*', action: 'CREATE' },
      { resource: 'folders/*', action: 'READ' },
      { resource: 'folders/*', action: 'UPDATE' }
    ]
  },
  {
    name: 'Viewer',
    permissions: [
      { resource: 'files/*', action: 'READ' },
      { resource: 'folders/*', action: 'READ' }
    ]
  }
];

/**
 * Provision a new tenant with default roles, permissions, and admin user
 * This function is atomic - if any step fails, all changes are rolled back
 * 
 * @param {string} issuerId - UUID of the issuer creating the tenant
 * @param {string} tenantName - Name of the tenant
 * @param {string} adminEmail - Email for the initial admin user
 * @param {string} adminPassword - Password for the initial admin user
 * @returns {Promise<Object>} Created tenant and admin user information
 * @throws {Error} If provisioning fails at any step
 */
async function provisionTenant(issuerId, tenantName, adminEmail, adminPassword) {
  // Validate inputs
  if (!issuerId || !tenantName || !adminEmail || !adminPassword) {
    throw new Error('All parameters are required: issuerId, tenantName, adminEmail, adminPassword');
  }

  // Validate UUID format for issuerId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(issuerId)) {
    throw new Error('Invalid issuer ID format - must be a valid UUID');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(adminEmail)) {
    throw new Error('Invalid email format');
  }

  // Validate password strength (minimum 8 characters)
  if (adminPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    // Step 1: Create tenant record
    const tenantResult = await client.query(
      `INSERT INTO tenants (issuer_id, name) 
       VALUES ($1, $2) 
       RETURNING tenant_id, issuer_id, name, created_at`,
      [issuerId, tenantName]
    );
    
    const tenant = tenantResult.rows[0];
    const tenantId = tenant.tenant_id;

    // Step 2: Create default roles
    const createdRoles = {};
    for (const roleConfig of DEFAULT_ROLES) {
      const roleResult = await client.query(
        `INSERT INTO roles (tenant_id, role_name) 
         VALUES ($1, $2) 
         RETURNING role_id, tenant_id, role_name, created_at`,
        [tenantId, roleConfig.name]
      );
      createdRoles[roleConfig.name] = roleResult.rows[0];
    }

    // Step 3: Create default permissions and assign to roles
    for (const roleConfig of DEFAULT_ROLES) {
      const role = createdRoles[roleConfig.name];
      
      for (const permConfig of roleConfig.permissions) {
        // Create or get permission
        const permResult = await client.query(
          `INSERT INTO permissions (tenant_id, resource_name, action) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (tenant_id, resource_name, action) 
           DO UPDATE SET tenant_id = EXCLUDED.tenant_id
           RETURNING permission_id, tenant_id, resource_name, action`,
          [tenantId, permConfig.resource, permConfig.action]
        );
        
        const permission = permResult.rows[0];
        
        // Assign permission to role
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, tenant_id) 
           VALUES ($1, $2, $3)`,
          [role.role_id, permission.permission_id, tenantId]
        );
      }
    }

    // Step 4: Hash admin password
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    // Step 5: Create initial admin user
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING user_id, tenant_id, email, created_at`,
      [tenantId, adminEmail, passwordHash]
    );
    
    const adminUser = userResult.rows[0];

    // Step 6: Assign Admin role to the admin user
    const adminRole = createdRoles['Admin'];
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id) 
       VALUES ($1, $2, $3)`,
      [adminUser.user_id, adminRole.role_id, tenantId]
    );

    // Commit transaction
    await client.query('COMMIT');

    // Return provisioning result
    return {
      tenant: {
        tenant_id: tenant.tenant_id,
        issuer_id: tenant.issuer_id,
        name: tenant.name,
        created_at: tenant.created_at
      },
      admin_user: {
        user_id: adminUser.user_id,
        email: adminUser.email,
        created_at: adminUser.created_at
      },
      default_roles: Object.values(createdRoles).map(role => ({
        role_id: role.role_id,
        role_name: role.role_name,
        created_at: role.created_at
      }))
    };

  } catch (error) {
    // Rollback transaction on any failure
    await client.query('ROLLBACK');
    
    // Provide more specific error messages
    if (error.code === '23505') { // Unique constraint violation
      if (error.constraint === 'tenants_issuer_id_name_key') {
        throw new Error(`Tenant with name "${tenantName}" already exists for this issuer`);
      } else if (error.constraint === 'users_tenant_id_email_key') {
        throw new Error(`User with email "${adminEmail}" already exists in this tenant`);
      }
    } else if (error.code === '23503') { // Foreign key violation
      throw new Error('Invalid issuer ID - issuer does not exist');
    }
    
    // Re-throw with context
    throw new Error(`Tenant provisioning failed: ${error.message}`);
  } finally {
    client.release();
  }
}

/**
 * Get tenant by ID
 * 
 * @param {string} tenantId - UUID of the tenant
 * @returns {Promise<Object>} Tenant information
 */
async function getTenant(tenantId) {
  const result = await pool.query(
    `SELECT tenant_id, issuer_id, name, created_at 
     FROM tenants 
     WHERE tenant_id = $1`,
    [tenantId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Tenant not found');
  }
  
  return result.rows[0];
}

/**
 * List all tenants for an issuer
 * 
 * @param {string} issuerId - UUID of the issuer
 * @returns {Promise<Array>} List of tenants
 */
async function listTenants(issuerId) {
  const result = await pool.query(
    `SELECT tenant_id, issuer_id, name, created_at 
     FROM tenants 
     WHERE issuer_id = $1 
     ORDER BY created_at DESC`,
    [issuerId]
  );
  
  return result.rows;
}

/**
 * Update tenant information
 * 
 * @param {string} tenantId - UUID of the tenant
 * @param {Object} updates - Fields to update (e.g., { name: 'New Name' })
 * @returns {Promise<Object>} Updated tenant information
 */
async function updateTenant(tenantId, updates) {
  const allowedFields = ['name'];
  const updateFields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      updateFields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (updateFields.length === 0) {
    throw new Error('No valid fields to update');
  }

  values.push(tenantId);

  const result = await pool.query(
    `UPDATE tenants 
     SET ${updateFields.join(', ')} 
     WHERE tenant_id = $${paramIndex} 
     RETURNING tenant_id, issuer_id, name, created_at`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  return result.rows[0];
}

/**
 * Delete tenant and all associated data
 * 
 * @param {string} tenantId - UUID of the tenant
 * @returns {Promise<boolean>} True if deleted successfully
 */
async function deleteTenant(tenantId) {
  const result = await pool.query(
    `DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id`,
    [tenantId]
  );

  if (result.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  return true;
}

module.exports = {
  provisionTenant,
  getTenant,
  listTenants,
  updateTenant,
  deleteTenant,
  DEFAULT_ROLES
};
