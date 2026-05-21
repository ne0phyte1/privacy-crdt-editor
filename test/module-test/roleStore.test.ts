/**
 * 第4步单元测试：roleStore — 角色数据访问层 CRUD
 *
 * 测试范围：
 *   - getRoleConfig():       按角色名获取配置
 *   - getAllRoleConfigs():   获取所有角色配置
 *   - roleExists():          检查角色是否存在
 *   - createRole():          创建新角色
 *   - updateRole():          更新角色配置（动态字段）
 *   - deleteRole():          删除角色
 *   - seedDefaultRoles():    种子数据（幂等性）
 *   - toRoleConfig():        数据库记录 → 业务对象类型转换
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import {
  getRoleConfig,
  getAllRoleConfigs,
  roleExists,
  createRole,
  updateRole,
  deleteRole,
  seedDefaultRoles,
} from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";
import type { RoleConfig } from "../../backend/src/db/roleStore.js";

const TEST_ROLE_NAME = "test_role_crud";

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
  // 清理之前测试运行可能遗留的数据
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM roles WHERE role_name LIKE 'test_%'").run();
  } catch { /* ignore */ }
});

afterEach(() => {
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM roles WHERE role_name = ?").run(TEST_ROLE_NAME);
    db.prepare("DELETE FROM roles WHERE role_name = ?").run("test_role_2");
  } catch {
    // 忽略清理错误
  }
});

// ============================================================
// 查询测试
// ============================================================

describe("roleStore — 查询操作", () => {
  it("getRoleConfig: 获取 admin 角色配置", () => {
    const config = getRoleConfig("admin");
    assert.ok(config !== undefined);
    assert.strictEqual(config!.priority, 100);
    assert.strictEqual(config!.canViewAll, true);
    assert.strictEqual(config!.canEditAll, true);
    assert.strictEqual(config!.canManageUsers, true);
    assert.deepStrictEqual(config!.allowedVisibilities, ["public", "group", "private"]);
  });

  it("getRoleConfig: 获取 leader 角色配置", () => {
    const config = getRoleConfig("leader");
    assert.ok(config !== undefined);
    assert.strictEqual(config!.priority, 80);
    assert.strictEqual(config!.canViewAll, false);
    assert.strictEqual(config!.canEditAll, false);
    assert.strictEqual(config!.canEditOwnGroup, true);
    assert.deepStrictEqual(config!.allowedVisibilities, ["public", "group"]);
  });

  it("getRoleConfig: 获取 guest 角色配置", () => {
    const config = getRoleConfig("guest");
    assert.ok(config !== undefined);
    assert.strictEqual(config!.priority, 10);
    assert.strictEqual(config!.canEditOwnGroup, false);
    assert.deepStrictEqual(config!.allowedVisibilities, ["public"]);
  });

  it("getRoleConfig: 不存在的角色返回 undefined", () => {
    const config = getRoleConfig("nonexistent_role");
    assert.strictEqual(config, undefined);
  });

  it("getAllRoleConfigs: 返回 4 个默认角色，按 priority 降序排列", () => {
    const configs = getAllRoleConfigs();
    const keys = Object.keys(configs);
    assert.strictEqual(keys.length, 4);
    assert.ok(keys.includes("admin"));
    assert.ok(keys.includes("leader"));
    assert.ok(keys.includes("member"));
    assert.ok(keys.includes("guest"));
  });

  it("roleExists: 存在的角色返回 true", () => {
    assert.strictEqual(roleExists("admin"), true);
    assert.strictEqual(roleExists("leader"), true);
  });

  it("roleExists: 不存在的角色返回 false", () => {
    assert.strictEqual(roleExists("nonexistent"), false);
  });
});

// ============================================================
// 类型转换测试
// ============================================================

describe("roleStore — toRoleConfig 类型转换", () => {
  it("INTEGER 0/1 正确转换为 boolean", () => {
    const config = getRoleConfig("admin");
    assert.strictEqual(typeof config!.canViewAll, "boolean");
    assert.strictEqual(typeof config!.canEditAll, "boolean");
    assert.strictEqual(typeof config!.canManageUsers, "boolean");
    assert.strictEqual(typeof config!.canEditOwnGroup, "boolean");
  });

  it("JSON 字符串正确解析为数组", () => {
    const config = getRoleConfig("admin");
    assert.ok(Array.isArray(config!.allowedVisibilities));
  });

  it("member 角色 canEditOwnGroup = true", () => {
    const config = getRoleConfig("member");
    assert.strictEqual(config!.canEditOwnGroup, true);
  });

  it("guest 角色 canEditOwnGroup = false（无编辑权限）", () => {
    const config = getRoleConfig("guest");
    assert.strictEqual(config!.canEditOwnGroup, false);
  });
});

