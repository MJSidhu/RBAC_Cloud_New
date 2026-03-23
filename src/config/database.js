const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL if provided (Supabase connection string), otherwise build from parts
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

// Pool error handling
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
  console.log('New database connection established');
});

pool.on('acquire', (client) => {
  // Log when a client is acquired from the pool (optional, can be verbose)
  // console.log('Client acquired from pool');
});

pool.on('remove', (client) => {
  console.log('Client removed from pool');
});

// Helper function to set tenant context for RLS
// Uses SET LOCAL to ensure the setting is transaction-scoped
async function setTenantContext(client, tenantId) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for database operations');
  }
  
  try {
    // Using SET LOCAL ensures the setting is only valid for the current transaction
    // This is critical for RLS policies that use current_setting('app.current_tenant_id')
    // Note: SET LOCAL doesn't support parameterized queries, so we use string interpolation
    // The tenantId is validated as UUID format to prevent SQL injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new Error('Invalid tenant ID format - must be a valid UUID');
    }
    
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
  } catch (error) {
    console.error('Failed to set tenant context:', error);
    throw new Error('Failed to set tenant context');
  }
}

// Helper function to execute query with tenant context
async function queryWithTenantContext(tenantId, queryText, params = []) {
  const client = await pool.connect();
  
  try {
    // SET LOCAL requires a transaction
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

// Helper function for transactions with tenant context
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

// Explicit transaction control functions for advanced use cases
async function beginTransaction(client) {
  await client.query('BEGIN');
}

async function commitTransaction(client) {
  await client.query('COMMIT');
}

async function rollbackTransaction(client) {
  await client.query('ROLLBACK');
}

// Test database connection
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
