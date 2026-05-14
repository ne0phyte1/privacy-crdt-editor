import { getDatabase } from "./database.js";
import bcrypt from "bcryptjs";

// ============================================================
// 用户数据访问层 — SQLite CRUD 操作
// ============================================================

export interface UserRecord {
  id: number;
  user_id: string;
  username: string;
  password_hash: string;
  name: string;
  role: string;
  group_name: string;
  created_at: string;
  updated_at: string;
}

export interface UserPublicInfo {
  userId: string;
  username: string;
  name: string;
  role: string;
  group: string;
  createdAt: string;
}

export interface CreateUserInput {
  userId: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  groupName: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: string;
  groupName?: string;
  passwordHash?: string;
}

/**
 * 通过 user_id 查找用户
 */
export function findUserByUserId(userId: string): UserRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM users WHERE user_id = ?");
  return stmt.get(userId) as UserRecord | undefined;
}

/**
 * 通过 username 查找用户（用于登录）
 */
export function findUserByUsername(username: string): UserRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
  return stmt.get(username) as UserRecord | undefined;
}

/**
 * 获取所有用户的公开信息列表
 */
export function getAllUsers(): UserPublicInfo[] {
  const db = getDatabase();
  const stmt = db.prepare(
    "SELECT user_id, username, name, role, group_name, created_at FROM users ORDER BY id ASC"
  );
  const rows = stmt.all() as Array<{
    user_id: string;
    username: string;
    name: string;
    role: string;
    group_name: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    name: r.name,
    role: r.role,
    group: r.group_name,
    createdAt: r.created_at,
  }));
}

/**
 * 创建新用户
 */
export function createUser(input: CreateUserInput): UserRecord {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO users (user_id, username, password_hash, name, role, group_name)
     VALUES (@userId, @username, @passwordHash, @name, @role, @groupName)`
  );
  stmt.run(input);

  return findUserByUserId(input.userId)!;
}

/**
 * 更新用户信息
 */
export function updateUser(userId: string, input: UpdateUserInput): boolean {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.role !== undefined) {
    fields.push("role = ?");
    values.push(input.role);
  }
  if (input.groupName !== undefined) {
    fields.push("group_name = ?");
    values.push(input.groupName);
  }
  if (input.passwordHash !== undefined) {
    fields.push("password_hash = ?");
    values.push(input.passwordHash);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now')");
  values.push(userId);

  const sql = `UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`;
  const stmt = db.prepare(sql);
  const result = stmt.run(...values);
  return result.changes > 0;
}

/**
 * 删除用户
 */
export function deleteUser(userId: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM users WHERE user_id = ?");
  const result = stmt.run(userId);
  return result.changes > 0;
}

/**
 * 获取用户总数
 */
export function getUserCount(): number {
  const db = getDatabase();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM users");
  const row = stmt.get() as { count: number };
  return row.count;
}

// ============================================================
// 默认用户种子数据（内联，不依赖配置文件）
// 密码均为 "password123"
// ============================================================

const DEFAULT_USERS: Array<{
  userId: string;
  username: string;
  name: string;
  role: string;
  groupName: string;
}> = [
  { userId: "admin01",  username: "admin01",  name: "管理员",   role: "admin",  groupName: "admin" },
  { userId: "leaderA",  username: "leaderA",  name: "A组组长",  role: "leader", groupName: "groupA" },
  { userId: "memberA1", username: "memberA1", name: "A组成员1", role: "member", groupName: "groupA" },
  { userId: "memberA2", username: "memberA2", name: "A组成员2", role: "member", groupName: "groupA" },
  { userId: "leaderB",  username: "leaderB",  name: "B组组长",  role: "leader", groupName: "groupB" },
  { userId: "memberB1", username: "memberB1", name: "B组成员1", role: "member", groupName: "groupB" },
  { userId: "guest01",  username: "guest01",  name: "访客",     role: "guest",  groupName: "guest" },
];

/**
 * 初始化种子用户（首次启动时插入默认用户）
 */
export function seedDefaultUsers(): void {
  const count = getUserCount();
  if (count > 0) {
    return; // 已有用户，跳过
  }

  const db = getDatabase();
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO users (user_id, username, password_hash, name, role, group_name)
     VALUES (@userId, @username, @passwordHash, @name, @role, @groupName)`
  );

  const passwordHash = bcrypt.hashSync("password123", 10);

  const insertMany = db.transaction(() => {
    for (const u of DEFAULT_USERS) {
      insertStmt.run({
        userId: u.userId,
        username: u.username,
        passwordHash,
        name: u.name,
        role: u.role,
        groupName: u.groupName,
      });
    }
  });

  insertMany();
  console.log(`[DB] 已插入 ${DEFAULT_USERS.length} 个默认用户（密码: password123）`);
}
