/**
 * 第4步单元测试：authService — 用户认证服务
 *
 * 测试范围：
 *   - register():       用户注册（含字段验证、唯一性检查）
 *   - login():          用户登录（含密码验证）
 *   - verifyToken():    JWT 令牌验证
 *   - extractToken():   从请求头解析 Bearer Token
 *   - generateToken():  生成 JWT（通过 register/login 间接测试）
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";
import {
  register,
  login,
  verifyToken,
  extractToken,
} from "../../backend/src/auth/authService.js";

const TEST_USER_ID = "test_auth_user";
const TEST_USERNAME = "test_auth_user";

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

afterEach(() => {
  try {
    const db = getDatabase();
    // 先删操作日志（外键约束），再删用户
    db.prepare("DELETE FROM operation_logs WHERE user_id = ?").run(TEST_USER_ID);
    db.prepare("DELETE FROM operation_logs WHERE user_id = ?").run("test_auth_2");
    db.prepare("DELETE FROM users WHERE user_id = ?").run(TEST_USER_ID);
    db.prepare("DELETE FROM users WHERE user_id = ?").run("test_auth_2");
  } catch {
    // 忽略清理错误
  }
});

// ============================================================
// register 测试
// ============================================================

describe("register — 用户注册", () => {
  it("成功注册新用户并返回 JWT + 用户信息", () => {
    const result = register({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      password: "test123456",
      name: "认证测试用户",
      role: "member",
      groupName: "groupA",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message, "注册成功");
    assert.ok(result.token, "应返回 JWT token");
    assert.ok(result.user, "应返回用户信息");
    assert.strictEqual(result.user!.userId, TEST_USER_ID);
    assert.strictEqual(result.user!.username, TEST_USERNAME);
    assert.strictEqual(result.user!.name, "认证测试用户");
    assert.strictEqual(result.user!.role, "member");
    assert.strictEqual(result.user!.group, "groupA");
    // password_hash 不应返回给前端
    assert.ok(!("password_hash" in (result.user as any)));
  });

  it("缺少必填字段时返回失败", () => {
    const result = register({
      userId: "u1",
      username: "",
      password: "test123",
      name: "",
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("必填"));
  });

  it("密码长度不足 6 位时返回失败", () => {
    const result = register({
      userId: "u2",
      username: "shortpw",
      password: "12345",
      name: "测试",
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("密码长度"));
  });

  it("重复用户名被拒绝", () => {
    // 先注册
    register({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      password: "test123456",
      name: "第一次注册",
    });

    // 用相同用户名再次注册
    const result = register({
      userId: "different_id",
      username: TEST_USERNAME,
      password: "test123456",
      name: "重复用户名",
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("已被注册"));
  });

  it("重复 userId 被拒绝", () => {
    // 先用新用户名注册一个 userId
    register({
      userId: "test_auth_2",
      username: "test_auth_user2",
      password: "test123456",
      name: "测试2",
    });

    const result = register({
      userId: "test_auth_2",
      username: "different_username",
      password: "test123456",
      name: "重复userId",
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("已存在"));
  });

  it("不传 role 和 groupName 时使用默认值 member / default", () => {
    const result = register({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      password: "test123456",
      name: "默认值测试",
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user!.role, "member");
    assert.strictEqual(result.user!.group, "default");
  });
});

// ============================================================
// login 测试
// ============================================================

describe("login — 用户登录", () => {
  before(() => {
    // 确保测试用户存在
    const existing = register({
      userId: TEST_USER_ID,
      username: TEST_USERNAME,
      password: "test123456",
      name: "登录测试用户",
    });
    if (!existing.success && !existing.message.includes("已被注册")) {
      // 已存在则忽略
    }
  });

  it("正确凭据登录成功并返回 JWT", () => {
    const result = login({
      username: "admin01",
      password: "password123",
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message, "登录成功");
    assert.ok(result.token);
    assert.strictEqual(result.user!.username, "admin01");
    assert.strictEqual(result.user!.role, "admin");
  });

  it("错误密码登录失败（返回 401）", () => {
    const result = login({
      username: "admin01",
      password: "wrongpassword",
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.message, "用户名或密码错误");
  });

  it("不存在的用户登录失败", () => {
    const result = login({
      username: "nonexistent_user",
      password: "password123",
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.message, "用户名或密码错误");
  });

  it("空用户名和密码返回失败", () => {
    const result = login({ username: "", password: "" });
    assert.strictEqual(result.success, false);
  });

  it("登录后返回的 token 可以验证成功", () => {
    const result = login({
      username: "admin01",
      password: "password123",
    });
    assert.strictEqual(result.success, true);
    const payload = verifyToken(result.token!);
    assert.ok(payload !== null);
    assert.strictEqual(payload!.userId, "admin01");
    assert.strictEqual(payload!.username, "admin01");
    assert.strictEqual(payload!.role, "admin");
    assert.strictEqual(payload!.group, "admin");
  });
});

// ============================================================
// verifyToken 测试
// ============================================================

describe("verifyToken — JWT 令牌验证", () => {
  it("有效 token 返回 payload", () => {
    const loginResult = login({ username: "admin01", password: "password123" });
    const payload = verifyToken(loginResult.token!);
    assert.ok(payload !== null);
    assert.strictEqual(payload!.userId, "admin01");
  });

  it("无效 token 返回 null", () => {
    const payload = verifyToken("invalid.token.here");
    assert.strictEqual(payload, null);
  });

  it("空字符串返回 null", () => {
    const payload = verifyToken("");
    assert.strictEqual(payload, null);
  });
});

// ============================================================
// extractToken 测试
// ============================================================

describe("extractToken — 从请求头解析 Bearer Token", () => {
  it("正确解析 Bearer Token", () => {
    const token = extractToken("Bearer eyJhbGciOiJIUzI1NiIs...");
    assert.strictEqual(token, "eyJhbGciOiJIUzI1NiIs...");
  });

  it("无 Authorization 头返回 null", () => {
    assert.strictEqual(extractToken(undefined), null);
  });

  it("非 Bearer 格式返回 null", () => {
    assert.strictEqual(extractToken("Basic xyz"), null);
  });

  it("空字符串返回 null", () => {
    assert.strictEqual(extractToken(""), null);
  });
});

// ============================================================
// 集成测试：注册 → 登录 → 验证
// ============================================================

describe("authService — 全流程集成", () => {
  it("注册 → 用注册密码登录 → 验证 token", () => {
    const uniqueId = "test_flow_" + Date.now();
    const uniqueUser = "test_flow_user_" + Date.now();

    // 1. 注册
    const regResult = register({
      userId: uniqueId,
      username: uniqueUser,
      password: "flowtest123",
      name: "流程测试",
      role: "member",
      groupName: "groupA",
    });
    assert.strictEqual(regResult.success, true);

    // 2. 登录
    const loginResult = login({
      username: uniqueUser,
      password: "flowtest123",
    });
    assert.strictEqual(loginResult.success, true);
    assert.strictEqual(loginResult.user!.userId, uniqueId);

    // 3. 验证 token
    const payload = verifyToken(loginResult.token!);
    assert.ok(payload !== null);
    assert.strictEqual(payload!.userId, uniqueId);

    // 清理
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM users WHERE user_id = ?").run(uniqueId);
    } catch { /* ignore */ }
  });
});
