/**
 * Unit tests for Trust Relationship Management Service
 * 
 * Tests Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

const { describe, it, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const { pool } = require('../config/database');
const {
  createTrustRelationship,
  activateTrust,
  deactivateTrust,
  listTrustRelationships,
  getTrustRelationship,
  deleteTrustRelationship,
  validateExposedRole,
  detectCircularTrust
} = require('../services/trustService');

describe('Trust Relationship Management Service', () => {
  let issuer1, issuer2;
  let tenantA, tenantB, tenantC;
  let roleA1, roleA2, roleB1, roleC1;
  
  beforeAll(async () => {
    // Create test issuers
    const issuerResult1 = await pool.query(
      `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
      ['Test Issuer 1']
    );
    issuer1 = issuerResult1.rows[0].issuer_id;
    
    const issuerResult2 = await pool.query(
      `INSERT INTO issuers (name) VALUES ($1) RETURNING issuer_id`,
      ['Test Issuer 2']
    );
    issuer2 = issuerResult2.rows[0].issuer_id;
  });
  
  beforeEach(async () => {
    // Clean up test data before each test
    await pool.query('DELETE FROM tenant_trust');
    await pool.query('DELETE FROM roles');
    await pool.query('DELETE FROM tenants WHERE issuer_id = $1 OR issuer_id = $2', [issuer1, issuer2]);
    
    // Create test tenants
    const tenantAResult = await pool.query(
      `INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id`,
      [issuer1, 'Tenant A']
    );
    tenantA = tenantAResult.rows[0].tenant_id;
    
    const tenantBResult = await pool.query(
      `INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id`,
      [issuer1, 'Tenant B']
    );
    tenantB = tenantBResult.rows[0].tenant_id;
    
    const tenantCResult = await pool.query(
      `INSERT INTO tenants (issuer_id, name) VALUES ($1, $2) RETURNING tenant_id`,
      [issuer2, 'Tenant C']
    );
    tenantC = tenantCResult.rows[0].tenant_id;
    
    // Create test roles
    const roleA1Result = await pool.query(
      `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id`,
      [tenantA, 'Admin']
    );
    roleA1 = roleA1Result.rows[0].role_id;
    
    const roleA2Result = await pool.query(
      `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id`,
      [tenantA, 'Developer']
    );
    roleA2 = roleA2Result.rows[0].role_id;
    
    const roleB1Result = await pool.query(
      `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id`,
      [tenantB, 'Viewer']
    );
    roleB1 = roleB1Result.rows[0].role_id;
    
    const roleC1Result = await pool.query(
      `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING role_id`,
      [tenantC, 'Editor']
    );
    roleC1 = roleC1Result.rows[0].role_id;
  });
  
  afterAll(async () => {
    // Clean up all test data
    await pool.query('DELETE FROM tenant_trust');
    await pool.query('DELETE FROM roles');
    await pool.query('DELETE FROM tenants WHERE issuer_id = $1 OR issuer_id = $2', [issuer1, issuer2]);
    await pool.query('DELETE FROM issuers WHERE issuer_id = $1 OR issuer_id = $2', [issuer1, issuer2]);
  });
  
  describe('validateExposedRole', () => {
    it('should return true when role belongs to tenant', async () => {
      const isValid = await validateExposedRole(tenantA, roleA1);
      expect(isValid).toBe(true);
    });
    
    it('should return false when role does not belong to tenant', async () => {
      const isValid = await validateExposedRole(tenantB, roleA1);
      expect(isValid).toBe(false);
    });
    
    it('should return false for non-existent role', async () => {
      const isValid = await validateExposedRole(tenantA, '00000000-0000-0000-0000-000000000000');
      expect(isValid).toBe(false);
    });
  });
  
  describe('createTrustRelationship', () => {
    it('should create a trust relationship with valid inputs', async () => {
      const trust = await createTrustRelationship(tenantA, tenantB, roleA1);
      
      expect(trust).toBeDefined();
      expect(trust.trust_id).toBeDefined();
      expect(trust.truster_tenant_id).toBe(tenantA);
      expect(trust.trustee_tenant_id).toBe(tenantB);
      expect(trust.exposed_role_id).toBe(roleA1);
      expect(trust.is_active).toBe(true);
      expect(trust.created_at).toBeDefined();
    });
    
    it('should reject when exposed role does not belong to truster tenant (Requirement 5.3)', async () => {
      await expect(
        createTrustRelationship(tenantA, tenantB, roleB1)
      ).rejects.toThrow('Exposed role does not belong to the truster tenant');
    });
    
    it('should reject when truster and trustee are the same tenant', async () => {
      await expect(
        createTrustRelationship(tenantA, tenantA, roleA1)
      ).rejects.toThrow('Cannot create trust relationship with the same tenant');
    });
    
    it('should reject duplicate trust relationships', async () => {
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      await expect(
        createTrustRelationship(tenantA, tenantB, roleA1)
      ).rejects.toThrow('Trust relationship already exists');
    });
    
    it('should reject when missing required parameters', async () => {
      await expect(
        createTrustRelationship(null, tenantB, roleA1)
      ).rejects.toThrow('Missing required parameters');
      
      await expect(
        createTrustRelationship(tenantA, null, roleA1)
      ).rejects.toThrow('Missing required parameters');
      
      await expect(
        createTrustRelationship(tenantA, tenantB, null)
      ).rejects.toThrow('Missing required parameters');
    });
    
    it('should allow multiple trust relationships with different roles', async () => {
      const trust1 = await createTrustRelationship(tenantA, tenantB, roleA1);
      const trust2 = await createTrustRelationship(tenantA, tenantB, roleA2);
      
      expect(trust1.trust_id).not.toBe(trust2.trust_id);
      expect(trust1.exposed_role_id).toBe(roleA1);
      expect(trust2.exposed_role_id).toBe(roleA2);
    });
  });
  
  describe('detectCircularTrust', () => {
    it('should detect direct circular trust (A->B, B->A)', async () => {
      // Create A trusts B
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Check if B trusting A would create a cycle
      const hasCircular = await detectCircularTrust(tenantB, tenantA);
      expect(hasCircular).toBe(true);
    });
    
    it('should detect indirect circular trust (A->B->C->A)', async () => {
      // Create A trusts B
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Create B trusts C
      await createTrustRelationship(tenantB, tenantC, roleB1);
      
      // Check if C trusting A would create a cycle
      const hasCircular = await detectCircularTrust(tenantC, tenantA);
      expect(hasCircular).toBe(true);
    });
    
    it('should not detect circular trust when none exists', async () => {
      // Create A trusts B
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Check if A trusting C would create a cycle (it should not)
      const hasCircular = await detectCircularTrust(tenantA, tenantC);
      expect(hasCircular).toBe(false);
    });
    
    it('should reject creating circular trust relationship (Requirement 5.5)', async () => {
      // Create A trusts B
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Try to create B trusts A (should fail)
      await expect(
        createTrustRelationship(tenantB, tenantA, roleB1)
      ).rejects.toThrow('would create circular trust dependency');
    });
    
    it('should reject creating indirect circular trust', async () => {
      // Create A trusts B
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Create B trusts C
      await createTrustRelationship(tenantB, tenantC, roleB1);
      
      // Try to create C trusts A (should fail)
      await expect(
        createTrustRelationship(tenantC, tenantA, roleC1)
      ).rejects.toThrow('would create circular trust dependency');
    });
  });
  
  describe('activateTrust', () => {
    it('should activate a deactivated trust relationship', async () => {
      const trust = await createTrustRelationship(tenantA, tenantB, roleA1);
      await deactivateTrust(trust.trust_id);
      
      const activated = await activateTrust(trust.trust_id);
      
      expect(activated.is_active).toBe(true);
      expect(activated.trust_id).toBe(trust.trust_id);
    });
    
    it('should throw error when trust ID not found', async () => {
      await expect(
        activateTrust('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Trust relationship not found');
    });
    
    it('should throw error when trust ID is missing', async () => {
      await expect(
        activateTrust(null)
      ).rejects.toThrow('Trust ID is required');
    });
  });
  
  describe('deactivateTrust', () => {
    it('should deactivate an active trust relationship (Requirement 5.4)', async () => {
      const trust = await createTrustRelationship(tenantA, tenantB, roleA1);
      
      const deactivated = await deactivateTrust(trust.trust_id);
      
      expect(deactivated.is_active).toBe(false);
      expect(deactivated.trust_id).toBe(trust.trust_id);
    });
    
    it('should throw error when trust ID not found', async () => {
      await expect(
        deactivateTrust('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Trust relationship not found');
    });
    
    it('should throw error when trust ID is missing', async () => {
      await expect(
        deactivateTrust(null)
      ).rejects.toThrow('Trust ID is required');
    });
  });
  
  describe('listTrustRelationships', () => {
    beforeEach(async () => {
      // Create multiple trust relationships for testing
      await createTrustRelationship(tenantA, tenantB, roleA1);
      await createTrustRelationship(tenantB, tenantC, roleB1);
      await createTrustRelationship(tenantA, tenantC, roleA2);
    });
    
    it('should list all trust relationships for a tenant', async () => {
      const trusts = await listTrustRelationships(tenantA);
      
      expect(trusts.length).toBe(2);
      expect(trusts.every(t => t.truster_tenant_id === tenantA || t.trustee_tenant_id === tenantA)).toBe(true);
    });
    
    it('should filter by truster role', async () => {
      const trusts = await listTrustRelationships(tenantA, { role: 'truster' });
      
      expect(trusts.length).toBe(2);
      expect(trusts.every(t => t.truster_tenant_id === tenantA)).toBe(true);
    });
    
    it('should filter by trustee role', async () => {
      const trusts = await listTrustRelationships(tenantB, { role: 'trustee' });
      
      expect(trusts.length).toBe(1);
      expect(trusts[0].trustee_tenant_id).toBe(tenantB);
      expect(trusts[0].truster_tenant_id).toBe(tenantA);
    });
    
    it('should filter by active status', async () => {
      const allTrusts = await listTrustRelationships(tenantA);
      const firstTrust = allTrusts[0];
      
      await deactivateTrust(firstTrust.trust_id);
      
      const activeTrusts = await listTrustRelationships(tenantA, { activeOnly: true });
      
      expect(activeTrusts.length).toBe(1);
      expect(activeTrusts.every(t => t.is_active === true)).toBe(true);
    });
    
    it('should include tenant and role names in results', async () => {
      const trusts = await listTrustRelationships(tenantA);
      
      expect(trusts[0].truster_tenant_name).toBeDefined();
      expect(trusts[0].trustee_tenant_name).toBeDefined();
      expect(trusts[0].exposed_role_name).toBeDefined();
    });
    
    it('should throw error when tenant ID is missing', async () => {
      await expect(
        listTrustRelationships(null)
      ).rejects.toThrow('Tenant ID is required');
    });
  });
  
  describe('getTrustRelationship', () => {
    it('should get a specific trust relationship by ID', async () => {
      const created = await createTrustRelationship(tenantA, tenantB, roleA1);
      
      const trust = await getTrustRelationship(created.trust_id);
      
      expect(trust).toBeDefined();
      expect(trust.trust_id).toBe(created.trust_id);
      expect(trust.truster_tenant_id).toBe(tenantA);
      expect(trust.trustee_tenant_id).toBe(tenantB);
      expect(trust.exposed_role_id).toBe(roleA1);
      expect(trust.truster_tenant_name).toBe('Tenant A');
      expect(trust.trustee_tenant_name).toBe('Tenant B');
      expect(trust.exposed_role_name).toBe('Admin');
    });
    
    it('should return null when trust relationship not found', async () => {
      const trust = await getTrustRelationship('00000000-0000-0000-0000-000000000000');
      expect(trust).toBeNull();
    });
    
    it('should throw error when trust ID is missing', async () => {
      await expect(
        getTrustRelationship(null)
      ).rejects.toThrow('Trust ID is required');
    });
  });
  
  describe('deleteTrustRelationship', () => {
    it('should delete a trust relationship', async () => {
      const trust = await createTrustRelationship(tenantA, tenantB, roleA1);
      
      const deleted = await deleteTrustRelationship(trust.trust_id);
      
      expect(deleted).toBe(true);
      
      const found = await getTrustRelationship(trust.trust_id);
      expect(found).toBeNull();
    });
    
    it('should return false when trust relationship not found', async () => {
      const deleted = await deleteTrustRelationship('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
    
    it('should throw error when trust ID is missing', async () => {
      await expect(
        deleteTrustRelationship(null)
      ).rejects.toThrow('Trust ID is required');
    });
  });
  
  describe('Integration with getTrustRoles (Requirement 5.2)', () => {
    it('should allow trustee tenant users to access exposed roles', async () => {
      // Create trust relationship
      await createTrustRelationship(tenantA, tenantB, roleA1);
      
      // Query trust roles for tenant B (trustee)
      const query = `
        SELECT r.role_id, r.tenant_id, r.role_name, r.parent_role_id, r.created_at 
        FROM roles r 
        INNER JOIN tenant_trust tt ON r.role_id = tt.exposed_role_id 
        WHERE tt.trustee_tenant_id = $1 AND tt.is_active = true
      `;
      
      const result = await pool.query(query, [tenantB]);
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].role_id).toBe(roleA1);
      expect(result.rows[0].role_name).toBe('Admin');
    });
    
    it('should not expose roles when trust is deactivated', async () => {
      // Create and deactivate trust relationship
      const trust = await createTrustRelationship(tenantA, tenantB, roleA1);
      await deactivateTrust(trust.trust_id);
      
      // Query trust roles for tenant B (trustee)
      const query = `
        SELECT r.role_id 
        FROM roles r 
        INNER JOIN tenant_trust tt ON r.role_id = tt.exposed_role_id 
        WHERE tt.trustee_tenant_id = $1 AND tt.is_active = true
      `;
      
      const result = await pool.query(query, [tenantB]);
      
      expect(result.rows.length).toBe(0);
    });
  });
});
