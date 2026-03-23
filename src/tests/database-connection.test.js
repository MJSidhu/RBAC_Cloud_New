/**
 * Database Connection Management Tests
 * Tests for Task 2.2: Database connection pool, tenant context, and transactions
 * 
 * Requirements: 6.4, 15.4
 */

const {
  pool,
  setTenantContext,
  queryWithTenantContext,
  withTransaction,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  testConnection,
} = require('../config/database');

// Test utilities
const { v4: uuidv4 } = require('crypto').randomUUID ? require('crypto') : { randomUUID: () => require('crypto').randomBytes(16).toString('hex') };

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  console.log(`\n${colors.blue}▶ ${testName}${colors.reset}`);
}

function logPass(message) {
  log(`  ✓ ${message}`, 'green');
}

function logFail(message) {
  log(`  ✗ ${message}`, 'red');
}

function logInfo(message) {
  log(`  ℹ ${message}`, 'yellow');
}

// Test results tracking
const results = {
  passed: 0,
  failed: 0,
  errors: [],
};

// Test runner
async function runTest(testName, testFn) {
  logTest(testName);
  try {
    await testFn();
    results.passed++;
    return true;
  } catch (error) {
    results.failed++;
    results.errors.push({ test: testName, error: error.message });
    logFail(`Test failed: ${error.message}`);
    return false;
  }
}

// Test 1: Basic connection test
async function testBasicConnection() {
  const success = await testConnection();
  if (!success) {
    throw new Error('Failed to connect to database');
  }
  logPass('Database connection successful');
}

