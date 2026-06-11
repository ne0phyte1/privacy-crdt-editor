// ============================================================
// 内存数据库实现（用于课程项目演示）
// ============================================================

interface User {
  user_id: string;
  username: string;
  password_hash: string;
  role: string;
  group_name: string;
  created_at: string;
  updated_at: string;
}

export interface Group {
  group_name: string;
  description: string;
  created_at: string;
}

export interface Role {
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

interface OperationLog {
  id: number;
  user_id: string;
  action: string;
  target: string;
  detail: string;
  ip_address?: string;
  created_at: string;
}

// 内存数据存储
const memoryDB = {
  users: new Map<string, User>(),
  roles: new Map<string, Role>(),
  groups: new Map<string, Group>(),
  logs: [] as OperationLog[],
  nextLogId: 1,
};

/**
 * 获取数据库实例（内存版）
 */
export function getDatabase() {
  return memoryDB;
}

/**
 * 初始化数据库表结构（内存版）
 */
export function initializeDatabase(): void {
  console.log("[DB] 内存数据库初始化完成");
}

/**
 * 关闭数据库连接（内存版）
 */
export function closeDatabase(): void {
  memoryDB.users.clear();
  memoryDB.roles.clear();
  memoryDB.groups.clear();
  memoryDB.logs = [];
  memoryDB.nextLogId = 1;
  console.log("[DB] 内存数据库已清空");
}

// 导出内存数据库实例
export default memoryDB;
