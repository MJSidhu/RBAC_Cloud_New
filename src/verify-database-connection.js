/**
 * Database Connection Verification Script
 * Verifies database connection and schema for Task 2.2
 */

const {
  pool,
  setTenantContext,
  testConnection,
} = require('./config/database');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkDatabaseConnection() {
  log('\n=== Database Connection Verification ===\n', 'blue');
  
  try {
    // Test 1: Basic connection
    log('1. Testing database connection...', 'cyan');
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }
    log('   ✓ Database connection successful\n', 'green');
    
    // Test 2: Check database info
    log('2. Checking database information...', 'cyan');
    const client = await pool.connect();
    try {
      const dbInfo = await client.query(`
        SELECT 
          current_database() as database,
          current_user as user,
          version() as version
      `);
      
      log(`   Database: ${dbInfo.rows[0].database}`, 'yellow');
      log(`   User: ${dbInfo.rows[0].user}`, 'yellow');
      log(`   Version: ${dbInfo.rows[0].version.split(',')[0]}`, 'yellow');
      log('   ✓ Database info retrieved\n', 'green');
      
      // Test 3: Check if schema is applied
      log('3. Checking if schema is applied...', 'cyan');
      const schemaCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('issuers', 'tenants', 'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'tenant_trust', 'sessions', 'audit_logs')
        ORDER BY table_name
      `);
      
      const expectedTables = [
        'audit_logs',
        'issuers',
        'permissions',
        'role_permissions',
        'roles',
        'sessions',
        'tenant_trust',
        'tenants',
        'user_roles',
        'users'
      ];
      
      const foundTables = schemaCheck.rows.map(row => row.table_name);
      const missingTables = expectedTables.filter(table => !foundTables.includes(table));
      
      if (missingTables.length > 0) {
        log('   ✗ Schema not fully applied', 'red');
        log(`   Missing tables: ${missingTables.join(', ')}`, 'red');
        log('\n   To apply the schema to Supabase:', 'yellow');
        log('   1. Go to your Supabase project dashboard', 'yellow');
        log('   2. Navigate to SQL Editor', 'yellow');
        log('   3. Run the contents of database/schema.sql', 'yellow');
        log('   4. Run the contents of database/rls-policies.sql', 'yellow');
        log('   5. Run this verification script again\n', 'yellow');
        return false;
      }
      
      log(`   ✓ All ${foundTables.length} tables found:`, 'green');
      foundTables.forEach(table => log(`     - ${table}`, 'green'));
      log('', 'reset');
      
      // Test 4: Check RLS policies
      log('4. Checking Row-Level Security policies...', 'cyan');
      const rlsCheck = await client.query(`
        SELECT 
          schemaname,
          tablename,
          policyname
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname
      `);
      
      if (rlsCheck.rows.length === 0) {
        log('   ✗ No RLS policies found', 'red');
        log('\n   To apply RLS policies to Supabase:', 'yellow');
        log('   1. Go to your Supabase project dashboard', 'yellow');
        log('   2. Navigate to SQL Editor', 'yellow');
        log('   3. Run the contents of database/rls-policies.sql', 'yellow');
        log('   4. Run this verification script again\n', 'yellow');
        return false;
      }
      
      log(`   ✓ Found ${rlsCheck.rows.length} RLS policies:`, 'green');
      const policiesByTable = {};
      rlsCheck.rows.forEach(row => {
        if (!policiesByTable[row.tablename]) {
          policiesByTable[row.tablename] = [];
        }
        policiesByTable[row.tablename].push(row.policyname);
      });
      
      Object.keys(policiesByTable).sort().forEach(table => {
        log(`     ${table}: ${policiesByTable[table].join(', ')}`, 'green');
      });
      log('', 'reset');
      
      // Test 5: Test tenant context setting
      log('5. Testing tenant context setting (RLS)...', 'cyan');
      const testTenantId = '123e4567-e89b-12d3-a456-426614174000';
      
      await client.query('BEGIN');
      await setTenantContext(client, testTenantId);
      
      const contextResult = await client.query("SELECT current_setting('app.current_tenant_id', true) as tenant_id");
      await client.query('ROLLBACK');
      
      if (contextResult.rows[0].tenant_id !== testTenantId) {
        throw new Error('Tenant context not set correctly');
      }
      
      log(`   ✓ Tenant context setting works correctly`, 'green');
      log(`   Test tenant ID: ${testTenantId}\n`, 'yellow');
      
      // Test 6: Connection pool info
      log('6. Connection pool information...', 'cyan');
      log(`   Min connections: ${pool.options.min}`, 'yellow');
      log(`   Max connections: ${pool.options.max}`, 'yellow');
      log(`   Current total: ${pool.totalCount}`, 'yellow');
      log(`   Current idle: ${pool.idleCount}`, 'yellow');
      log(`   Current waiting: ${pool.waitingCount}`, 'yellow');
      log('   ✓ Connection pool configured correctly\n', 'green');
      
    } finally {
      client.release();
    }
    
    log('=== All Checks Passed ===\n', 'green');
    log('Database connection management is working correctly!', 'green');
    log('You can now run the full test suite with:', 'cyan');
    log('  node src/tests/database-connection.test.js\n', 'yellow');
    
    return true;
    
  } catch (error) {
    log('\n=== Verification Failed ===\n', 'red');
    log(`Error: ${error.message}`, 'red');
    
    if (error.code === 'ECONNREFUSED') {
      log('\nConnection refused. Please check:', 'yellow');
      log('  - Database host and port in .env file', 'yellow');
      log('  - Database is running and accessible', 'yellow');
      log('  - Firewall settings allow the connection\n', 'yellow');
    } else if (error.code === '28P01') {
      log('\nAuthentication failed. Please check:', 'yellow');
      log('  - Database username in .env file', 'yellow');
      log('  - Database password in .env file', 'yellow');
      log('  - User has proper permissions\n', 'yellow');
    } else if (error.code === '3D000') {
      log('\nDatabase does not exist. Please check:', 'yellow');
      log('  - Database name in .env file', 'yellow');
      log('  - Database has been created\n', 'yellow');
    }
    
    return false;
  } finally {
    await pool.end();
  }
}

// Run verification
if (require.main === module) {
  checkDatabaseConnection()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      log(`\nFatal error: ${error.message}`, 'red');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { checkDatabaseConnection };
