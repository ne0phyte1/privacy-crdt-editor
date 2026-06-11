import memoryDB, { Role } from "./database.js";

// ============================================================
// 角色数据访问层 — 内存 CRUD 操作
// ============================================================

export interface RoleRecord extends Role {}

/**
 * 角色配置接口
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

/**
 * 将 RoleRecord 转为 RoleConfig
 */
function toRoleConfig(record: RoleRecord): RoleConfig {
  let visibilities: ("public" | "group" | "private")[] = ["public"];
  try {
    visibilities = JSON.parse(record.allowed_visibilities);
  } catch {
    visibilities = ["public"];
  }

  return {
    priority: record.priority,
    description: record.description,
    canViewAll: record.can_view_all === 1,
    canEditAll: record.can_edit_all === 1,
    canManageUsers: record.can_manage_users === 1,
    allowedVisibilities: visibilities,
    canEditOwnGroup: record.can_edit_own_group === 1,
  };
}

/**
 * 获取所有角色配置
 */
export function getAllRoleConfigs(): Record<string, RoleConfig> {
  const result: Record<string, RoleConfig> = {};
  for (const role of memoryDB.roles.values()) {
    result[role.role_name] = toRoleConfig(role);
  }
  return result;
}

/**
 * 根据角色名获取角色配置
 */
export function getRoleConfig(roleName: string): RoleConfig | undefined {
  const role = memoryDB.roles.get(roleName);
  if (!role) return undefined;
  return toRoleConfig(role);
}

/**
 * 检查角色是否存在
 */
export function roleExists(roleName: string): boolean {
  return memoryDB.roles.has(roleName);
}

/**
 * 创建角色
 */
export function createRole(roleName: string, config: RoleConfig): boolean {
  if (memoryDB.roles.has(roleName)) {
    return false;
  }

  const now = new Date().toISOString();
  const role: Role = {
    id: memoryDB.roles.size + 1,
    role_name: roleName,
    priority: config.priority,
    description: config.description,
    can_view_all: config.canViewAll ? 1 : 0,
    can_edit_all: config.canEditAll ? 1 : 0,
    can_manage_users: config.canManageUsers ? 1 : 0,
    allowed_visibilities: JSON.stringify(config.allowedVisibilities),
    can_edit_own_group: config.canEditOwnGroup ? 1 : 0,
    created_at: now,
    updated_at: now,
  };

  memoryDB.roles.set(roleName, role);
  return true;
}

/**
 * 更新角色
 */
export function updateRole(roleName: string, config: Partial<RoleConfig>): boolean {
  const role = memoryDB.roles.get(roleName);
  if (!role) return false;

  if (config.priority !== undefined) role.priority = config.priority;
  if (config.description !== undefined) role.description = config.description;
  if (config.canViewAll !== undefined) role.can_view_all = config.canViewAll ? 1 : 0;
  if (config.canEditAll !== undefined) role.can_edit_all = config.canEditAll ? 1 : 0;
  if (config.canManageUsers !== undefined) role.can_manage_users = config.canManageUsers ? 1 : 0;
  if (config.allowedVisibilities !== undefined) role.allowed_visibilities = JSON.stringify(config.allowedVisibilities);
  if (config.canEditOwnGroup !== undefined) role.can_edit_own_group = config.canEditOwnGroup ? 1 : 0;

  role.updated_at = new Date().toISOString();
  return true;
}

/**
 * 删除角色
 */
export function deleteRole(roleName: string): boolean {
  return memoryDB.roles.delete(roleName);
}

// ============================================================
// 默认角色种子数据（内联，不依赖配置文件）
// ============================================================

const DEFAULT_ROLES: Array<{
  roleName: string;
  config: RoleConfig;
}> = [
  {
    roleName: "admin",
    config: {
      priority: 100,
      description: "管理员 — 可访问和编辑所有节点",
      canViewAll: true,
      canEditAll: true,
      canManageUsers: true,
      allowedVisibilities: ["public", "group", "private"],
      canEditOwnGroup: false,
    },
  },
  {
    roleName: "leader",
    config: {
      priority: 80,
      description: "组长 — 可访问 public 和本组 group 节点，可编辑本组节点",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      allowedVisibilities: ["public", "group"],
      canEditOwnGroup: true,
    },
  },
  {
    roleName: "member",
    config: {
      priority: 60,
      description: "成员 — 可访问 public 和本组 group 节点，可编辑本组节点",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      allowedVisibilities: ["public", "group"],
      canEditOwnGroup: true,
    },
  },
  {
    roleName: "guest",
    config: {
      priority: 10,
      description: "访客 — 仅可查看 public 节点，无权编辑任何节点",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      allowedVisibilities: ["public"],
      canEditOwnGroup: false,
    },
  },
];

/**
 * 初始化种子角色数据（首次启动时插入默认角色）
 */
export function seedDefaultRoles(): void {
  const count = memoryDB.roles.size;
  if (count > 0) {
    return; // 已有角色，跳过
  }

  for (const { roleName, config } of DEFAULT_ROLES) {
    createRole(roleName, config);
  }

  console.log(`[DB] 已插入 ${DEFAULT_ROLES.length} 个默认角色`);
}