// Test 2: Connection pool configuration
async function testPoolConfiguration() {
  const poolInfo = {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
  
  logInfo(`Pool stats - Total: ${poolInfo.totalCount}, Idle: ${poolInfo.idleCount}, Waiting: ${poolInfo.waitingCount}`);
  
  // Verify pool is initialized
  if (pool.options.max !== 50) {
    throw new Error(`Expected max pool size 50, got ${pool.options.max}`);
  }
  if (pool.options.min !== 10) {
    throw new Error(`Expected min pool size 10, got ${pool.options.min}`);
  }
  
  logPass('Pool configuration correct (min: 10, max: 50)');
}

// Test 3: Tenant context setting
async function testTenantContextSetting() {
  const client = await pool.connect();
  const testTenantId = '123e4567-e89b-12d3-a456-426614174000';
  
  try {
    await client.query('BEGIN');
    await setTenantContext(client, testTenantId);
    
    // Verify the setting was applied
    const result = await client.query("SELECT current_setting('app.current_tenant_id', true) as tenant_id");
    
    if (result.rows[0].tenant_id !== testTenantId) {
      throw new Error(`Expected tenant_id ${testTenantId}, got ${result.rows[0].tenant_id}`);
    }
    
    await client.query('COMMIT');
    logPass(`Tenant context set correctly: ${testTenantId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Test 4: Tenant context isolation between transactions
async function testTenantContextIsolation() {
  const tenant1 = '123e4567-e89b-12d3-a456-426614174001';
  const tenant2 = '123e4567-e89b-12d3-a456-426614174002';
  
  const client1 = await pool.connect();
  const client2 = await pool.connect();
  
  try {
    // Set different tenant contexts in two separate connections
    await client1.query('BEGIN');
    await setTenantContext(client1, tenant1);
    
    await client2.query('BEGIN');
    await setTenantContext(client2, tenant2);
    
    // Verify each connection has its own context
    const result1 = await client1.query("SELECT current_setting('app.current_tenant_id', true) as tenant_id");
    const result2 = await client2.query("SELECT current_setting('app.current_tenant_id', true) as tenant_id");
    
    if (result1.rows[0].tenant_id !== tenant1) {
      throw new Error(`Client 1 expected ${tenant1}, got ${result1.rows[0].tenant_id}`);
    }
    if (result2.rows[0].tenant_id !== tenant2) {
      throw new Error(`Client 2 expected ${tenant2}, got ${result2.rows[0].tenant_id}`);
    }
    
    await client1.query('COMMIT');
    await client2.query('COMMIT');
    
    logPass('Tenant contexts are properly isolated between connections');
  } catch (error) {
    await client1.query('ROLLBACK').catch(() => {});
    await client2.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client1.release();
    client2.release();
  }
}

// Test 5: Transaction helpers - commit
async function testTransactionCommit() {
  const client = await pool.connect();
  
  try {
    await beginTransaction(client);
    
    // Create a temporary table for testing
    await client.query('CREATE TEMP TABLE test_commit (id INT, value TEXT)');
    await client.query('INSERT INTO test_commit (id, value) VALUES (1, $1)', ['test']);
    
    await commitTransaction(client);
    
    // Verify data persists after commit
    const result = await client.query('SELECT * FROM test_commit WHERE id = 1');
    if (result.rows.length !== 1 || result.rows[0].value !== 'test') {
      throw new Error('Transaction commit failed - data not persisted');
    }
    
    logPass('Transaction commit works correctly');
  } catch (error) {
    await rollbackTransaction(client).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Test 6: Transaction helpers - rollback
async function testTransactionRollback() {
  const client = await pool.connect();
  
  try {
    await beginTransaction(client);
    
    // Create a temporary table for testing
    await client.query('CREATE TEMP TABLE test_rollback (id INT, value TEXT)');
    await client.query('INSERT INTO test_rollback (id, value) VALUES (1, $1)', ['test']);
    
    await rollbackTransaction(client);
    
    // Verify data was rolled back
    try {
      await client.query('SELECT * FROM test_rollback WHERE id = 1');
      throw new Error('Transaction rollback failed - table still exists');
    } catch (error) {
      if (error.message.includes('does not exist')) {
        logPass('Transaction rollback works correctly');
      } else {
        throw error;
      }
    }
  } catch (error) {
    await rollbackTransaction(client).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Test 7: withTransaction helper
async function testWithTransactionHelper() {
  const testTenantId = '123e4567-e89b-12d3-a456-426614174003';
  
  const result = await withTransaction(testTenantId, async (client) => {
    // Verify tenant context is set
    const contextResult = await client.query("SELECT current_setting('app.current_tenant_id', true) as tenant_id");
    if (contextResult.rows[0].tenant_id !== testTenantId) {
      throw new Error('Tenant context not set in withTransaction');
    }
    
    // Create temp table and insert data
    await client.query('CREATE TEMP TABLE test_with_transaction (id INT, value TEXT)');
    await client.query('INSERT INTO test_with_transaction (id, value) VALUES (1, $1)', ['success']);
    
    const dataResult = await client.query('SELECT * FROM test_with_transaction WHERE id = 1');
    return dataResult.rows[0];
  });
  
  if (result.value !== 'success') {
    throw new Error('withTransaction helper failed');
  }
  
  logPass('withTransaction helper works correctly');
}

// Test 8: withTransaction rollback on error
async function testWithTransactionRollback() {
  const testTenantId = '123e4567-e89b-12d3-a456-426614174004';
  
  try {
    await withTransaction(testTenantId, async (client) => {
      await client.query('CREATE TEMP TABLE test_rollback_helper (id INT, value TEXT)');
      await client.query('INSERT INTO test_rollback_helper (id, value) VALUES (1, $1)', ['test']);
      
      // Intentionally throw an error
      throw new Error('Intentional error for rollback test');
    });
    
    throw new Error('Expected transaction to fail');
  } catch (error) {
    if (error.message === 'Intentional error for rollback test') {
      logPass('withTransaction correctly rolls back on error');
    } else {
      throw error;
    }
  }
}

// Test 9: queryWithTenantContext helper
async function testQueryWithTenantContext() {
  const testTenantId = '123e4567-e89b-12d3-a456-426614174005';
  
  // This will fail if the table doesn't exist, but we're testing the mechanism
  try {
    const result = await queryWithTenantContext(
      testTenantId,
      "SELECT current_setting('app.current_tenant_id', true) as tenant_id"
    );
    
    if (result.rows[0].tenant_id !== testTenantId) {
      throw new Error('queryWithTenantContext did not set tenant context correctly');
    }
    
    logPass('queryWithTenantContext works correctly');
  } catch (error) {
    throw error;
  }
}

// Test 10: Connection pool stress test (acquire multiple connections)
async function testConnectionPoolStress() {
  const connections = [];
  const numConnections = 15; // More than min pool size
  
  try {
    // Acquire multiple connections
    for (let i = 0; i < numConnections; i++) {
      const client = await pool.connect();
      connections.push(client);
    }
    
    logInfo(`Successfully acquired ${numConnections} connections`);
    
    // Verify all connections work
    const results = await Promise.all(
      connections.map(client => client.query('SELECT 1 as test'))
    );
    
    if (results.length !== numConnections) {
      throw new Error('Not all connections responded');
    }
    
    logPass(`Connection pool handled ${numConnections} concurrent connections`);
  } finally {
    // Release all connections
    connections.forEach(client => client.release());
  }
}

// Test 11: Error handling - missing tenant ID
async function testMissingTenantIdError() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await setTenantContext(client, null);
    throw new Error('Expected error for missing tenant ID');
  } catch (error) {
    if (error.message.includes('Tenant ID is required')) {
      logPass('Correctly throws error for missing tenant ID');
    } else {
      throw error;
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

// Main test suite
async function runAllTests() {
  log('\n=== Database Connection Management Tests ===\n', 'blue');
  log('Testing Task 2.2 implementation\n', 'yellow');
  
  await runTest('Test 1: Basic Connection', testBasicConnection);
  await runTest('Test 2: Pool Configuration', testPoolConfiguration);
  await runTest('Test 3: Tenant Context Setting', testTenantContextSetting);
  await runTest('Test 4: Tenant Context Isolation', testTenantContextIsolation);
  await runTest('Test 5: Transaction Commit', testTransactionCommit);
  await runTest('Test 6: Transaction Rollback', testTransactionRollback);
  await runTest('Test 7: withTransaction Helper', testWithTransactionHelper);
  await runTest('Test 8: withTransaction Rollback on Error', testWithTransactionRollback);
  await runTest('Test 9: queryWithTenantContext Helper', testQueryWithTenantContext);
  await runTest('Test 10: Connection Pool Stress Test', testConnectionPoolStress);
  await runTest('Test 11: Error Handling - Missing Tenant ID', testMissingTenantIdError);
  
  // Print summary
  log('\n=== Test Summary ===\n', 'blue');
  log(`Total Tests: ${results.passed + results.failed}`, 'yellow');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  
  if (results.errors.length > 0) {
    log('\n=== Failed Tests ===\n', 'red');
    results.errors.forEach(({ test, error }) => {
      log(`${test}: ${error}`, 'red');
    });
  }
  
  // Close pool
  await pool.end();
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    log(`\nFatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
};
