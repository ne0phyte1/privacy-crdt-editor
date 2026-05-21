/**
 * 第4步单元测试：operationLogStore — 操作日志存储
 *
 * 测试范围：
 *   - logOperation():       记录操作日志
 *   - getOperationLogs():   分页查询日志（含按 userId 筛选）
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers, createUser } from "../../backend/src/db/userStore.js";
import { logOperation, getOperationLogs } from "../../backend/src/db/operationLogStore.js";

/** 在 users 表中创建测试用户（满足 operation_logs 的外键约束） */
function ensureTestUsers() {
  const testUsers = [
    { userId: "test_log_user", username: "test_log_user", name: "日志测试用户", role: "member", groupName: "test" },
    { userId: "test_log_user2", username: "test_log_user2", name: "日志测试用户2", role: "member", groupName: "test" },
  ];
  for (const u of testUsers) {
    try {
      createUser({
        userId: u.userId, username: u.username,
        passwordHash: "$2a$10$testhash", name: u.name,
        role: u.role, groupName: u.groupName,
      });
    } catch { /* 已存在则忽略 */ }
  }
}

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
  ensureTestUsers();
  // 清理之前测试运行可能遗留的日志
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM operation_logs WHERE user_id LIKE 'test_%'").run();
  } catch { /* ignore */ }
});

// ============================================================
// logOperation 测试
// ============================================================

describe("logOperation — 记录操作日志", () => {
  // 每个测试后清理日志，避免影响同 describe 内其他测试
  afterEach(() => {
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM operation_logs WHERE user_id IN ('test_log_user', 'test_log_user2')").run();
    } catch { /* ignore */ }
  });

  it("成功记录一条日志", () => {
    assert.doesNotThrow(() => {
      logOperation({
        userId: "test_log_user",
        action: "test_action",
        target: "test_target",
        detail: { key: "value" },
        ipAddress: "127.0.0.1",
      });
    });
  });

  it("不传 ipAddress 也能记录", () => {
    assert.doesNotThrow(() => {
      logOperation({
        userId: "test_log_user",
        action: "no_ip_test",
        target: "node:test",
      });
    });
  });

  it("不传 detail 也能记录", () => {
    assert.doesNotThrow(() => {
      logOperation({
        userId: "test_log_user",
        action: "no_detail_test",
      });
    });
  });

  it("记录后可在数据库中查到", () => {
    logOperation({
      userId: "test_log_user",
      action: "insert",
      target: "node:test_node_1",
      detail: { title: "测试" },
      ipAddress: "::1",
    });

    const db = getDatabase();
    const row = db.prepare(
      "SELECT * FROM operation_logs WHERE user_id = ? AND action = ? ORDER BY id DESC LIMIT 1"
    ).get("test_log_user", "insert") as any;

    assert.ok(row !== undefined);
    assert.strictEqual(row.user_id, "test_log_user");
    assert.strictEqual(row.action, "insert");
    assert.strictEqual(row.target, "node:test_node_1");
    assert.strictEqual(row.ip_address, "::1");
    const detail = JSON.parse(row.detail);
    assert.strictEqual(detail.title, "测试");
  });
});

// ============================================================
// getOperationLogs 测试
// ============================================================

describe("getOperationLogs — 分页查询日志", () => {
  before(() => {
    // 先清理可能残留的测试日志
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM operation_logs WHERE user_id IN ('test_log_user', 'test_log_user2')").run();
    } catch { /* ignore */ }
    // 插入多条测试日志
    for (let i = 1; i <= 5; i++) {
      logOperation({
        userId: "test_log_user",
        action: `test_action_${i}`,
        target: `node:test_${i}`,
      });
    }
    logOperation({
      userId: "test_log_user2",
      action: "other_user_action",
      target: "node:other",
    });
  });

  after(() => {
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM operation_logs WHERE user_id IN ('test_log_user', 'test_log_user2')").run();
    } catch { /* ignore */ }
  });

  it("默认分页查询（page=1, pageSize=50）返回日志列表", () => {
    const result = getOperationLogs();
    assert.ok(result.logs.length > 0);
    assert.ok(result.total >= 6);
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.pageSize, 50);
  });

  it("按 userId 筛选", () => {
    const result = getOperationLogs(1, 50, "test_log_user");
    assert.ok(result.total >= 5);
    for (const log of result.logs) {
      assert.strictEqual(log.user_id, "test_log_user");
    }
  });

  it("分页参数 pageSize 生效", () => {
    const result = getOperationLogs(1, 2);
    assert.ok(result.logs.length <= 2);
    assert.strictEqual(result.pageSize, 2);
  });

  it("分页参数 page 生效（第二页数据不同于第一页）", () => {
    const page1 = getOperationLogs(1, 2);
    const page2 = getOperationLogs(2, 2);
    if (page1.total > 2) {
      assert.ok(page2.logs.length > 0);
      assert.notStrictEqual(page1.logs[0].id, page2.logs[0].id);
    }
  });

  it("不存在的 userId 返回空日志", () => {
    const result = getOperationLogs(1, 50, "nonexistent_user");
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.logs.length, 0);
  });

  it("日志按 id 降序排列（最新在前）", () => {
    const result = getOperationLogs(1, 50, "test_log_user");
    if (result.logs.length >= 2) {
      assert.ok(result.logs[0].id > result.logs[1].id);
    }
  });
});