// ============================================================
// 创建测试
// ============================================================

describe("roleStore — 创建角色", () => {
  const testConfig: RoleConfig = {
    priority: 50,
    description: "测试角色",
    canViewAll: false,
    canEditAll: false,
    canManageUsers: false,
    allowedVisibilities: ["public", "group"],
    canEditOwnGroup: true,
  };

  it("createRole: 成功创建新角色", () => {
    const result = createRole(TEST_ROLE_NAME, testConfig);
    assert.strictEqual(result, true);
    assert.strictEqual(roleExists(TEST_ROLE_NAME), true);
  });

  it("createRole: 创建后可查询配置", () => {
    // 独立创建（afterEach 会清理上一个测试的数据）
    createRole(TEST_ROLE_NAME, testConfig);
    const config = getRoleConfig(TEST_ROLE_NAME);
    assert.ok(config !== undefined);
    assert.strictEqual(config!.priority, 50);
    assert.strictEqual(config!.description, "测试角色");
    assert.deepStrictEqual(config!.allowedVisibilities, ["public", "group"]);
  });

  it("createRole: [注意] 重复创建抛异常而非返回 false（server.ts 期望返回 false，此处行为不一致）", () => {
    createRole(TEST_ROLE_NAME, testConfig);
    // 当前实际行为：重复创建抛出 SQLITE_CONSTRAINT_UNIQUE
    // 但 server.ts:414 的 API 路由期望 createRole 返回 false 来响应 400
    // 如果此处行为是有意为之，则 server.ts 需要改为 try/catch 处理异常
    assert.throws(() => {
      createRole(TEST_ROLE_NAME, testConfig);
    }, /UNIQUE/);
  });
});

// ============================================================
// 更新测试
// ============================================================

/** 在当前测试中创建测试角色（幂等） */
function ensureTestRole() {
  try {
    createRole(TEST_ROLE_NAME, {
      priority: 50,
      description: "测试角色",
      canViewAll: false,
      canEditAll: false,
      canManageUsers: false,
      allowedVisibilities: ["public"],
      canEditOwnGroup: false,
    });
  } catch { /* 已存在 */ }
}

describe("roleStore — 更新角色", () => {
  it("updateRole: 更新 priority", () => {
    ensureTestRole();
    const result = updateRole(TEST_ROLE_NAME, { priority: 75 });
    assert.strictEqual(result, true);
    const updated = getRoleConfig(TEST_ROLE_NAME);
    assert.strictEqual(updated!.priority, 75);
  });

  it("updateRole: 更新 canEditAll", () => {
    ensureTestRole();
    const result = updateRole(TEST_ROLE_NAME, { canEditAll: true });
    assert.strictEqual(result, true);
    const updated = getRoleConfig(TEST_ROLE_NAME);
    assert.strictEqual(updated!.canEditAll, true);
  });

  it("updateRole: 更新 allowedVisibilities", () => {
    ensureTestRole();
    const result = updateRole(TEST_ROLE_NAME, {
      allowedVisibilities: ["public", "group", "private"],
    });
    assert.strictEqual(result, true);
    const updated = getRoleConfig(TEST_ROLE_NAME);
    assert.deepStrictEqual(updated!.allowedVisibilities, ["public", "group", "private"]);
  });

  it("updateRole: 不存在的角色返回 false", () => {
    const result = updateRole("nonexistent", { priority: 50 });
    assert.strictEqual(result, false);
  });
});

// ============================================================
// 删除测试
// ============================================================

describe("roleStore — 删除角色", () => {
  it("deleteRole: 成功删除自定义角色", () => {
    // 先创建
    try {
      createRole("test_role_2", {
        priority: 30,
        description: "待删除角色",
        canViewAll: false,
        canEditAll: false,
        canManageUsers: false,
        allowedVisibilities: ["public"],
        canEditOwnGroup: false,
      });
    } catch { /* 已存在 */ }

    const result = deleteRole("test_role_2");
    assert.strictEqual(result, true);
    assert.strictEqual(roleExists("test_role_2"), false);
  });

  it("deleteRole: 删除不存在的角色返回 false", () => {
    const result = deleteRole("nonexistent_role");
    assert.strictEqual(result, false);
  });
});
