/**
 * RBAC Service
 *
 * Core service for Role-Based Access Control operations.
 * Uses pool.query() directly — the postgres superuser role bypasses RLS.
 * queryWithTenantContext is used only where RLS enforcement is needed for non-superuser roles.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.5, 7.3, 9.2, 9.3, 9.5, 15.2
 */

const { pool } = require("../config/database");
const { permissionCache } = require("./permissionCache");

const MAX_ROLE_HIERARCHY_DEPTH = 5;

// ── ROLE MANAGEMENT ──────────────────────────────────────────────────────────

async function createRole(tenantId, roleName, parentRoleId = null) {
  if (!tenantId || !roleName) throw new Error("tenantId and roleName are required");
  if (parentRoleId) await validateRoleHierarchy(tenantId, parentRoleId);
  try {
    const result = await pool.query(
      "INSERT INTO roles (tenant_id, role_name, parent_role_id) VALUES ($1, $2, $3) RETURNING role_id, tenant_id, role_name, parent_role_id, created_at",
      [tenantId, roleName, parentRoleId]
    );
    permissionCache.invalidateTenant(tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Role \"" + roleName + "\" already exists in this tenant");
    console.error("Failed to create role:", error);
    throw new Error("Failed to create role");
  }
}

async function getRole(tenantId, roleId) {
  if (!tenantId || !roleId) throw new Error("tenantId and roleId are required");
  try {
    const result = await pool.query(
      "SELECT role_id, tenant_id, role_name, parent_role_id, created_at FROM roles WHERE tenant_id = $1 AND role_id = $2",
      [tenantId, roleId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("Failed to get role:", error);
    throw new Error("Failed to get role");
  }
}

async function listRoles(tenantId) {
  if (!tenantId) throw new Error("tenantId is required");
  try {
    const result = await pool.query(
      "SELECT role_id, tenant_id, role_name, parent_role_id, created_at FROM roles WHERE tenant_id = $1 ORDER BY role_name",
      [tenantId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to list roles:", error);
    throw new Error("Failed to list roles");
  }
}

async function updateRole(tenantId, roleId, updates) {
  if (!tenantId || !roleId) throw new Error("tenantId and roleId are required");
  const { roleName, parentRoleId } = updates;
  if (parentRoleId !== undefined) {
    if (parentRoleId === roleId) throw new Error("A role cannot be its own parent");
    if (parentRoleId) await validateRoleHierarchy(tenantId, parentRoleId, roleId);
  }
  const fields = [];
  const values = [tenantId, roleId];
  let p = 3;
  if (roleName !== undefined) { fields.push("role_name = $" + p++); values.push(roleName); }
  if (parentRoleId !== undefined) { fields.push("parent_role_id = $" + p++); values.push(parentRoleId); }
  if (fields.length === 0) throw new Error("No fields to update");
  try {
    const result = await pool.query(
      "UPDATE roles SET " + fields.join(", ") + " WHERE tenant_id = $1 AND role_id = $2 RETURNING role_id, tenant_id, role_name, parent_role_id, created_at",
      values
    );
    if (result.rows.length === 0) throw new Error("Role not found");
    permissionCache.invalidateTenant(tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Role name already exists in this tenant");
    if (error.message === "Role not found") throw error;
    console.error("Failed to update role:", error);
    throw new Error("Failed to update role");
  }
}

async function deleteRole(tenantId, roleId) {
  if (!tenantId || !roleId) throw new Error("tenantId and roleId are required");
  try {
    const result = await pool.query(
      "DELETE FROM roles WHERE tenant_id = $1 AND role_id = $2 RETURNING role_id",
      [tenantId, roleId]
    );
    if (result.rows.length === 0) throw new Error("Role not found");
    permissionCache.invalidateTenant(tenantId);
    return true;
  } catch (error) {
    if (error.message === "Role not found") throw error;
    console.error("Failed to delete role:", error);
    throw new Error("Failed to delete role");
  }
}

async function validateRoleHierarchy(tenantId, parentRoleId, childRoleId = null) {
  const parentRole = await getRole(tenantId, parentRoleId);
  if (!parentRole) throw new Error("Parent role not found");
  if (childRoleId) {
    const visited = new Set();
    let cur = parentRoleId;
    while (cur) {
      if (cur === childRoleId) throw new Error("Cannot create circular role hierarchy");
      if (visited.has(cur)) throw new Error("Circular role hierarchy detected");
      visited.add(cur);
      const role = await getRole(tenantId, cur);
      cur = role ? role.parent_role_id : null;
    }
  }
  const depth = await getRoleDepth(tenantId, parentRoleId);
  if (depth >= MAX_ROLE_HIERARCHY_DEPTH) throw new Error("Role hierarchy depth cannot exceed " + MAX_ROLE_HIERARCHY_DEPTH + " levels");
}

async function getRoleDepth(tenantId, roleId) {
  let depth = 0;
  let cur = roleId;
  const visited = new Set();
  while (cur) {
    if (visited.has(cur)) throw new Error("Circular role hierarchy detected");
    visited.add(cur);
    const role = await getRole(tenantId, cur);
    if (!role || !role.parent_role_id) break;
    depth++;
    cur = role.parent_role_id;
  }
  return depth;
}

// ── PERMISSION MANAGEMENT ────────────────────────────────────────────────────

async function createPermission(tenantId, resourceName, action) {
  if (!tenantId || !resourceName || !action) throw new Error("tenantId, resourceName, and action are required");
  const validActions = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"];
  if (!validActions.includes(action)) throw new Error("Invalid action. Must be one of: " + validActions.join(", "));
  try {
    const result = await pool.query(
      "INSERT INTO permissions (tenant_id, resource_name, action) VALUES ($1, $2, $3) RETURNING permission_id, tenant_id, resource_name, action, created_at",
      [tenantId, resourceName, action]
    );
    permissionCache.invalidateTenant(tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Permission for \"" + resourceName + ":" + action + "\" already exists");
    console.error("Failed to create permission:", error);
    throw new Error("Failed to create permission");
  }
}

async function getPermission(tenantId, permissionId) {
  if (!tenantId || !permissionId) throw new Error("tenantId and permissionId are required");
  try {
    const result = await pool.query(
      "SELECT permission_id, tenant_id, resource_name, action, created_at FROM permissions WHERE tenant_id = $1 AND permission_id = $2",
      [tenantId, permissionId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("Failed to get permission:", error);
    throw new Error("Failed to get permission");
  }
}

async function updatePermission(tenantId, permissionId, updates) {
  if (!tenantId || !permissionId) throw new Error("tenantId and permissionId are required");
  const { resourceName, action } = updates;
  if (action !== undefined) {
    const validActions = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"];
    if (!validActions.includes(action)) throw new Error("Invalid action. Must be one of: " + validActions.join(", "));
  }
  const fields = [];
  const values = [tenantId, permissionId];
  let p = 3;
  if (resourceName !== undefined) { fields.push("resource_name = $" + p++); values.push(resourceName); }
  if (action !== undefined) { fields.push("action = $" + p++); values.push(action); }
  if (fields.length === 0) throw new Error("No fields to update");
  try {
    const result = await pool.query(
      "UPDATE permissions SET " + fields.join(", ") + " WHERE tenant_id = $1 AND permission_id = $2 RETURNING permission_id, tenant_id, resource_name, action, created_at",
      values
    );
    if (result.rows.length === 0) throw new Error("Permission not found");
    permissionCache.invalidateTenant(tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Permission with this resource and action already exists");
    if (error.message === "Permission not found") throw error;
    console.error("Failed to update permission:", error);
    throw new Error("Failed to update permission");
  }
}

async function deletePermission(tenantId, permissionId) {
  if (!tenantId || !permissionId) throw new Error("tenantId and permissionId are required");
  try {
    const result = await pool.query(
      "DELETE FROM permissions WHERE tenant_id = $1 AND permission_id = $2 RETURNING permission_id",
      [tenantId, permissionId]
    );
    if (result.rows.length === 0) throw new Error("Permission not found");
    permissionCache.invalidateTenant(tenantId);
    return true;
  } catch (error) {
    if (error.message === "Permission not found") throw error;
    console.error("Failed to delete permission:", error);
    throw new Error("Failed to delete permission");
  }
}

async function listPermissions(tenantId) {
  if (!tenantId) throw new Error("tenantId is required");
  try {
    const result = await pool.query(
      "SELECT permission_id, tenant_id, resource_name, action, created_at FROM permissions WHERE tenant_id = $1 ORDER BY resource_name, action",
      [tenantId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to list permissions:", error);
    throw new Error("Failed to list permissions");
  }
}

// Wildcard resource pattern matching (e.g. "files/*" matches "files/123", "*" matches anything)
function matchesResourcePattern(pattern, resource) {
  if (!pattern || !resource) return false;
  if (pattern === resource) return true;
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, "\\$&");
  const regexStr = escaped.replace(/\\\*/g, ".*").replace(/\*/g, ".*");
  const regex = new RegExp("^" + regexStr + "$");
  return regex.test(resource);
}

// ── ROLE-PERMISSION ASSIGNMENT ───────────────────────────────────────────────

async function assignPermissionToRole(tenantId, roleId, permissionId) {
  if (!tenantId || !roleId || !permissionId) throw new Error("tenantId, roleId, and permissionId are required");
  const role = await getRole(tenantId, roleId);
  if (!role) throw new Error("Role not found");
  const permission = await getPermission(tenantId, permissionId);
  if (!permission) throw new Error("Permission not found");
  try {
    const result = await pool.query(
      "INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES ($1, $2, $3) RETURNING role_id, permission_id, tenant_id, assigned_at",
      [roleId, permissionId, tenantId]
    );
    permissionCache.invalidateTenant(tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Permission already assigned to this role");
    console.error("Failed to assign permission to role:", error);
    throw new Error("Failed to assign permission to role");
  }
}

async function removePermissionFromRole(tenantId, roleId, permissionId) {
  if (!tenantId || !roleId || !permissionId) throw new Error("tenantId, roleId, and permissionId are required");
  try {
    const result = await pool.query(
      "DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2 AND permission_id = $3 RETURNING role_id",
      [tenantId, roleId, permissionId]
    );
    if (result.rows.length === 0) throw new Error("Permission assignment not found");
    permissionCache.invalidateTenant(tenantId);
    return true;
  } catch (error) {
    if (error.message === "Permission assignment not found") throw error;
    console.error("Failed to remove permission from role:", error);
    throw new Error("Failed to remove permission from role");
  }
}

async function getRolePermissions(tenantId, roleId) {
  if (!tenantId || !roleId) throw new Error("tenantId and roleId are required");
  try {
    const result = await pool.query(
      "SELECT p.permission_id, p.tenant_id, p.resource_name, p.action, p.created_at FROM permissions p INNER JOIN role_permissions rp ON p.permission_id = rp.permission_id WHERE rp.tenant_id = $1 AND rp.role_id = $2 ORDER BY p.resource_name, p.action",
      [tenantId, roleId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to get role permissions:", error);
    throw new Error("Failed to get role permissions");
  }
}

// ── USER-ROLE ASSIGNMENT ─────────────────────────────────────────────────────

async function assignRoleToUser(tenantId, userId, roleId) {
  if (!tenantId || !userId || !roleId) throw new Error("tenantId, userId, and roleId are required");
  const role = await getRole(tenantId, roleId);
  if (!role) throw new Error("Role not found");
  try {
    const result = await pool.query(
      "INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3) RETURNING user_id, role_id, tenant_id, assigned_at",
      [userId, roleId, tenantId]
    );
    permissionCache.invalidateUser(userId, tenantId);
    return result.rows[0];
  } catch (error) {
    if (error.code === "23505") throw new Error("Role already assigned to this user");
    console.error("Failed to assign role to user:", error);
    throw new Error("Failed to assign role to user");
  }
}

async function removeRoleFromUser(tenantId, userId, roleId) {
  if (!tenantId || !userId || !roleId) throw new Error("tenantId, userId, and roleId are required");
  try {
    const result = await pool.query(
      "DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3 RETURNING user_id",
      [tenantId, userId, roleId]
    );
    if (result.rows.length === 0) throw new Error("Role assignment not found");
    permissionCache.invalidateUser(userId, tenantId);
    return true;
  } catch (error) {
    if (error.message === "Role assignment not found") throw error;
    console.error("Failed to remove role from user:", error);
    throw new Error("Failed to remove role from user");
  }
}

async function getUserRoles(tenantId, userId) {
  if (!tenantId || !userId) throw new Error("tenantId and userId are required");
  try {
    const result = await pool.query(
      "SELECT r.role_id, r.tenant_id, r.role_name, r.parent_role_id, r.created_at FROM roles r INNER JOIN user_roles ur ON r.role_id = ur.role_id WHERE ur.tenant_id = $1 AND ur.user_id = $2 ORDER BY r.role_name",
      [tenantId, userId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to get user roles:", error);
    throw new Error("Failed to get user roles");
  }
}

// ── ROLE HIERARCHY TRAVERSAL ─────────────────────────────────────────────────

async function traverseRoleHierarchy(tenantId, roleId, maxDepth, visited, currentDepth) {
  if (maxDepth === undefined) maxDepth = MAX_ROLE_HIERARCHY_DEPTH;
  if (visited === undefined) visited = new Set();
  if (currentDepth === undefined) currentDepth = 0;
  if (!tenantId || !roleId) throw new Error("tenantId and roleId are required");
  if (visited.has(roleId)) return [];
  if (currentDepth > maxDepth) return [];
  visited.add(roleId);
  const directPermissions = await getRolePermissions(tenantId, roleId);
  const role = await getRole(tenantId, roleId);
  if (!role || !role.parent_role_id) return directPermissions;
  const parentPermissions = await traverseRoleHierarchy(tenantId, role.parent_role_id, maxDepth, visited, currentDepth + 1);
  return directPermissions.concat(parentPermissions);
}

// ── EFFECTIVE PERMISSIONS ────────────────────────────────────────────────────

async function getEffectivePermissions(userId, tenantId) {
  if (!userId || !tenantId) throw new Error("userId and tenantId are required");
  const cached = permissionCache.get(userId, tenantId);
  if (cached) return cached;
  const userRoles = await getUserRoles(tenantId, userId);
  const trustRoles = await getTrustRoles(userId, tenantId);
  const allRoles = userRoles.concat(trustRoles);
  const allPermissions = [];
  for (const role of allRoles) {
    const rolePermissions = await traverseRoleHierarchy(role.tenant_id, role.role_id, MAX_ROLE_HIERARCHY_DEPTH);
    allPermissions.push.apply(allPermissions, rolePermissions);
  }
  const permissionMap = new Map();
  for (const p of allPermissions) permissionMap.set(p.permission_id, p);
  const deduped = Array.from(permissionMap.values());
  permissionCache.set(userId, tenantId, deduped, 300000);
  return deduped;
}

async function getTrustRoles(userId, tenantId) {
  if (!userId || !tenantId) return [];
  try {
    const result = await pool.query(
      "SELECT r.role_id, r.tenant_id, r.role_name, r.parent_role_id, r.created_at FROM roles r INNER JOIN tenant_trust tt ON r.role_id = tt.exposed_role_id WHERE tt.trustee_tenant_id = $1 AND tt.is_active = true",
      [tenantId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to get trust roles:", error);
    return [];
  }
}

async function hasPermission(userId, tenantId, resource, action) {
  if (!userId || !tenantId || !resource || !action) return false;
  const permissions = await getEffectivePermissions(userId, tenantId);
  return permissions.some(function(p) { return p.action === action && matchesResourcePattern(p.resource_name, resource); });
}

module.exports = {
  createRole, getRole, updateRole, deleteRole, listRoles, validateRoleHierarchy, getRoleDepth,
  createPermission, getPermission, updatePermission, deletePermission, listPermissions, matchesResourcePattern,
  assignPermissionToRole, removePermissionFromRole, getRolePermissions,
  assignRoleToUser, removeRoleFromUser, getUserRoles,
  traverseRoleHierarchy,
  getEffectivePermissions, getTrustRoles, hasPermission
};
