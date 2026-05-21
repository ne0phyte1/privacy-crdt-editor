/**
 * 第4步单元测试：database — SQLite 数据库初始化
 *
 * 测试范围：
 *   - initializeDatabase():  创建表结构
 *   - getDatabase():         数据库单例获取
 *   - 表结构验证：users / roles / operation_logs 三张表
 *   - closeDatabase():       关闭数据库连接
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { initializeDatabase, getDatabase, closeDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";

// ============================================================
// 测试前准备
// ============================================================

before(() => {
  // 先关闭已有的连接（如果有），然后重新初始化
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
});

// ============================================================
// 数据库连接测试
// ============================================================

describe("getDatabase — 数据库单例", () => {
  it("返回 Database 对象", () => {
    const db = getDatabase();
    assert.ok(db !== null);
    assert.ok(db !== undefined);
  });

  it("多次调用返回同一实例（单例）", () => {
    const db1 = getDatabase();
    const db2 = getDatabase();
    assert.strictEqual(db1, db2);
  });

  it("数据库文件存在", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dbPath = path.resolve(__dirname, "../../backend/data/privacy-crdt.db");
    assert.ok(fs.existsSync(dbPath));
  });
});

// ============================================================
// 表结构测试
// ============================================================

describe("initializeDatabase — 表结构验证", () => {
  it("users 表存在", () => {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get() as { name: string } | undefined;
    assert.ok(row !== undefined);
    assert.strictEqual(row!.name, "users");
  });

  it("roles 表存在", () => {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='roles'"
    ).get() as { name: string } | undefined;
    assert.ok(row !== undefined);
  });

  it("operation_logs 表存在", () => {
    const db = getDatabase();
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='operation_logs'"
    ).get() as { name: string } | undefined;
    assert.ok(row !== undefined);
  });

  it("users 表包含所有必要字段", () => {
    const db = getDatabase();
    const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    assert.ok(colNames.includes("id"));
    assert.ok(colNames.includes("user_id"));
    assert.ok(colNames.includes("username"));
    assert.ok(colNames.includes("password_hash"));
    assert.ok(colNames.includes("name"));
    assert.ok(colNames.includes("role"));
    assert.ok(colNames.includes("group_name"));
    assert.ok(colNames.includes("created_at"));
    assert.ok(colNames.includes("updated_at"));
  });

  it("roles 表包含所有必要字段", () => {
    const db = getDatabase();
    const columns = db.prepare("PRAGMA table_info(roles)").all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    assert.ok(colNames.includes("role_name"));
    assert.ok(colNames.includes("priority"));
    assert.ok(colNames.includes("can_view_all"));
    assert.ok(colNames.includes("can_edit_all"));
    assert.ok(colNames.includes("can_manage_users"));
    assert.ok(colNames.includes("allowed_visibilities"));
    assert.ok(colNames.includes("can_edit_own_group"));
  });

  it("operation_logs 表包含所有必要字段", () => {
    const db = getDatabase();
    const columns = db.prepare("PRAGMA table_info(operation_logs)").all() as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);
    assert.ok(colNames.includes("user_id"));
    assert.ok(colNames.includes("action"));
    assert.ok(colNames.includes("target"));
    assert.ok(colNames.includes("detail"));
    assert.ok(colNames.includes("ip_address"));
    assert.ok(colNames.includes("created_at"));
  });

  it("users 表 user_id 有 UNIQUE 约束", () => {
    const db = getDatabase();
    // 尝试插入重复 user_id 应该抛出异常
    assert.throws(() => {
      db.prepare(
        `INSERT INTO users (user_id, username, password_hash, name, role, group_name)
         VALUES ('admin01', 'duplicate_test', 'hash', 'test', 'member', 'test')`
      ).run();
    });
  });

  it("WAL 模式已启用", () => {
    const db = getDatabase();
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.strictEqual(row.journal_mode.toLowerCase(), "wal");
  });
});

// ============================================================
// 种子数据测试
// ============================================================

describe("种子数据验证", () => {
  it("users 表中有 7 个默认用户", () => {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
    assert.ok(row.count >= 7, `Expected >= 7 seed users, got ${row.count}`);
  });

  it("默认用户列表包含 admin01", () => {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM users WHERE user_id = 'admin01'").get() as any;
    assert.ok(row !== undefined);
    assert.strictEqual(row.role, "admin");
    assert.strictEqual(row.group_name, "admin");
  });

  it("roles 表中有 4 个默认角色", () => {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM roles").get() as { count: number };
    assert.strictEqual(row.count, 4);
  });

  it("默认角色包含 admin / leader / member / guest", () => {
    const db = getDatabase();
    const rows = db.prepare("SELECT role_name FROM roles").all() as Array<{ role_name: string }>;
    const names = rows.map((r) => r.role_name).sort();
    assert.deepStrictEqual(names, ["admin", "guest", "leader", "member"]);
  });

  it("重复调用 seedDefaultUsers 不会插入重复数据", () => {
    const db = getDatabase();
    const before = (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
    seedDefaultUsers();
    const after = (db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count;
    assert.strictEqual(after, before, "重复调用不应改变用户数量");
  });

  it("重复调用 seedDefaultRoles 不会插入重复数据", () => {
    seedDefaultRoles();
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as count FROM roles").get() as { count: number };
    assert.strictEqual(row.count, 4);
  });
});
