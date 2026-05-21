/**
 * 第4步单元测试：userStore — 用户数据访问层 CRUD
 *
 * 测试范围：
 *   - findUserByUserId():    按 userId 查找
 *   - findUserByUsername():   按 username 查找
 *   - getAllUsers():          获取所有用户列表
 *   - createUser():           创建新用户
 *   - updateUser():           更新用户信息（动态字段）
 *   - deleteUser():           删除用户
 *   - getUserCount():         用户计数
 *   - seedDefaultUsers():     种子数据（幂等性）
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import {
  findUserByUserId,
  findUserByUsername,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserCount,
  seedDefaultUsers,
} from "../../backend/src/db/userStore.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";

const TEST_USER_ID = "test_user_crud";
const TEST_USERNAME = "testuser_crud";

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
  // 清理之前测试运行可能遗留的数据
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM operation_logs WHERE user_id LIKE 'test_%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'test_%'").run();
  } catch { /* ignore */ }
});

// 每个测试后清理本文件创建的测试用户
afterEach(() => {
  try {
    const db = getDatabase();
    // 先删操作日志（外键约束），再删用户
    db.prepare("DELETE FROM operation_logs WHERE user_id = ?").run(TEST_USER_ID);
    db.prepare("DELETE FROM operation_logs WHERE user_id = ?").run("test_user_2");
    db.prepare("DELETE FROM users WHERE user_id = ?").run(TEST_USER_ID);
    db.prepare("DELETE FROM users WHERE user_id = ?").run("test_user_2");
  } catch {
    // 忽略清理错误
  }
});

// ============================================================
// 查询测试
// ============================================================

describe("userStore — 查询操作", () => {
  it("findUserByUserId: 找到存在的用户", () => {
    const user = findUserByUserId("admin01");
    assert.ok(user !== undefined);
    assert.strictEqual(user!.user_id, "admin01");
    assert.strictEqual(user!.username, "admin01");
    assert.strictEqual(user!.role, "admin");
    assert.strictEqual(user!.group_name, "admin");
  });

  it("findUserByUserId: 不存在的用户返回 undefined", () => {
    const user = findUserByUserId("nonexistent");
    assert.strictEqual(user, undefined);
  });

  it("findUserByUsername: 找到存在的用户（用于登录）", () => {
    const user = findUserByUsername("leaderA");
    assert.ok(user !== undefined);
    assert.strictEqual(user!.user_id, "leaderA");
    assert.strictEqual(user!.name, "A组组长");
  });

  it("findUserByUsername: 不存在的用户名返回 undefined", () => {
    const user = findUserByUsername("nonexistent_user");
    assert.strictEqual(user, undefined);
  });

  it("getAllUsers: 返回所有用户的公开信息", () => {
    const users = getAllUsers();
    assert.ok(users.length >= 7, `Expected >= 7 users, got ${users.length}`);
    // 验证返回的公开信息不包含 password_hash
    const firstUser = users[0];
    assert.ok("userId" in firstUser);
    assert.ok("username" in firstUser);
    assert.ok("name" in firstUser);
    assert.ok("role" in firstUser);
    assert.ok("group" in firstUser);
    assert.ok(!("password_hash" in firstUser));
  });

  it("getUserCount: 返回正确的用户总数", () => {
    const count = getUserCount();
    assert.ok(count >= 7);
  });
});

// ============================================================
// 创建测试
// ============================================================

