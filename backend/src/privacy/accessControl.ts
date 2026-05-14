import { TreeNode } from "../crdt/masterDoc.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ============================================================
// 用户与角色类型定义
// ============================================================

export interface UserInfo {
  userId: string;
  name: string;
  role: "admin" | "leader" | "member" | "guest";
  group: string;
}

export interface RoleConfig {
  priority: number;
  description: string;
  canViewAll: boolean;
  canEditAll: boolean;
  canManageUsers: boolean;
  allowedVisibilities: ("public" | "group" | "private")[];
  canEditOwnGroup?: boolean;
}

export interface UsersConfig {
  users: UserInfo[];
}

export interface RolesConfig {
  roles: Record<string, RoleConfig>;
}

// ============================================================
// 文件路径
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_PATH = path.resolve(__dirname, "../../../configs/users.json");
const ROLES_PATH = path.resolve(__dirname, "../../../configs/roles.json");

// ============================================================
// 用户配置加载
// ============================================================

let cachedUsers: UserInfo[] | null = null;
let cachedRoles: Record<string, RoleConfig> | null = null;

/**
 * 加载 users.json 配置
 */
export function loadUsersConfig(): UsersConfig {
  const raw = fs.readFileSync(USERS_PATH, "utf-8");
  return JSON.parse(raw) as UsersConfig;
}

/**
 * 加载 roles.json 配置
 */
export function loadRolesConfig(): RolesConfig {
  const raw = fs.readFileSync(ROLES_PATH, "utf-8");
  return JSON.parse(raw) as RolesConfig;
}

/**
 * 获取所有用户列表
 */
export function getAllUsers(): UserInfo[] {
  if (cachedUsers) return cachedUsers;
  const config = loadUsersConfig();
  cachedUsers = config.users;
  return cachedUsers;
}

/**
 * 获取所有角色配置
 */
export function getAllRoles(): Record<string, RoleConfig> {
  if (cachedRoles) return cachedRoles;
  const config = loadRolesConfig();
  cachedRoles = config.roles;
  return cachedRoles;
}

/**
 * 根据 userId 获取用户信息
 */
export function getUserById(userId: string): UserInfo | undefined {
  return getAllUsers().find((u) => u.userId === userId);
}

/**
 * 根据角色名获取角色配置
 */
export function getRoleConfig(role: string): RoleConfig | undefined {
  return getAllRoles()[role];
}

/**
 * 刷新所有缓存
 */
export function refreshUserCache(): void {
  cachedUsers = null;
  cachedRoles = null;
}

// ============================================================
// RBAC 策略：基于角色的访问控制
// ============================================================

/**
 * RBAC 策略判断：用户是否对某节点有访问权限
 * 规则：用户的 role 必须在节点的 allowedRoles 列表中
 */
export function checkRBAC(user: UserInfo, node: TreeNode): boolean {
  // root 节点始终可见
  if (node.id === "root") return true;

  // 已删除节点对非管理员不可见
  if (node.deleted && user.role !== "admin") return false;

  // admin 角色可以访问所有节点
  if (user.role === "admin") return true;

  // 检查用户的 role 是否在节点的 allowedRoles 中
  return node.allowedRoles.includes(user.role);
}

// ============================================================
// ABAC 策略：基于节点属性的访问控制
// ============================================================

/**
 * ABAC 策略判断：用户是否对某节点有访问权限
 * 规则：
 * - public：所有用户可见
 * - group：同组用户可见（或 admin）
 * - private：仅 admin 或指定角色可见
 */
export function checkABAC(user: UserInfo, node: TreeNode): boolean {
  // root 节点始终可见
  if (node.id === "root") return true;

  // 已删除节点对非管理员不可见
  if (node.deleted && user.role !== "admin") return false;

  // admin 可以访问所有节点
  if (user.role === "admin") return true;

  switch (node.visibility) {
    case "public":
      return true;

    case "group":
      // group 节点：同组用户可见
      return user.group === node.ownerGroup;

    case "private":
      // private 节点：仅 admin 可见
      return false;

    default:
      return false;
  }
}

// ============================================================
// 组合权限检查（RBAC + ABAC 同时生效）
// ============================================================

/**
 * 综合权限检查：RBAC 和 ABAC 同时判断，两者都通过才允许访问
 */
export function canAccessNode(user: UserInfo, node: TreeNode): boolean {
  if (node.deleted) {
    if (user.role === "admin") return true;
    return false;
  }

  const rbacPass = checkRBAC(user, node);
  const abacPass = checkABAC(user, node);

  return rbacPass && abacPass;
}

/**
 * 检查用户是否有权限修改节点
 * 基于 roles.json 中的角色配置进行判断
 */
export function canEditNode(user: UserInfo, node: TreeNode): boolean {
  // root 节点只有 admin 可修改
  if (node.id === "root") return user.role === "admin";

  // 已删除节点不能编辑
  if (node.deleted) return false;

  const roleConfig = getRoleConfig(user.role);

  // 如果角色配置不存在，保守拒绝
  if (!roleConfig) return false;

  // canEditAll 的角色（admin）可以编辑所有节点
  if (roleConfig.canEditAll) return true;

  // 没有编辑权限的角色（guest）不能编辑任何节点
  if (!roleConfig.canEditOwnGroup) return false;

  // 必须先有查看权限
  if (!canAccessNode(user, node)) return false;

  // 对于 group 节点：只有同组可编辑（由 canEditOwnGroup 控制）
  if (node.visibility === "group") {
    return user.group === node.ownerGroup;
  }

  // public 节点：有 canEditOwnGroup 的角色可以编辑
  if (node.visibility === "public") {
    return true;
  }

  // private 节点：只有 admin 可编辑
  return false;
}
