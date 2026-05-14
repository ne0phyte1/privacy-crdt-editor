import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ============================================================
// SQLite 数据库初始化模块
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/privacy-crdt.db");

let dbInstance: Database.Database | null = null;

/**
 * 获取数据库单例实例
 */
export function getDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  // 确保 data 目录存在
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  dbInstance = new Database(DB_PATH);

  // 启用 WAL 模式以获得更好的并发性能
  dbInstance.pragma("journal_mode = WAL");
  // 启用外键约束
  dbInstance.pragma("foreign_keys = ON");

  return dbInstance;
}

/**
 * 初始化数据库表结构
 */
export function initializeDatabase(): void {
  const db = getDatabase();

  db.exec(`
    -- ============================================================
    -- 用户表：存储用户账号和密码（密码使用 bcrypt 加密）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       TEXT    NOT NULL UNIQUE,              -- 用户标识（如 "admin01"）
      username      TEXT    NOT NULL UNIQUE,              -- 登录用户名
      password_hash TEXT    NOT NULL,                     -- bcrypt 加密后的密码
      name          TEXT    NOT NULL,                     -- 显示名称
      role          TEXT    NOT NULL DEFAULT 'member',    -- 角色（admin/leader/member/guest）
      group_name    TEXT    NOT NULL DEFAULT 'guest',     -- 所属组
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 角色表：存储角色配置
    -- ============================================================
    CREATE TABLE IF NOT EXISTS roles (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      role_name         TEXT    NOT NULL UNIQUE,           -- 角色名（admin/leader/member/guest）
      priority          INTEGER NOT NULL DEFAULT 0,
      description       TEXT    NOT NULL DEFAULT '',
      can_view_all      INTEGER NOT NULL DEFAULT 0,       -- 0=false, 1=true
      can_edit_all      INTEGER NOT NULL DEFAULT 0,
      can_manage_users  INTEGER NOT NULL DEFAULT 0,
      allowed_visibilities TEXT NOT NULL DEFAULT '["public"]',  -- JSON 数组
      can_edit_own_group  INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- 操作日志表：记录所有用户操作
    -- ============================================================
    CREATE TABLE IF NOT EXISTS operation_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT    NOT NULL,
      action      TEXT    NOT NULL,                      -- register/login/insert/update/delete
      target      TEXT,                                  -- 操作目标描述
      detail      TEXT,                                  -- 详细数据（JSON）
      ip_address  TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );
  `);

  console.log("[DB] 数据库表结构初始化完成");
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.log("[DB] 数据库连接已关闭");
  }
}