describe("userStore — 创建用户", () => {
  it("createUser: 成功创建新用户并返回完整记录", () => {
    const result = createUser({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      passwordHash: "$2a$10$testhash",
      name: "CRUD测试用户",
      role: "member",
      groupName: "groupA",
    });

    assert.ok(result !== undefined);
    assert.strictEqual(result.user_id, TEST_USER_ID);
    assert.strictEqual(result.username, TEST_USERNAME);
    assert.strictEqual(result.name, "CRUD测试用户");
    assert.strictEqual(result.role, "member");
    assert.strictEqual(result.group_name, "groupA");
  });

  it("createUser: 创建后可通过 findUserByUserId 查找到", () => {
    // 先确保存在（可能从上一个测试残留或被清理了）
    try {
      createUser({
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        passwordHash: "$2a$10$testhash",
        name: "CRUD测试用户",
        role: "member",
        groupName: "groupA",
      });
    } catch { /* 已存在 */ }

    const user = findUserByUserId(TEST_USER_ID);
    assert.ok(user !== undefined);
    assert.strictEqual(user!.name, "CRUD测试用户");
  });

  it("createUser: 重复 userId 抛出异常", () => {
    // 第一次创建
    createUser({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      passwordHash: "$2a$10$testhash",
      name: "CRUD测试用户",
      role: "member",
      groupName: "groupA",
    });

    // 第二次创建相同 userId 应抛出 UNIQUE 约束异常
    assert.throws(() => {
      createUser({
        userId: TEST_USER_ID,
        username: "different_username",
        passwordHash: "$2a$10$testhash",
        name: "重复用户",
        role: "member",
        groupName: "groupA",
      });
    });
  });
});

// ============================================================
// 更新测试
// ============================================================

/** 在当前测试中创建测试用户（幂等） */
function ensureTestUser() {
  try {
    createUser({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      passwordHash: "$2a$10$testhash",
      name: "原始名称",
      role: "member",
      groupName: "groupA",
    });
  } catch { /* 已存在 */ }
}

describe("userStore — 更新用户", () => {
  it("updateUser: 更新 name 字段", () => {
    ensureTestUser();
    const result = updateUser(TEST_USER_ID, { name: "新名称" });
    assert.strictEqual(result, true);

    const updated = findUserByUserId(TEST_USER_ID);
    assert.strictEqual(updated!.name, "新名称");
  });

  it("updateUser: 更新 role 字段", () => {
    ensureTestUser();
    const result = updateUser(TEST_USER_ID, { role: "leader" });
    assert.strictEqual(result, true);

    const updated = findUserByUserId(TEST_USER_ID);
    assert.strictEqual(updated!.role, "leader");
  });

  it("updateUser: 更新 groupName 字段", () => {
    ensureTestUser();
    const result = updateUser(TEST_USER_ID, { groupName: "groupB" });
    assert.strictEqual(result, true);

    const updated = findUserByUserId(TEST_USER_ID);
    assert.strictEqual(updated!.group_name, "groupB");
  });

  it("updateUser: 同时更新多个字段", () => {
    ensureTestUser();
    const result = updateUser(TEST_USER_ID, {
      name: "批量更新",
      role: "member",
      groupName: "groupA",
    });
    assert.strictEqual(result, true);

    const updated = findUserByUserId(TEST_USER_ID);
    assert.strictEqual(updated!.name, "批量更新");
    assert.strictEqual(updated!.role, "member");
    assert.strictEqual(updated!.group_name, "groupA");
  });

  it("updateUser: 不存在的用户返回 false", () => {
    const result = updateUser("nonexistent_user", { name: "test" });
    assert.strictEqual(result, false);
  });

  it("updateUser: 空更新字段返回 false", () => {
    ensureTestUser();
    const result = updateUser(TEST_USER_ID, {});
    assert.strictEqual(result, false);
  });
});

// ============================================================
// 删除测试
// ============================================================

describe("userStore — 删除用户", () => {
  it("deleteUser: 成功删除存在的用户", () => {
    // 确保测试用户存在
    try {
      createUser({
        userId: "test_user_2",
        username: "testuser2_crud",
        passwordHash: "$2a$10$testhash",
        name: "待删除用户",
        role: "member",
        groupName: "groupA",
      });
    } catch { /* 已存在 */ }

    const result = deleteUser("test_user_2");
    assert.strictEqual(result, true);

    // 删除后无法查到
    const deleted = findUserByUserId("test_user_2");
    assert.strictEqual(deleted, undefined);
  });

  it("deleteUser: 删除不存在的用户返回 false", () => {
    const result = deleteUser("nonexistent_user");
    assert.strictEqual(result, false);
  });
});
