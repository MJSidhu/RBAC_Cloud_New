/**
 * Unit Tests for Password Hashing Utilities
 * 
 * Tests the hashPassword and comparePassword functions to ensure:
 * - Passwords are hashed with bcrypt cost factor 10
 * - Password verification works correctly
 * - Error handling for invalid inputs
 */

const { hashPassword, comparePassword, SALT_ROUNDS } = require('../utils/passwordUtils');
const bcrypt = require('bcryptjs');

describe('Password Hashing Utilities', () => {
  describe('hashPassword', () => {
    test('should hash a valid password', async () => {
      const password = 'SecurePassword123!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    test('should use cost factor of 10', async () => {
      expect(SALT_ROUNDS).toBe(10);
      
      const password = 'TestPassword123';
      const hash = await hashPassword(password);
      
      // Bcrypt hashes start with $2a$ or $2b$ followed by cost factor
      // Format: $2a$10$... where 10 is the cost factor
      const costFactorMatch = hash.match(/^\$2[ab]\$(\d+)\$/);
      expect(costFactorMatch).not.toBeNull();
      expect(parseInt(costFactorMatch[1])).toBe(10);
    });

    test('should generate different hashes for the same password', async () => {
      const password = 'SamePassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      // But both should verify against the original password
      expect(await bcrypt.compare(password, hash1)).toBe(true);
      expect(await bcrypt.compare(password, hash2)).toBe(true);
    });

    test('should handle various password lengths', async () => {
      const shortPassword = 'abc';
      const longPassword = 'a'.repeat(100);

      const shortHash = await hashPassword(shortPassword);
      const longHash = await hashPassword(longPassword);

      expect(shortHash).toBeDefined();
      expect(longHash).toBeDefined();
      expect(await bcrypt.compare(shortPassword, shortHash)).toBe(true);
      expect(await bcrypt.compare(longPassword, longHash)).toBe(true);
    });

    test('should handle special characters in password', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(await bcrypt.compare(password, hash)).toBe(true);
    });

    test('should throw error for empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
    });

    test('should throw error for null password', async () => {
      await expect(hashPassword(null)).rejects.toThrow('Password must be a non-empty string');
    });

    test('should throw error for undefined password', async () => {
      await expect(hashPassword(undefined)).rejects.toThrow('Password must be a non-empty string');
    });

    test('should throw error for non-string password', async () => {
      await expect(hashPassword(12345)).rejects.toThrow('Password must be a non-empty string');
      await expect(hashPassword({})).rejects.toThrow('Password must be a non-empty string');
      await expect(hashPassword([])).rejects.toThrow('Password must be a non-empty string');
    });
  });

  describe('comparePassword', () => {
    test('should return true for matching password and hash', async () => {
      const password = 'CorrectPassword123';
      const hash = await hashPassword(password);

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    test('should return false for non-matching password', async () => {
      const password = 'CorrectPassword123';
      const wrongPassword = 'WrongPassword456';
      const hash = await hashPassword(password);

      const isMatch = await comparePassword(wrongPassword, hash);
      expect(isMatch).toBe(false);
    });

    test('should be case-sensitive', async () => {
      const password = 'CaseSensitive123';
      const hash = await hashPassword(password);

      expect(await comparePassword('CaseSensitive123', hash)).toBe(true);
      expect(await comparePassword('casesensitive123', hash)).toBe(false);
      expect(await comparePassword('CASESENSITIVE123', hash)).toBe(false);
    });

    test('should detect even small differences in password', async () => {
      const password = 'Password123';
      const hash = await hashPassword(password);

      expect(await comparePassword('Password123', hash)).toBe(true);
      expect(await comparePassword('Password124', hash)).toBe(false);
      expect(await comparePassword('Password123 ', hash)).toBe(false);
      expect(await comparePassword(' Password123', hash)).toBe(false);
    });

    test('should throw error for empty password', async () => {
      const hash = await hashPassword('ValidPassword123');
      await expect(comparePassword('', hash)).rejects.toThrow('Password must be a non-empty string');
    });

    test('should throw error for null password', async () => {
      const hash = await hashPassword('ValidPassword123');
      await expect(comparePassword(null, hash)).rejects.toThrow('Password must be a non-empty string');
    });

    test('should throw error for undefined password', async () => {
      const hash = await hashPassword('ValidPassword123');
      await expect(comparePassword(undefined, hash)).rejects.toThrow('Password must be a non-empty string');
    });

    test('should throw error for empty hash', async () => {
      await expect(comparePassword('ValidPassword123', '')).rejects.toThrow('Hash must be a non-empty string');
    });

    test('should throw error for null hash', async () => {
      await expect(comparePassword('ValidPassword123', null)).rejects.toThrow('Hash must be a non-empty string');
    });

    test('should throw error for undefined hash', async () => {
      await expect(comparePassword('ValidPassword123', undefined)).rejects.toThrow('Hash must be a non-empty string');
    });

    test('should return false for invalid hash format', async () => {
      // bcrypt.compare returns false for invalid hash format instead of throwing
      const result = await comparePassword('ValidPassword123', 'not-a-valid-hash');
      expect(result).toBe(false);
    });
  });

  describe('Integration tests', () => {
    test('should handle complete hash and verify workflow', async () => {
      const password = 'UserPassword123!';
      
      // Hash the password
      const hash = await hashPassword(password);
      
      // Verify correct password
      expect(await comparePassword(password, hash)).toBe(true);
      
      // Verify incorrect password
      expect(await comparePassword('WrongPassword', hash)).toBe(false);
    });

    test('should work with multiple users having same password', async () => {
      const password = 'CommonPassword123';
      
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      // Hashes should be different (due to different salts)
      expect(hash1).not.toBe(hash2);
      
      // But both should verify correctly
      expect(await comparePassword(password, hash1)).toBe(true);
      expect(await comparePassword(password, hash2)).toBe(true);
    });

    test('should handle rapid successive hashing operations', async () => {
      const passwords = ['Pass1', 'Pass2', 'Pass3', 'Pass4', 'Pass5'];
      
      const hashes = await Promise.all(
        passwords.map(pwd => hashPassword(pwd))
      );
      
      // Verify all hashes
      for (let i = 0; i < passwords.length; i++) {
        expect(await comparePassword(passwords[i], hashes[i])).toBe(true);
      }
      
      // Verify cross-verification fails
      expect(await comparePassword(passwords[0], hashes[1])).toBe(false);
    });
  });
});
