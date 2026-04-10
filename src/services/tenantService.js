const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const DEFAULT_ROLES = [
  {
    name: 'Admin',
    permissions: [
      { resource: '*', action: 'CREATE' },
      { resource: '*', action: 'READ' },
      { resource: '*', action: 'UPDATE' },
      { resource: '*', action: 'DELETE' },
      { resource: '*', action: 'SHARE' },
    ],
  },
  {
    name: 'Developer',
    permissions: [
      { resource: 'files/*', action: 'CREATE' },
      { resource: 'files/*', action: 'READ' },
      { resource: 'files/*', action: 'UPDATE' },
      { resource: 'folders/*', action: 'CREATE' },
      { resource: 'folders/*', action: 'READ' },
      { resource: 'folders/*', action: 'UPDATE' },
    ],
  },
  {
    name: 'Viewer',
    permissions: [
      { resource: 'files/*', action: 'READ' },
      { resource: 'folders/*', action: 'READ' },
    ],
  },
];

async function provisionTenant(issuerId, tenantName, adminEmail, adminPassword) {
  if (!issuerId || !tenantName || !adminEmail || !adminPassword) {
    throw new Error('All parameters are required: issuerId, tenantName, adminEmail, adminPassword');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(issuerId)) {
    throw new Error('Invalid issuer ID format - must be a valid UUID');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(adminEmail)) {
    throw new Error('Invalid email format');
  }

  if (adminPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenantResult = await client.query(
      `INSERT INTO tenants (issuer_id, name) VALUES ($1, $2)
       RETURNING tenant_id, issuer_id, name, created_at`,
      [issuerId, tenantName]
    );

    const tenant = tenantResult.rows[0];
    const tenantId = tenant.tenant_id;

    const createdRoles = {};
    for (const roleConfig of DEFAULT_ROLES) {
      const roleResult = await client.query(
        `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2)
         RETURNING role_id, tenant_id, role_name, created_at`,
        [tenantId, roleConfig.name]
      );
      createdRoles[roleConfig.name] = roleResult.rows[0];
    }

    for (const roleConfig of DEFAULT_ROLES) {
      const role = createdRoles[roleConfig.name];

      for (const permConfig of roleConfig.permissions) {
        const permResult = await client.query(
          `INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, resource_name, action)
           DO UPDATE SET tenant_id = EXCLUDED.tenant_id
           RETURNING permission_id, tenant_id, resource_name, action`,
          [tenantId, permConfig.resource, permConfig.action]
        );

        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3)`,
          [role.role_id, permResult.rows[0].permission_id, tenantId]
        );
      }
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING user_id, tenant_id, email, created_at`,
      [tenantId, adminEmail, passwordHash]
    );

    const adminUser = userResult.rows[0];
    const adminRole = createdRoles['Admin'];

    await client.query(
      `INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
      [adminUser.user_id, adminRole.role_id, tenantId]
    );

    await client.query('COMMIT');

    return {
      tenant: {
        tenant_id: tenant.tenant_id,
        issuer_id: tenant.issuer_id,
        name: tenant.name,
        created_at: tenant.created_at,
      },
      admin_user: {
        user_id: adminUser.user_id,
        email: adminUser.email,
        created_at: adminUser.created_at,
      },
      default_roles: Object.values(createdRoles).map(role => ({
        role_id: role.role_id,
        role_name: role.role_name,
        created_at: role.created_at,
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      if (error.constraint === 'tenants_issuer_id_name_key') {
        throw new Error(`Tenant with name "${tenantName}" already exists for this issuer`);
      } else if (error.constraint === 'users_tenant_id_email_key') {
        throw new Error(`User with email "${adminEmail}" already exists`);
      }
    } else if (error.code === '23503') {
      throw new Error('Invalid issuer ID - issuer does not exist');
    }

    throw new Error(`Tenant provisioning failed: ${error.message}`);
  } finally {
    client.release();
  }
}

async function getTenant(tenantId) {
  const result = await pool.query(
    `SELECT tenant_id, issuer_id, name, created_at FROM tenants WHERE tenant_id = $1`,
    [tenantId]
  );

  if (result.rows.length === 0) throw new Error('Tenant not found');

  return result.rows[0];
}

async function listTenants(issuerId) {
  const result = await pool.query(
    `SELECT tenant_id, issuer_id, name, created_at FROM tenants WHERE issuer_id = $1 ORDER BY created_at DESC`,
    [issuerId]
  );

  return result.rows;
}

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

  if (updateFields.length === 0) throw new Error('No valid fields to update');

  values.push(tenantId);

  const result = await pool.query(
    `UPDATE tenants SET ${updateFields.join(', ')} WHERE tenant_id = $${paramIndex}
     RETURNING tenant_id, issuer_id, name, created_at`,
    values
  );

  if (result.rows.length === 0) throw new Error('Tenant not found');

  return result.rows[0];
}

async function deleteTenant(tenantId) {
  const result = await pool.query(
    `DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id`,
    [tenantId]
  );

  if (result.rows.length === 0) throw new Error('Tenant not found');

  return true;
}

module.exports = { provisionTenant, getTenant, listTenants, updateTenant, deleteTenant, DEFAULT_ROLES };
