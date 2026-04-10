const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'rbac_system',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: process.env.DB_HOST && process.env.DB_HOST.includes('supabase.co')
        ? { rejectUnauthorized: false }
        : false,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
  console.log('New database connection established');
});

pool.on('remove', () => {
  console.log('Client removed from pool');
});

async function setTenantContext(client, tenantId) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for database operations');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error('Invalid tenant ID format - must be a valid UUID');
  }

  try {
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
  } catch (error) {
    console.error('Failed to set tenant context:', error);
    throw new Error('Failed to set tenant context');
  }
}

async function queryWithTenantContext(tenantId, queryText, params = []) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);
    const result = await client.query(queryText, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withTransaction(tenantId, callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (tenantId) {
      await setTenantContext(client, tenantId);
    }

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function beginTransaction(client) {
  await client.query('BEGIN');
}

async function commitTransaction(client) {
  await client.query('COMMIT');
}

async function rollbackTransaction(client) {
  await client.query('ROLLBACK');
}

async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('Database connection successful:', result.rows[0].now);
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  setTenantContext,
  queryWithTenantContext,
  withTransaction,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  testConnection,
};
