import { TreeNode } from "../crdt/masterDoc.js";
import { getAllRoleConfigs, getRoleConfig as getRoleConfigFromDb } from "../db/roleStore.js";
import type { RoleConfig as RoleConfigFromDb } from "../db/roleStore.js";
import { findUserByUserId, getAllUsers as getAllUsersFromDb } from "../db/userStore.js";

// ============================================================
// User & Role Type Definitions
// ============================================================

export interface UserInfo {
  userId: string;
  username: string;
  role: "admin" | "leader" | "member" | "guest";
  group: string;
}

/**
 * Role configuration interface
 */
export interface RoleConfig {
  priority: number;
  description: string;
  canViewAll: boolean;
  canEditAll: boolean;
  canManageUsers: boolean;
  allowedVisibilities: ("public" | "group" | "private")[];
  canEditOwnGroup?: boolean;
}

// ============================================================
// User Management (reads from in-memory DB)
// ============================================================

/**
 * Get all users (converted to UserInfo format for backward compat)
 */
export function getAllUsers(): UserInfo[] {
  const users = getAllUsersFromDb();
  return users.map((u) => ({
    userId: u.userId,
    username: u.username,
    role: u.role as "admin" | "leader" | "member" | "guest",
    group: u.group,
  }));
}

/**
 * Get all role configs (from in-memory DB)
 */
export function getAllRoles(): Record<string, RoleConfig> {
  return getAllRoleConfigs();
}

/**
 * Get user info by userId
 */
export function getUserById(userId: string): UserInfo | undefined {
  const user = findUserByUserId(userId);
  if (!user) return undefined;
  return {
    userId: user.user_id,
    username: user.username,
    role: user.role as "admin" | "leader" | "member" | "guest",
    group: user.group_name,
  };
}

/**
 * Get role config by role name (from in-memory DB)
 */
export function getRoleConfig(role: string): RoleConfig | undefined {
  return getRoleConfigFromDb(role);
}

/**
 * Refresh user cache - in-memory DB doesn''t need cache
 */
export function refreshUserCache(): void {
  console.log("[AccessControl] Using in-memory DB, no cache refresh needed");
}

// ============================================================
// RBAC: Role-Based Access Control (NEW SPEC)
// ============================================================

/**
 * Check if user can READ a node (RBAC)
 *
 * Rules:
 * - Admin: can read all nodes
 * - Leader: can read level 1 (global announcements); can read level 2 & 3 in own group
 * - Member: can read level 1 (global announcements); can read level 2 in own group; can read level 3 in own group
 * - Guest: can only read level 1 with target "all"
 */
export function checkRBACRead(user: UserInfo, node: TreeNode): boolean {
  // root node always visible
  if (node.id === "root") return true;

  // deleted nodes only visible to admin
  if (node.deleted && user.role !== "admin") return false;

  // admin can read everything
  if (user.role === "admin") return true;

  // Level 1 (global announcements): anyone with matching target can read
  if (node.level === 1) {
    if (node.target === "all") return true;
    // target is a specific group - only that group can read
    return user.group === node.target;
  }

  // Level 2 (group announcements): only same-group leader/member can read
  if (node.level === 2) {
    if (user.role === "guest") return false;
    return user.group === node.target;
  }

  // Level 3 (group documents): only same-group leader/member can read
  if (node.level === 3) {
    if (user.role === "guest") return false;
    return user.group === node.target;
  }

  return false;
}

/**
 * Check if user can WRITE (update/delete/create) a node (RBAC)
 *
 * Rules:
 * - Admin: can write all nodes
 * - Leader: can write level 2 & 3 in own group
 * - Member: can write level 3 in own group
 * - Guest: cannot write anything
 */
export function checkRBACWrite(user: UserInfo, node: TreeNode): boolean {
  // root node only admin can modify
  if (node.id === "root") return user.role === "admin";

  // deleted nodes cannot be edited
  if (node.deleted) return false;

  // admin can write everything
  if (user.role === "admin") return true;

  // guest cannot write anything
  if (user.role === "guest") return false;

  // must be in the same group as the node target
  if (user.group !== node.target) return false;

  // Leader: can write level 2 (group announcements) and level 3 (group docs) in own group
  if (user.role === "leader") {
    return node.level === 2 || node.level === 3;
  }

  // Member: can write level 3 (group docs) in own group
  if (user.role === "member") {
    return node.level === 3;
  }

  return false;
}

// ============================================================
// NBAC (ABAC): Attribute-Based Access Control (NEW SPEC)
// ============================================================

/**
 * Check if user can READ a node (NBAC / ABAC)
 *
 * Uses the node level and target attributes.
 * NBAC is now the primary access control mechanism.
 * node.level: 1 (global announcement) | 2 (group announcement) | 3 (group document)
 * node.target: "all" | "GroupA" | "GroupB" etc.
 */
export function checkNBAC(user: UserInfo, node: TreeNode): boolean {
  // root node always visible
  if (node.id === "root") return true;

  // deleted nodes only visible to admin
  if (node.deleted && user.role !== "admin") return false;

  // admin can access all nodes
  if (user.role === "admin") return true;

  // Check by target attribute
  switch (node.target) {
    case "all":
      // "all" means everyone can see (already covered by RBAC, but NBAC also passes)
      return true;

    default:
      // Target is a specific group - only same-group users can see
      return user.group === node.target;
  }
}

