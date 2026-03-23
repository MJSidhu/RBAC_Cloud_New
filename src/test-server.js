/**
 * Test script to verify Express server setup
 * Tests database connection and server configuration
 */

const { testConnection, pool } = require('./config/database');

async function testServerSetup() {
  console.log('Testing Express.js Server Setup...\n');
  
  // Test 1: Database connection
  console.log('1. Testing database connection...');
  const dbConnected = await testConnection();
  
  if (!dbConnected) {
    console.error('❌ Database connection failed');
    process.exit(1);
  }
  console.log('✓ Database connection successful\n');
  
  // Test 2: Connection pool configuration
  console.log('2. Verifying connection pool configuration...');
  console.log(`   Min connections: ${pool.options.min || pool.options.connectionConfig?.min || 'default'}`);
  console.log(`   Max connections: ${pool.options.max || pool.options.connectionConfig?.max || 'default'}`);
  
  const expectedMin = parseInt(process.env.DB_POOL_MIN) || 10;
  const expectedMax = parseInt(process.env.DB_POOL_MAX) || 50;
  
  if (pool.options.min === expectedMin && pool.options.max === expectedMax) {
    console.log('✓ Connection pool configured correctly\n');
  } else {
    console.log('⚠ Connection pool configuration may differ from expected values\n');
  }
  
  // Test 3: Environment variables
  console.log('3. Checking environment variables...');
  const requiredEnvVars = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_POOL_MIN',
    'DB_POOL_MAX',
  ];
  
  let allEnvVarsPresent = true;
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.log(`   ⚠ ${envVar} not set (using default)`);
      allEnvVarsPresent = false;
    }
  }
  
  if (allEnvVarsPresent) {
    console.log('✓ All required environment variables are set\n');
  } else {
    console.log('⚠ Some environment variables are using defaults\n');
  }
  
  // Test 4: Test tenant context setting
  console.log('4. Testing tenant context setting (RLS)...');
  try {
    const client = await pool.connect();
    const testTenantId = '123e4567-e89b-12d3-a456-426614174000';
    
    // Start a transaction to test SET LOCAL
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [testTenantId]);
    
    const result = await client.query('SELECT current_setting($1, true) as tenant_id', [
      'app.current_tenant_id',
    ]);
    
    await client.query('COMMIT');
    client.release();
    
    if (result.rows[0].tenant_id === testTenantId) {
      console.log('✓ Tenant context setting works correctly\n');
    } else {
      console.log('❌ Tenant context setting failed\n');
    }
  } catch (error) {
    console.error('❌ Tenant context test failed:', error.message, '\n');
  }
  
  // Test 5: Verify middleware dependencies
  console.log('5. Verifying middleware dependencies...');
  try {
    require('express');
    require('cors');
    require('helmet');
    require('express-rate-limit');
    require('bcryptjs');
    require('jsonwebtoken');
    console.log('✓ All middleware dependencies are installed\n');
  } catch (error) {
    console.error('❌ Missing middleware dependency:', error.message, '\n');
  }
  
  console.log('=================================');
  console.log('Server setup verification complete!');
  console.log('=================================\n');
  console.log('To start the server, run: npm start');
  console.log('For development with auto-reload: npm run dev\n');
  
  await pool.end();
  process.exit(0);
}

testServerSetup().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
