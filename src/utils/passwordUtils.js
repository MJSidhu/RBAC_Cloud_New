const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  try {
    return await bcrypt.hash(password, SALT_ROUNDS);
  } catch (error) {
    throw new Error(`Password hashing failed: ${error.message}`);
  }
}

async function comparePassword(password, hash) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('Hash must be a non-empty string');
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    throw new Error(`Password comparison failed: ${error.message}`);
  }
}

module.exports = { hashPassword, comparePassword, SALT_ROUNDS };
