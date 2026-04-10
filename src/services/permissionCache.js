class PermissionCache {
  get(userId, tenantId) { throw new Error('Method not implemented'); }
  set(userId, tenantId, permissions, ttl) { throw new Error('Method not implemented'); }
  invalidateUser(userId, tenantId) { throw new Error('Method not implemented'); }
  invalidateTenant(tenantId) { throw new Error('Method not implemented'); }
  clear() { throw new Error('Method not implemented'); }
}

class InMemoryPermissionCache extends PermissionCache {
  constructor(defaultTTL = 300000) {
    super();
    this.cache = new Map();
    this.DEFAULT_TTL = defaultTTL;
  }

  getCacheKey(userId, tenantId) {
    return `${tenantId}:${userId}`;
  }

  isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  get(userId, tenantId) {
    const key = this.getCacheKey(userId, tenantId);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    return entry.permissions;
  }

  set(userId, tenantId, permissions, ttl) {
    const key = this.getCacheKey(userId, tenantId);
    const timeToLive = ttl !== undefined ? ttl : this.DEFAULT_TTL;
    this.cache.set(key, { permissions, expiresAt: Date.now() + timeToLive });
  }

  invalidateUser(userId, tenantId) {
    this.cache.delete(this.getCacheKey(userId, tenantId));
  }

  invalidateTenant(tenantId) {
    const prefix = `${tenantId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const permissionCache = new InMemoryPermissionCache();

module.exports = { PermissionCache, InMemoryPermissionCache, permissionCache };
