/**
 * PostgreSQL Database Configuration
 * Multi-Tenant RBAC System
 */

const { Pool } = require('pg');

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'rbac_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  
  // Connection pool settings
  min: parseInt(process.env.DB_POOL_MIN || '10', 10),
  max: parseInt(process.env.DB_POOL_MAX || '50', 10),
  
  // Connection timeout
  connectionTimeoutMillis: 5000,
  
  // Idle timeout
  idleTimeoutMillis: 30000,
  
  // SSL configuration (enable in production)
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: true
  } : false
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Set tenant context for Row-Level Security
 * This must be called at the start of each database session
 * 
 * @param {string} tenantId - UUID of the current tenant
 * @param {object} client - PostgreSQL client from pool
 */
async function setTenantContext(tenantId, client) {
  await client.query(`SET app.current_tenant_id = '${tenantId}'`);
}

/**
 * Execute query with automatic tenant context
 * 
 * @param {string} tenantId - UUID of the current tenant
 * @param {string} query - SQL query string
 * @param {array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
async function queryWithTenantContext(tenantId, query, params = []) {
  const client = await pool.connect();
  try {
    await setTenantContext(tenantId, client);
    const result = await client.query(query, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Execute query without tenant context (for system-level operations)
 * 
 * @param {string} query - SQL query string
 * @param {array} params - Query parameters
 * @returns {Promise<object>} Query result
 */
async function queryWithoutTenantContext(query, params = []) {
  return pool.query(query, params);
}

/**
 * Begin transaction with tenant context
 * 
 * @param {string} tenantId - UUID of the current tenant
 * @returns {Promise<object>} Client with active transaction
 */
async function beginTransaction(tenantId) {
  const client = await pool.connect();
  await client.query('BEGIN');
  if (tenantId) {
    await setTenantContext(tenantId, client);
  }
  return client;
}

/**
 * Commit transaction and release client
 * 
 * @param {object} client - PostgreSQL client
 */
async function commitTransaction(client) {
  try {
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

/**
 * Rollback transaction and release client
 * 
 * @param {object} client - PostgreSQL client
 */
async function rollbackTransaction(client) {
  try {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
}

/**
 * Close all database connections
 */
async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  setTenantContext,
  queryWithTenantContext,
  queryWithoutTenantContext,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  closePool
};
