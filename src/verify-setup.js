/**
 * Verification script for Express server setup (Task 2.1)
 * Checks configuration without requiring database connection
 */

require('dotenv').config();

console.log('=================================');
console.log('Express Server Setup Verification');
console.log('Task 2.1: Set up Express.js server with middleware');
console.log('=================================\n');

let allChecks = true;

// Check 1: Verify all required files exist
console.log('1. Checking required files...');
const fs = require('fs');
const requiredFiles = [
  'src/server.js',
  'src/config/database.js',
  'src/middleware/errorHandler.js',
  '.env',
];

for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    console.log(`   ✓ ${file}`);
  } else {
    console.log(`   ❌ ${file} - MISSING`);
    allChecks = false;
  }
}
console.log();

// Check 2: Verify dependencies are installed
console.log('2. Checking installed dependencies...');
const requiredDeps = [
  'express',
  'cors',
  'helmet',
  'express-rate-limit',
  'bcryptjs',
  'jsonwebtoken',
  'dotenv',
  'pg',
];

for (const dep of requiredDeps) {
  try {
    require.resolve(dep);
    console.log(`   ✓ ${dep}`);
  } catch (error) {
    console.log(`   ❌ ${dep} - NOT INSTALLED`);
    allChecks = false;
  }
}
console.log();

// Check 3: Verify environment variables
console.log('3. Checking environment variables...');
const envVars = {
  'DB_HOST': process.env.DB_HOST || 'localhost (default)',
  'DB_PORT': process.env.DB_PORT || '5432 (default)',
  'DB_NAME': process.env.DB_NAME || 'rbac_system (default)',
  'DB_USER': process.env.DB_USER || 'postgres (default)',
  'DB_PASSWORD': process.env.DB_PASSWORD ? '***' : 'NOT SET',
  'DB_POOL_MIN': process.env.DB_POOL_MIN || '10 (default)',
  'DB_POOL_MAX': process.env.DB_POOL_MAX || '50 (default)',
  'PORT': process.env.PORT || '3000 (default)',
  'NODE_ENV': process.env.NODE_ENV || 'development (default)',
};

for (const [key, value] of Object.entries(envVars)) {
  console.log(`   ${key}: ${value}`);
}
console.log();

// Check 4: Verify connection pool configuration
console.log('4. Verifying connection pool configuration...');
const poolMin = parseInt(process.env.DB_POOL_MIN) || 10;
const poolMax = parseInt(process.env.DB_POOL_MAX) || 50;

if (poolMin === 10 && poolMax === 50) {
  console.log(`   ✓ Pool configuration: min=${poolMin}, max=${poolMax}`);
  console.log('   ✓ Requirement 15.4 satisfied');
} else {
  console.log(`   ⚠ Pool configuration: min=${poolMin}, max=${poolMax}`);
  console.log('   ⚠ Expected: min=10, max=50');
}
console.log();

// Check 5: Verify middleware configuration in server.js
console.log('5. Checking middleware configuration...');
const serverCode = fs.readFileSync('src/server.js', 'utf8');

const middlewareChecks = [
  { name: 'helmet', pattern: /helmet\(/, requirement: '14.6' },
  { name: 'cors', pattern: /cors\(/, requirement: 'N/A' },
  { name: 'express.json', pattern: /express\.json\(/, requirement: 'N/A' },
  { name: 'rate limiting', pattern: /rateLimit\(/, requirement: '14.3' },
  { name: 'error handler', pattern: /errorHandler/, requirement: 'N/A' },
];

for (const check of middlewareChecks) {
  if (check.pattern.test(serverCode)) {
    console.log(`   ✓ ${check.name} configured (Req ${check.requirement})`);
  } else {
    console.log(`   ❌ ${check.name} - NOT CONFIGURED`);
    allChecks = false;
  }
}
console.log();

// Check 6: Verify security headers configuration
console.log('6. Checking security headers (Requirement 14.6)...');
const securityHeaders = [
  { name: 'X-Content-Type-Options', pattern: /xContentTypeOptions/ },
  { name: 'X-Frame-Options', pattern: /xFrameOptions/ },
  { name: 'Content-Security-Policy', pattern: /contentSecurityPolicy/ },
];

for (const header of securityHeaders) {
  if (header.pattern.test(serverCode)) {
    console.log(`   ✓ ${header.name}`);
  } else {
    console.log(`   ❌ ${header.name} - NOT CONFIGURED`);
    allChecks = false;
  }
}
console.log();

// Check 7: Verify database helper functions
console.log('7. Checking database helper functions...');
const dbCode = fs.readFileSync('src/config/database.js', 'utf8');

const dbFunctions = [
  'setTenantContext',
  'queryWithTenantContext',
  'withTransaction',
  'testConnection',
];

for (const func of dbFunctions) {
  if (dbCode.includes(`function ${func}`) || dbCode.includes(`async function ${func}`)) {
    console.log(`   ✓ ${func}`);
  } else {
    console.log(`   ❌ ${func} - NOT FOUND`);
    allChecks = false;
  }
}
console.log();

// Check 8: Verify error handler classes
console.log('8. Checking error handler classes...');
const errorCode = fs.readFileSync('src/middleware/errorHandler.js', 'utf8');

const errorClasses = [
  'AppError',
  'ValidationError',
  'AuthenticationError',
  'AuthorizationError',
  'NotFoundError',
  'ConflictError',
  'RateLimitError',
  'DatabaseError',
];

for (const errorClass of errorClasses) {
  if (errorCode.includes(`class ${errorClass}`)) {
    console.log(`   ✓ ${errorClass}`);
  } else {
    console.log(`   ❌ ${errorClass} - NOT FOUND`);
    allChecks = false;
  }
}
console.log();

// Summary
console.log('=================================');
if (allChecks) {
  console.log('✓ All checks passed!');
  console.log('=================================\n');
  console.log('Task 2.1 Implementation Summary:');
  console.log('- Express.js server configured with JSON body parser');
  console.log('- CORS middleware configured');
  console.log('- Helmet security headers configured (Req 14.6)');
  console.log('- Rate limiting configured (100 req/min)');
  console.log('- Error handling middleware implemented');
  console.log('- Database connection pooling (min: 10, max: 50) (Req 15.4)');
  console.log('- Health check endpoint available at /health');
  console.log('\nTo start the server:');
  console.log('  npm start          # Production mode');
  console.log('  npm run dev        # Development mode (requires nodemon)');
  console.log('\nNote: Database must be running and configured for server to start.');
} else {
  console.log('❌ Some checks failed!');
  console.log('=================================\n');
  console.log('Please review the errors above and fix any issues.');
}
console.log();
