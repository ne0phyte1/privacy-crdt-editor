import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  findUserByUsername,
  findUserByUserId,
  createUser,
  updateUser,
  UserRecord,
  UserPublicInfo,
} from "../db/userStore.js";
import { logOperation } from "../db/operationLogStore.js";

// ============================================================
// 认证服务 — 注册 / 登录 / JWT 令牌管理
// ============================================================

// JWT 密钥（生产环境应使用环境变量）
const JWT_SECRET = process.env.JWT_SECRET || "privacy-crdt-editor-jwt-secret-2024";
const JWT_EXPIRES_IN = "24h";

export interface RegisterInput {
  userId: string;
  username: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  message: string;
  token?: string;
  user?: UserPublicInfo;
}

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  group: string;
}

/**
 * 用户注册
 */
export function register(input: RegisterInput, ipAddress?: string): AuthResult {
  // 检查必填字段
  if (!input.username || !input.password) {
    return {
      success: false,
      message: "用户名和密码为必填项",
    };
  }

  if (input.password.length < 6) {
    return {
      success: false,
      message: "密码长度不能少于6位",
    };
  }

  // 检查用户名是否已存在
  const existingByUsername = findUserByUsername(input.username);
  if (existingByUsername) {
    return {
      success: false,
      message: `用户名 '${input.username}' 已被注册`,
    };
  }

  // 检查 userId 是否已存在
  const existingByUserId = findUserByUserId(input.userId);
  if (existingByUserId) {
    return {
      success: false,
      message: `用户ID '${input.userId}' 已存在`,
    };
  }

  // 加密密码
  const passwordHash = bcrypt.hashSync(input.password, 10);

  // 创建用户 — 新注册用户一律为 guest 角色，由 admin 手动提升
  try {
    const userRecord = createUser({
      userId: input.userId,
      username: input.username,
      passwordHash,
      role: "guest",
      groupName: "guest",
    });

    // 记录操作日志
    logOperation({
      userId: userRecord.user_id,
      action: "register",
      target: "user",
      detail: { username: input.username, role: "guest" },
      ipAddress,
    });

    // 生成 JWT
    const token = generateToken({
      userId: userRecord.user_id,
      username: userRecord.username,
      role: userRecord.role,
      group: userRecord.group_name,
    });

    return {
      success: true,
      message: "注册成功",
      token,
      user: {
        userId: userRecord.user_id,
        username: userRecord.username,
        role: userRecord.role,
        group: userRecord.group_name,
        createdAt: userRecord.created_at,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `注册失败: ${(error as Error).message}`,
    };
  }
}

/**
 * 用户登录
 */
export function login(input: LoginInput, ipAddress?: string): AuthResult {
  if (!input.username || !input.password) {
    return {
      success: false,
      message: "用户名和密码不能为空",
    };
  }

  // 查找用户
  const userRecord = findUserByUsername(input.username);
  if (!userRecord) {
    return {
      success: false,
      message: "用户名或密码错误",
    };
  }

  // 验证密码
  const isPasswordValid = bcrypt.compareSync(input.password, userRecord.password_hash);
  if (!isPasswordValid) {
    return {
      success: false,
      message: "用户名或密码错误",
    };
  }

  // 记录操作日志
  logOperation({
    userId: userRecord.user_id,
    action: "login",
    target: "user",
    detail: { username: input.username },
    ipAddress,
  });

  // 生成 JWT
  const token = generateToken({
    userId: userRecord.user_id,
    username: userRecord.username,
    role: userRecord.role,
    group: userRecord.group_name,
  });

  return {
    success: true,
    message: "登录成功",
    token,
    user: {
      userId: userRecord.user_id,
      username: userRecord.username,
      role: userRecord.role,
      group: userRecord.group_name,
      createdAt: userRecord.created_at,
    },
  };
}

/**
 * 验证 JWT 令牌
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * 从请求头中解析 Bearer Token
 */
export function extractToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }
  return null;
}

/**
 * 生成 JWT 令牌
 */
function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
