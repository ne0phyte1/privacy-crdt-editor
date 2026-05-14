import { getDatabase } from "./database.js";

// ============================================================
// 角色数据访问层 — SQLite CRUD 操作
// ============================================================

export interface RoleRecord {
  id: number;
  role_name: string;
  priority: number;
  description: string;
  can_view_all: number;        // 0 or 1
  can_edit_all: number;        // 0 or 1
  can_manage_users: number;    // 0 or 1
  allowed_visibilities: string; // JSON array: '["public","group","private"]'
  can_edit_own_group: number;  // 0 or 1
  created_at: string;
  updated_at: string;
}

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
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM roles ORDER BY priority DESC");
  const rows = stmt.all() as RoleRecord[];

  const result: Record<string, RoleConfig> = {};
  for (const row of rows) {
    result[row.role_name] = toRoleConfig(row);
  }
  return result;
}

/**
 * 根据角色名获取角色配置
 */
export function getRoleConfig(roleName: string): RoleConfig | undefined {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM roles WHERE role_name = ?");
  const row = stmt.get(roleName) as RoleRecord | undefined;
  if (!row) return undefined;
  return toRoleConfig(row);
}

/**
 * 检查角色是否存在
 */
export function roleExists(roleName: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM roles WHERE role_name = ?");
  const row = stmt.get(roleName) as { count: number };
  return row.count > 0;
}

/**
 * 创建角色
 */
export function createRole(roleName: string, config: RoleConfig): boolean {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO roles (role_name, priority, description, can_view_all, can_edit_all,
       can_manage_users, allowed_visibilities, can_edit_own_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    roleName,
    config.priority,
    config.description,
    config.canViewAll ? 1 : 0,
    config.canEditAll ? 1 : 0,
    config.canManageUsers ? 1 : 0,
    JSON.stringify(config.allowedVisibilities),
    config.canEditOwnGroup ? 1 : 0,
  );
  return result.changes > 0;
}

/**
 * 更新角色
 */
export function updateRole(roleName: string, config: Partial<RoleConfig>): boolean {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (config.priority !== undefined) {
    fields.push("priority = ?");
    values.push(config.priority);
  }
  if (config.description !== undefined) {
    fields.push("description = ?");
    values.push(config.description);
  }
  if (config.canViewAll !== undefined) {
    fields.push("can_view_all = ?");
    values.push(config.canViewAll ? 1 : 0);
  }
  if (config.canEditAll !== undefined) {
    fields.push("can_edit_all = ?");
    values.push(config.canEditAll ? 1 : 0);
  }
  if (config.canManageUsers !== undefined) {
    fields.push("can_manage_users = ?");
    values.push(config.canManageUsers ? 1 : 0);
  }
  if (config.allowedVisibilities !== undefined) {
    fields.push("allowed_visibilities = ?");
    values.push(JSON.stringify(config.allowedVisibilities));
  }
  if (config.canEditOwnGroup !== undefined) {
    fields.push("can_edit_own_group = ?");
    values.push(config.canEditOwnGroup ? 1 : 0);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now')");
  values.push(roleName);

  const sql = `UPDATE roles SET ${fields.join(", ")} WHERE role_name = ?`;
  const stmt = db.prepare(sql);
  const result = stmt.run(...values);
  return result.changes > 0;
}

/**
 * 删除角色
 */
export function deleteRole(roleName: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM roles WHERE role_name = ?");
  const result = stmt.run(roleName);
  return result.changes > 0;
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
  const db = getDatabase();
  const count = db.prepare("SELECT COUNT(*) as count FROM roles").get() as { count: number };
  if (count.count > 0) {
    return; // 已有角色，跳过
  }

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO roles (role_name, priority, description, can_view_all, can_edit_all,
       can_manage_users, allowed_visibilities, can_edit_own_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction(() => {
    for (const { roleName, config } of DEFAULT_ROLES) {
      insertStmt.run(
        roleName,
        config.priority,
        config.description,
        config.canViewAll ? 1 : 0,
        config.canEditAll ? 1 : 0,
        config.canManageUsers ? 1 : 0,
        JSON.stringify(config.allowedVisibilities),
        config.canEditOwnGroup ? 1 : 0,
      );
    }
  });

  insertMany();
  console.log(`[DB] 已插入 ${DEFAULT_ROLES.length} 个默认角色`);
}
