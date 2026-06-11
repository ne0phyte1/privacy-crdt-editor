import memoryDB from "./database.js";
import bcrypt from "bcryptjs";

// ============================================================
// 用户数据访问层 — 内存 CRUD 操作
// ============================================================

export interface UserRecord {
  id: number;
  user_id: string;
  username: string;
  password_hash: string;
  role: string;
  group_name: string;
  created_at: string;
  updated_at: string;
}

export interface UserPublicInfo {
  userId: string;
  username: string;
  role: string;
  group: string;
  createdAt: string;
}

export interface CreateUserInput {
  userId: string;
  username: string;
  passwordHash: string;
  role: string;
  groupName: string;
}

export interface UpdateUserInput {
  role?: string;
  groupName?: string;
  passwordHash?: string;
}

/**
 * 通过 user_id 查找用户
 */
export function findUserByUserId(userId: string): UserRecord | undefined {
  const user = memoryDB.users.get(userId);
  if (!user) return undefined;
  
  return {
    id: 0,
    user_id: user.user_id,
    username: user.username,
    password_hash: user.password_hash,
    role: user.role,
    group_name: user.group_name,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

/**
 * 通过 username 查找用户（用于登录）
 */
export function findUserByUsername(username: string): UserRecord | undefined {
  for (const user of memoryDB.users.values()) {
    if (user.username === username) {
      return {
        id: 0,
        user_id: user.user_id,
        username: user.username,
        password_hash: user.password_hash,
        role: user.role,
        group_name: user.group_name,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };
    }
  }
  return undefined;
}

/**
 * 获取所有用户的公开信息列表
 */
export function getAllUsers(): UserPublicInfo[] {
  return Array.from(memoryDB.users.values()).map((user) => ({
    userId: user.user_id,
    username: user.username,
    role: user.role,
    group: user.group_name,
    createdAt: user.created_at,
  }));
}

/**
 * 创建新用户
 */
export function createUser(input: CreateUserInput): UserRecord {
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: memoryDB.users.size + 1,
    user_id: input.userId,
    username: input.username,
    password_hash: input.passwordHash,
    role: input.role,
    group_name: input.groupName,
    created_at: now,
    updated_at: now,
  };
  
  memoryDB.users.set(input.userId, user);
  return user;
}

/**
 * 更新用户信息
 */
export function updateUser(userId: string, input: UpdateUserInput): boolean {
  const user = memoryDB.users.get(userId);
  if (!user) return false;

  if (input.role !== undefined) user.role = input.role;
  if (input.groupName !== undefined) user.group_name = input.groupName;
  if (input.passwordHash !== undefined) user.password_hash = input.passwordHash;

  user.updated_at = new Date().toISOString();
  return true;
}

/**
 * 删除用户
 */
export function deleteUser(userId: string): boolean {
  return memoryDB.users.delete(userId);
}

/**
 * 获取用户总数
 */
export function getUserCount(): number {
  return memoryDB.users.size;
}

// ============================================================
// 默认用户种子数据（内联，不依赖配置文件）
// 密码均为 "password123"
// ============================================================

const DEFAULT_USERS: Array<{
  userId: string;
  username: string;
  role: string;
  groupName: string;
}> = [
  { userId: "admin01",  username: "admin01",  role: "admin",  groupName: "admin" },
  { userId: "leaderA",  username: "leaderA",  role: "leader", groupName: "groupA" },
  { userId: "memberA1", username: "memberA1", role: "member", groupName: "groupA" },
  { userId: "memberA2", username: "memberA2", role: "member", groupName: "groupA" },
  { userId: "leaderB",  username: "leaderB",  role: "leader", groupName: "groupB" },
  { userId: "memberB1", username: "memberB1", role: "member", groupName: "groupB" },
  { userId: "guest01",  username: "guest01",  role: "guest",  groupName: "guest" },
];

/**
 * 初始化种子用户（首次启动时插入默认用户）
 */
export function seedDefaultUsers(): void {
  const count = getUserCount();
  if (count > 0) {
    return; // 已有用户，跳过
  }

  const passwordHash = bcrypt.hashSync("password123", 10);

  for (const u of DEFAULT_USERS) {
    createUser({
      userId: u.userId,
      username: u.username,
      passwordHash,
      role: u.role,
      groupName: u.groupName,
    });
  }

  console.log(`[DB] 已插入 ${DEFAULT_USERS.length} 个默认用户（密码: password123）`);
}
