/**
 * Password Hashing Utilities
 * 
 * Provides secure password hashing and verification using bcrypt.
 * Implements Requirement 2.6: Password hashing with minimum cost factor of 10.
 */

const bcrypt = require('bcryptjs');

// Cost factor for bcrypt hashing (Requirement 2.6: minimum cost factor of 10)
const SALT_ROUNDS = 10;

/**
 * Hash a plain text password using bcrypt
 * 
 * @param {string} password - The plain text password to hash
 * @returns {Promise<string>} The hashed password
 * @throws {Error} If password is empty or hashing fails
 */
async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error) {
    throw new Error(`Password hashing failed: ${error.message}`);
  }
}

/**
 * Compare a plain text password with a hashed password
 * 
 * @param {string} password - The plain text password to verify
 * @param {string} hash - The hashed password to compare against
 * @returns {Promise<boolean>} True if password matches, false otherwise
 * @throws {Error} If inputs are invalid or comparison fails
 */
async function comparePassword(password, hash) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('Hash must be a non-empty string');
  }

  try {
    const isMatch = await bcrypt.compare(password, hash);
    return isMatch;
  } catch (error) {
    throw new Error(`Password comparison failed: ${error.message}`);
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  SALT_ROUNDS
};
