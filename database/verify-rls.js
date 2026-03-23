/**
 * RLS Verification Script
 * Verifies that Row-Level Security policies are correctly implemented
 */

const { Pool } = require('pg');

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'rbac_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Tables that MUST have RLS enabled
const TABLES_WITH_RLS = [
  'tenants',
  'users',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'audit_logs'
];

// Tables that MUST NOT have RLS enabled
const TABLES_WITHOUT_RLS = [
  'tenant_trust',
  'sessions',
  'issuers'
];

// Expected RLS policy expression pattern
const EXPECTED_POLICY_PATTERN = /tenant_id.*current_setting.*app\.current_tenant_id.*uuid/i;

/**
 * Check if RLS is enabled on a table
 */
async function checkRLSEnabled(tableName) {
  const query = `
    SELECT 
      schemaname,
      tablename,
      rowsecurity AS rls_enabled
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = $1
  `;
  
  const result = await pool.query(query, [tableName]);
  
  if (result.rows.length === 0) {
    return { exists: false, enabled: false };
  }
  
  return {
    exists: true,
    enabled: result.rows[0].rls_enabled
  };
}

/**
 * Get RLS policies for a table
 */
async function getRLSPolicies(tableName) {
  const query = `
    SELECT 
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual AS using_expression
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = $1
  `;
  
  const result = await pool.query(query, [tableName]);
  return result.rows;
}

/**
 * Verify RLS policy expression matches expected pattern
 */
function verifyPolicyExpression(expression) {
  return EXPECTED_POLICY_PATTERN.test(expression);
}

/**
 * Main verification function
 */
async function verifyRLS() {
  console.log('=== RLS Verification Script ===\n');
  
  let allTestsPassed = true;
  
  // Test 1: Verify RLS is enabled on required tables
  console.log('Test 1: Verifying RLS is enabled on required tables...');
  for (const tableName of TABLES_WITH_RLS) {
    const status = await checkRLSEnabled(tableName);
    
    if (!status.exists) {
      console.log(`  ❌ FAIL: Table '${tableName}' does not exist`);
      allTestsPassed = false;
    } else if (!status.enabled) {
      console.log(`  ❌ FAIL: RLS is NOT enabled on '${tableName}'`);
      allTestsPassed = false;
    } else {
      console.log(`  ✓ PASS: RLS is enabled on '${tableName}'`);
    }
  }
  console.log('');
  
  // Test 2: Verify RLS is NOT enabled on excluded tables
  console.log('Test 2: Verifying RLS is NOT enabled on excluded tables...');
  for (const tableName of TABLES_WITHOUT_RLS) {
    const status = await checkRLSEnabled(tableName);
    
    if (!status.exists) {
      console.log(`  ❌ FAIL: Table '${tableName}' does not exist`);
      allTestsPassed = false;
    } else if (status.enabled) {
      console.log(`  ❌ FAIL: RLS is incorrectly enabled on '${tableName}'`);
      allTestsPassed = false;
    } else {
      console.log(`  ✓ PASS: RLS is NOT enabled on '${tableName}' (correct)`);
    }
  }
  console.log('');
  
  // Test 3: Verify RLS policies exist and have correct expressions
  console.log('Test 3: Verifying RLS policy expressions...');
  for (const tableName of TABLES_WITH_RLS) {
    const policies = await getRLSPolicies(tableName);
    
    if (policies.length === 0) {
      console.log(`  ❌ FAIL: No RLS policies found for '${tableName}'`);
      allTestsPassed = false;
    } else {
      let policyValid = false;
      for (const policy of policies) {
        if (verifyPolicyExpression(policy.using_expression)) {
          console.log(`  ✓ PASS: Policy '${policy.policyname}' on '${tableName}' has correct expression`);
          policyValid = true;
          break;
        }
      }
      
      if (!policyValid) {
        console.log(`  ❌ FAIL: No valid policy expression found for '${tableName}'`);
        console.log(`     Expected pattern: tenant_id = current_setting('app.current_tenant_id')::uuid`);
        console.log(`     Found: ${policies[0].using_expression}`);
        allTestsPassed = false;
      }
    }
  }
  console.log('');
  
  // Test 4: Verify no RLS policies exist on excluded tables
  console.log('Test 4: Verifying no RLS policies on excluded tables...');
  for (const tableName of TABLES_WITHOUT_RLS) {
    const policies = await getRLSPolicies(tableName);
    
    if (policies.length > 0) {
      console.log(`  ❌ FAIL: Unexpected RLS policies found on '${tableName}'`);
      allTestsPassed = false;
    } else {
      console.log(`  ✓ PASS: No RLS policies on '${tableName}' (correct)`);
    }
  }
  console.log('');
  
  // Summary
  console.log('=== Verification Summary ===');
  if (allTestsPassed) {
    console.log('✓ All RLS verification tests PASSED');
    console.log('\nRLS Implementation Status: CORRECT');
    console.log('- All required tables have RLS enabled');
    console.log('- All excluded tables do NOT have RLS');
    console.log('- All policies use the correct tenant_id expression');
    return 0;
  } else {
    console.log('❌ Some RLS verification tests FAILED');
    console.log('\nPlease review the failures above and correct the RLS implementation.');
    return 1;
  }
}

// Run verification
verifyRLS()
  .then((exitCode) => {
    pool.end();
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error('Error during RLS verification:', error);
    pool.end();
    process.exit(1);
  });
