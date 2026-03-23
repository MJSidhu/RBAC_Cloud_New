/**
 * Apply Database Schema to Supabase
 * This script applies the schema and RLS policies to a Supabase database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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

async function applySchema() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    log('\n=== Applying Database Schema to Supabase ===\n', 'blue');
    
    // Test connection
    log('1. Testing database connection...', 'cyan');
    const client = await pool.connect();
    log('   ✓ Connected to database\n', 'green');
    
    // Read schema file
    log('2. Reading schema.sql...', 'cyan');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    log('   ✓ Schema file loaded\n', 'green');
    
    // Apply schema
    log('3. Applying database schema...', 'cyan');
    try {
      await client.query(schemaSQL);
      log('   ✓ Schema applied successfully\n', 'green');
    } catch (error) {
      if (error.message.includes('already exists')) {
        log('   ⚠ Some objects already exist (this is OK)\n', 'yellow');
      } else {
        throw error;
      }
    }
    
    // Read RLS policies file
    log('4. Reading rls-policies.sql...', 'cyan');
    const rlsPath = path.join(__dirname, 'rls-policies.sql');
    const rlsSQL = fs.readFileSync(rlsPath, 'utf8');
    log('   ✓ RLS policies file loaded\n', 'green');
    
    // Apply RLS policies
    log('5. Applying RLS policies...', 'cyan');
    try {
      await client.query(rlsSQL);
      log('   ✓ RLS policies applied successfully\n', 'green');
    } catch (error) {
      if (error.message.includes('already exists')) {
        log('   ⚠ Some policies already exist (this is OK)\n', 'yellow');
      } else {
        throw error;
      }
    }
    
    // Verify tables
    log('6. Verifying tables...', 'cyan');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('issuers', 'tenants', 'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'tenant_trust', 'sessions', 'audit_logs')
      ORDER BY table_name
    `);
    
    log(`   ✓ Found ${tablesResult.rows.length} tables:`, 'green');
    tablesResult.rows.forEach(row => {
      log(`     - ${row.table_name}`, 'green');
    });
    log('', 'reset');
    
    // Verify RLS policies
    log('7. Verifying RLS policies...', 'cyan');
    const policiesResult = await client.query(`
      SELECT 
        tablename,
        COUNT(*) as policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY tablename
      ORDER BY tablename
    `);
    
    log(`   ✓ RLS policies applied to ${policiesResult.rows.length} tables:`, 'green');
    policiesResult.rows.forEach(row => {
      log(`     - ${row.tablename}: ${row.policy_count} policy(ies)`, 'green');
    });
    log('', 'reset');
    
    client.release();
    
    log('=== Schema Application Complete ===\n', 'green');
    log('Database is ready for use!', 'green');
    log('Run verification with:', 'cyan');
    log('  node src/verify-database-connection.js\n', 'yellow');
    
    return true;
    
  } catch (error) {
    log('\n=== Schema Application Failed ===\n', 'red');
    log(`Error: ${error.message}`, 'red');
    
    if (error.code === 'ECONNREFUSED') {
      log('\nConnection refused. Please check:', 'yellow');
      log('  - Database host and port in .env file', 'yellow');
      log('  - Database is running and accessible', 'yellow');
    } else if (error.code === '28P01') {
      log('\nAuthentication failed. Please check:', 'yellow');
      log('  - Database username in .env file', 'yellow');
      log('  - Database password in .env file', 'yellow');
    }
    
    console.error('\nFull error:', error);
    return false;
    
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  applySchema()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      log(`\nFatal error: ${error.message}`, 'red');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { applySchema };
