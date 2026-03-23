/**
 * Permission Cache Service
 * 
 * Provides in-memory caching of user permissions with TTL-based expiration.
 * Implements cache invalidation strategies for user and tenant-level changes.
 * 
 * Requirements: 15.1, 15.2
 */

/**
 * Cache entry structure with permissions and expiration timestamp
 * @typedef {Object} CacheEntry
 * @property {Array<Object>} permissions - Array of permission objects
 * @property {number} expiresAt - Timestamp when entry expires (milliseconds)
 */

/**
 * Permission Cache Interface
 * 
 * Defines the contract for permission caching implementations.
 */
class PermissionCache {
  /**
   * Get cached permissions for a user
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @returns {Array<Object>|null} Cached permissions or null if not found/expired
   */
  get(userId, tenantId) {
    throw new Error('Method not implemented');
  }

  /**
   * Store permissions in cache with TTL
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @param {Array<Object>} permissions - Array of permission objects
   * @param {number} ttl - Time to live in milliseconds
   * @returns {void}
   */
  set(userId, tenantId, permissions, ttl) {
    throw new Error('Method not implemented');
  }

  /**
   * Invalidate cache for a specific user
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @returns {void}
   */
  invalidateUser(userId, tenantId) {
    throw new Error('Method not implemented');
  }

  /**
   * Invalidate cache for all users in a tenant
   * @param {string} tenantId - Tenant UUID
   * @returns {void}
   */
  invalidateTenant(tenantId) {
    throw new Error('Method not implemented');
  }

  /**
   * Clear all cache entries
   * @returns {void}
   */
  clear() {
    throw new Error('Method not implemented');
  }
}

/**
 * In-Memory Permission Cache Implementation
 * 
 * Simple Map-based cache with TTL expiration.
 * Cache keys use format: `${tenantId}:${userId}`
 */
class InMemoryPermissionCache extends PermissionCache {
  /**
   * Create a new in-memory permission cache
   * @param {number} defaultTTL - Default TTL in milliseconds (default: 5 minutes)
   */
  constructor(defaultTTL = 300000) {
    super();
    
    /**
     * @private
     * @type {Map<string, CacheEntry>}
     */
    this.cache = new Map();
    
    /**
     * @private
     * @type {number}
     */
    this.DEFAULT_TTL = defaultTTL;
  }

  /**
   * Generate cache key from tenant and user IDs
   * @private
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @returns {string} Cache key in format `${tenantId}:${userId}`
   */
  getCacheKey(userId, tenantId) {
    return `${tenantId}:${userId}`;
  }

  /**
   * Check if a cache entry has expired
   * @private
   * @param {CacheEntry} entry - Cache entry to check
   * @returns {boolean} True if expired, false otherwise
   */
  isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Get cached permissions for a user
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @returns {Array<Object>|null} Cached permissions or null if not found/expired
   */
  get(userId, tenantId) {
    const key = this.getCacheKey(userId, tenantId);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    return entry.permissions;
  }

  /**
   * Store permissions in cache with TTL
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @param {Array<Object>} permissions - Array of permission objects
   * @param {number} ttl - Time to live in milliseconds (optional, uses default if not provided)
   * @returns {void}
   */
  set(userId, tenantId, permissions, ttl) {
    const key = this.getCacheKey(userId, tenantId);
    const timeToLive = ttl !== undefined ? ttl : this.DEFAULT_TTL;
    
    const entry = {
      permissions,
      expiresAt: Date.now() + timeToLive
    };

    this.cache.set(key, entry);
  }

  /**
   * Invalidate cache for a specific user
   * @param {string} userId - User UUID
   * @param {string} tenantId - Tenant UUID
   * @returns {void}
   */
  invalidateUser(userId, tenantId) {
    const key = this.getCacheKey(userId, tenantId);
    this.cache.delete(key);
  }

  /**
   * Invalidate cache for all users in a tenant
   * Called when roles or permissions are modified for the tenant
   * @param {string} tenantId - Tenant UUID
   * @returns {void}
   */
  invalidateTenant(tenantId) {
    const prefix = `${tenantId}:`;
    
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   * @returns {void}
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current cache size (for monitoring/debugging)
   * @returns {number} Number of entries in cache
   */
  size() {
    return this.cache.size;
  }
}

// Export singleton instance for use across the application
const permissionCache = new InMemoryPermissionCache();

module.exports = {
  PermissionCache,
  InMemoryPermissionCache,
  permissionCache
};