/**
 * Check if user has CREATE permission under a parent node based on NBAC rules
 *
 * NBAC Creation Rules:
 * - Under level 1 parent: can create level 1, 2, or 3 children
 * - Under level 2 parent: can create level 2 or 3 children only
 * - Under level 3 parent: can create level 3 children only
 *
 * Target attribute inheritance for new child:
 * - Special case: parent is level 1 AND parent.target === "all":
 *   - Creating level 1 child -> target can be freely set
 *   - Creating level 2 or 3 child -> target must be set to creator''s group
 * - All other cases: child must inherit parent''s target
 *
 * @returns allowed level + resolved target, or null if not allowed
 */
export function resolveNBACChild(
  user: UserInfo,
  parentNode: TreeNode,
  requestedLevel: 1 | 2 | 3,
  requestedTarget?: string
): { level: 1 | 2 | 3; target: string } | null {
  // Check if the requested child level is allowed under this parent
  let maxAllowedLevel: number;
  switch (parentNode.level) {
    case 1:
      maxAllowedLevel = 3; // Can create level 1, 2, or 3
      break;
    case 2:
      maxAllowedLevel = 3; // Can create level 2 or 3 only
      break;
    case 3:
      maxAllowedLevel = 3; // Can create level 3 only
      break;
    default:
      return null;
  }

  // For level 2 parent, cannot create level 1
  if (parentNode.level === 2 && requestedLevel === 1) return null;

  // For level 3 parent, can only create level 3
  if (parentNode.level === 3 && requestedLevel !== 3) return null;

  // Resolve target attribute based on inheritance rules
  let resolvedTarget: string;

  // Special case: parent is level 1 AND target is "all"
  if (parentNode.level === 1 && parentNode.target === "all") {
    if (requestedLevel === 1) {
      // Level 1 child under level 1 parent with target "all": target can be freely set
      resolvedTarget = requestedTarget || "all";
    } else if (user.role === "admin") {
      // Admin creating L2/L3: can freely choose target group
      resolvedTarget = requestedTarget || user.group;
    } else {
      // Non-admin: Level 2 or 3 child target must be creator''s own group
      resolvedTarget = user.group;
    }
  } else {
    // All other cases: child inherits parent''s target
    resolvedTarget = parentNode.target;
  }

  return { level: requestedLevel, target: resolvedTarget };
}

// ============================================================
// Combined Access Checks
// ============================================================

/**
 * Combined read access check: both RBAC and NBAC must pass
 */
export function canAccessNode(user: UserInfo, node: TreeNode): boolean {
  // Deleted nodes are hidden from everyone (admin can still see them to operate,
  // but they are hidden from the regular view — removed via delete operation)
  if (node.deleted) return false;

  // Use NBAC for the primary check (it covers the RBAC semantics)
  return checkNBAC(user, node);
}

/**
 * Combined write (edit/delete) access check
 */
export function canEditNode(user: UserInfo, node: TreeNode): boolean {
  // root node only admin can modify
  if (node.id === "root") return user.role === "admin";

  // Admin can edit/delete any node, including already-deleted ones
  if (user.role === "admin") return true;

  // Non-admin: deleted nodes cannot be edited
  if (node.deleted) return false;

  // Must first have read access
  if (!canAccessNode(user, node)) return false;

  // Use RBAC write check
  return checkRBACWrite(user, node);
}

/**
 * Check if user can create a node under the given parent
 * Combines RBAC write permission on parent + NBAC creation rules
 */
export function canCreateUnder(
  user: UserInfo,
  parentNode: TreeNode,
  requestedLevel: 1 | 2 | 3,
  requestedTarget?: string
): { allowed: boolean; level: 1 | 2 | 3; target: string; message: string } {
  // Admin has full RBAC privileges but still respects NBAC level rules
  // (NBAC level restrictions apply to everyone including admin)

  // Guest cannot create any nodes
  if (user.role === "guest") {
    return { allowed: false, level: requestedLevel, target: "", message: "访客无法创建节点" };
  }

  // Must have read access on the parent node (creating child doesn't modify parent)
  if (!canAccessNode(user, parentNode)) {
    return { allowed: false, level: requestedLevel, target: "", message: `无权限在 "${parentNode.title}" 下创建子节点` };
  }

  // NBAC: enforce level creation rules (applies to all roles including admin)
  // Under L1 parent: can create L1, L2, L3
  // Under L2 parent: can create L2, L3 only (no L1)
  // Under L3 parent: can create L3 only (no L1, no L2)
  if (parentNode.level === 2 && requestedLevel === 1) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: cannot create level 1 under level 2 parent (only level 2 or 3 allowed under group announcements)` };
  }
  if (parentNode.level === 3 && requestedLevel !== 3) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: cannot create level ${requestedLevel} under level 3 parent (only level 3 allowed under group documents)` };
  }

  // RBAC: non-admin cannot create level 1 nodes
  if (requestedLevel === 1 && user.role !== "admin") {
    return { allowed: false, level: requestedLevel, target: "", message: "仅管理员可创建一级（全域公告）节点" };
  }

  // RBAC: check if user can create nodes of this level
  if (user.role === "leader") {
    if (requestedLevel !== 2 && requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "组长只可创建二级或三级节点" };
    }
  }
  if (user.role === "member") {
    if (requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "组员只可创建三级（组间文档）节点" };
    }
  }

  // NBAC: resolve target attribute inheritance
  const resolved = resolveNBACChild(user, parentNode, requestedLevel, requestedTarget);
  if (!resolved) {
    return { allowed: false, level: requestedLevel, target: "", message: "NBAC 属性解析错误" };
  }

  return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
}