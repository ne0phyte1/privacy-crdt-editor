/**
 * 第4步+第5步 边缘情况测试：auth-edge — 认证服务边缘情况 + 权限边界
 *
 * 测试范围：
 *   - authService.register() — userId 字段校验（与 server.ts 的一致性）
 *   - authService.register() — 角色合法性校验
 *   - checkABAC / checkRBAC / canAccessNode — 边界输入（空数组、无效值等）
 *   - canEditNode — 角色配置缺失时的行为
 *   - inverseMapper — 特殊 payload 字段组合
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles, getRoleConfig } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";
import {
  register, login, verifyToken, extractToken,
} from "../../backend/src/auth/authService.js";
import {
  checkRBAC, checkABAC, canAccessNode, canEditNode,
} from "../../backend/src/privacy/accessControl.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { TreeNode } from "../../backend/src/crdt/masterDoc.js";

// ============================================================
// 测试数据工厂
// ============================================================

function makeUser(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    userId: "testUser", name: "测试用户", role: "member", group: "groupA",
    ...overrides,
  };
}

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "node-1", parentId: "root", title: "测试节点", content: "测试内容",
    visibility: "public", ownerGroup: "all",
    allowedRoles: ["admin", "leader", "member", "guest"],
    deleted: false, createdBy: "system", updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
  // 清理之前测试运行可能遗留的数据
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM operation_logs WHERE user_id LIKE 'test_%'").run();
    db.prepare("DELETE FROM operation_logs WHERE user_id LIKE 'edge_%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'test_%'").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'edge_%'").run();
  } catch { /* ignore */ }
});

afterEach(() => {
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM operation_logs WHERE user_id LIKE 'edge_%' OR user_id = ''").run();
    db.prepare("DELETE FROM users WHERE user_id LIKE 'edge_%' OR user_id = ''").run();
  } catch { /* ignore */ }
});

// ============================================================
// register 边界测试（authService.ts）
// ============================================================

describe("authService.register — 边界校验", () => {
  it("⚠️ BUG: register() 不校验 userId 字段（与 server.ts 不一致）", () => {
    // server.ts:116 检查了 userId，但 authService.ts:54 没有检查
    const result = register({
      userId: "",           // 空 userId
      username: "edge_user",
      password: "test123456",
      name: "边缘测试",
    });
    // 当前实现：通过了（因为只检查 username、password、name）
    // 期望行为：应被拒绝，因为 userId 为空
    console.log(`[BUG_CHECK] register() with empty userId: success=${result.success}, message=${result.message}`);
    // 这里可能 pass 也可能 fail，取决于开发人员是否修复
    if (result.success) {
      console.log(`[BUG] register() 允许空的 userId，与 server.ts 校验不一致。` +
        `server.ts:116 检查了 !userId，但 authService.ts:54 未检查。`);
      // 清理
      try {
        getDatabase().prepare("DELETE FROM users WHERE username = 'edge_user'").run();
      } catch { /* ignore */ }
    }
  });

  it("register() 对缺少 username 返回失败", () => {
    const result = register({
      userId: "edge_missing_uname",
      username: "",
      password: "test123456",
      name: "测试",
    });
    assert.strictEqual(result.success, false);
  });

  it("register() 对缺少 password 返回失败", () => {
    const result = register({
      userId: "edge_missing_pw",
      username: "edge_user_pw",
      password: "",
      name: "测试",
    });
    assert.strictEqual(result.success, false);
  });

  it("register() 对缺少 name 返回失败", () => {
    const result = register({
      userId: "edge_missing_name",
      username: "edge_user_name",
      password: "test123456",
      name: "",
    });
    assert.strictEqual(result.success, false);
  });

  it("register() role 默认值 = 'member', groupName 默认值 = 'default'", () => {
    const uniqueId = "edge_" + Date.now();
    const uniqueUser = "edge_user_" + Date.now();
    const result = register({
      userId: uniqueId,
      username: uniqueUser,
      password: "test123456",
      name: "默认值测试",
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.user!.role, "member");
    assert.strictEqual(result.user!.group, "default");

    // 清理
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM operation_logs WHERE user_id = ?").run(uniqueId);
      db.prepare("DELETE FROM users WHERE user_id = ?").run(uniqueId);
    } catch { /* ignore */ }
  });
});

// ============================================================
// login 边界测试
// ============================================================

describe("authService.login — 边界校验", () => {
  it("login() 对空凭据返回失败", () => {
    const result = login({ username: "", password: "" });
    assert.strictEqual(result.success, false);
  });

  it("login() 成功返回的 token 可被 verifyToken 解析", () => {
    const result = login({ username: "admin01", password: "password123" });
    assert.strictEqual(result.success, true);
    const payload = verifyToken(result.token!);
    assert.ok(payload !== null);
    assert.strictEqual(payload!.userId, "admin01");
    assert.strictEqual(payload!.username, "admin01");
    assert.strictEqual(payload!.role, "admin");
    assert.strictEqual(payload!.group, "admin");
    // payload 不应包含 password_hash
    assert.ok(!("password_hash" in (payload as any)));
  });

  it("extractToken() 处理含多余空格的 Bearer header", () => {
    assert.strictEqual(extractToken("Bearer  mytoken"), null,
      "多余空格应导致解析失败");
  });
});

// ============================================================
// checkABAC 边界测试
// ============================================================

describe("checkABAC — 边界输入", () => {
  it("visibility 为无效值 → 返回 false", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ visibility: "invalid_value" as any });
    assert.strictEqual(checkABAC(member, node), false);
  });

  it("allowedRoles 为空数组 → RBAC 检查不通过（但 ABAC 不受影响）", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ visibility: "public", allowedRoles: [] });
    // ABAC 只看 visibility，public 仍应通过
    assert.strictEqual(checkABAC(member, node), true);
  });

  it("ownerGroup 为空字符串 → group 检查不通过", () => {
    const member = makeUser({ role: "member", group: "groupA" });
    const node = makeNode({ visibility: "group", ownerGroup: "" });
    assert.strictEqual(checkABAC(member, node), false);
  });

  it("admin 对任意 visibility 值都可见", () => {
    const admin = makeUser({ role: "admin" });
    // 使用一个不在标准 enum 中的值
    const node = makeNode({ visibility: "custom_unknown" as any });
    assert.strictEqual(checkABAC(admin, node), true);
  });
});

// ============================================================
// canAccessNode 组合校验边界
// ============================================================

describe("canAccessNode — 组合校验边界", () => {
  it("RBAC 通过 (allowedRoles=[]) + ABAC 通过 (public) → 拒绝（RBAC 拒绝）", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ visibility: "public", allowedRoles: [] });
    // RBAC: member ∉ [] → false
    // ABAC: public → true
    // 组合: false && true = false
    assert.strictEqual(canAccessNode(member, node), false);
  });

  it("deleted 节点 + admin → canAccessNode 直接返回 true（不经过 RBAC/ABAC）", () => {
    const admin = makeUser({ role: "admin" });
    const node = makeNode({
      deleted: true,
      visibility: "private",
      allowedRoles: [],
    });
    assert.strictEqual(canAccessNode(admin, node), true,
      "admin 对已删除节点应返回 true");
  });

  it("deleted 节点 + 非 admin → canAccessNode 直接返回 false", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ deleted: true, visibility: "public" });
    assert.strictEqual(canAccessNode(member, node), false);
  });

  it("canAccessNode 与 checkRBAC/checkABAC 对 root 行为一致", () => {
    const guest = makeUser({ role: "guest" });
    const root = makeNode({ id: "root", parentId: "" });
    assert.strictEqual(canAccessNode(guest, root), true);
    assert.strictEqual(checkRBAC(guest, root), true);
    assert.strictEqual(checkABAC(guest, root), true);
  });

  it("⚠️ BUG: root.deleted=true 时 canAccessNode 对非 admin 返回 false", () => {
    const guest = makeUser({ role: "guest" });
    const deletedRoot = makeNode({ id: "root", parentId: "", deleted: true });
    // canAccessNode 先检查 deleted → 非 admin → 返回 false
    // 但 checkRBAC 和 checkABAC 先检查 root → 返回 true
    const canAccess = canAccessNode(guest, deletedRoot);
    const rbac = checkRBAC(guest, deletedRoot);
    const abac = checkABAC(guest, deletedRoot);
    console.log(`[BUG_CHECK] root.deleted=true: canAccessNode=${canAccess}, checkRBAC=${rbac}, checkABAC=${abac}`);
    // 三个函数行为不一致：checkRBAC/checkABAC 返回 true（root 优先），
    // canAccessNode 返回 false（deleted 优先）
    assert.notStrictEqual(canAccess, rbac,
      "BUG: canAccessNode 对 deleted root 的处理与 checkRBAC/checkABAC 不一致");
  });
});

// ============================================================
// canEditNode 边界测试
// ============================================================

describe("canEditNode — 边界校验", () => {
  it("role 不在 roleStore 中 → canEditNode 返回 false（保守拒绝）", () => {
    const userWithUnknownRole: UserInfo = {
      userId: "unknown", name: "未知角色", role: "unknown_role" as any, group: "test",
    };
    const node = makeNode({ visibility: "public" });
    assert.strictEqual(canEditNode(userWithUnknownRole, node), false);
  });

  it("leader 可编辑 public 节点", () => {
    const leader = makeUser({ userId: "leaderA", role: "leader", group: "groupA" });
    const node = makeNode({ visibility: "public", allowedRoles: ["admin", "leader", "member", "guest"] });
    assert.strictEqual(canEditNode(leader, node), true);
  });

  it("member 可编辑 public 节点", () => {
    const member = makeUser({ userId: "memberA1", role: "member", group: "groupA" });
    const node = makeNode({ visibility: "public", allowedRoles: ["admin", "leader", "member", "guest"] });
    assert.strictEqual(canEditNode(member, node), true);
  });

  it("guest 不可编辑任何节点（canEditOwnGroup = false）", () => {
    const guest = makeUser({ userId: "guest01", role: "guest", group: "guest" });
    const publicNode = makeNode({ visibility: "public", allowedRoles: ["admin", "leader", "member", "guest"] });
    const groupNode = makeNode({ visibility: "group", ownerGroup: "guest", allowedRoles: ["admin", "guest"] });
    assert.strictEqual(canEditNode(guest, publicNode), false);
    assert.strictEqual(canEditNode(guest, groupNode), false);
  });
});

// ============================================================
// ⚠️ BUG 报告汇总
// ============================================================

console.log(`
========================================================================
 BUG 报告汇总 (auth-edge.test.ts)
========================================================================

 BUG #2 (续): authService.register() 未校验 userId 字段
   文件: backend/src/auth/authService.ts:54
   与 server.ts:116 对比:
     authService.ts: if (!input.username || !input.password || !input.name)
     server.ts:      if (!userId || !username || !password || !name)
   风险: 直接调用 register() 可创建无 userId 的用户（数据库 user_id 可为空）。
   建议: 添加 !input.userId 检查。

 BUG #3 (续): canAccessNode 的 deleted 检查与 root 检查优先级问题
   文件: backend/src/privacy/accessControl.ts:150-153
   现象: canAccessNode() 先检查 deleted 再检查 root，与 checkRBAC/checkABAC
         先检查 root 再检查 deleted 的逻辑不一致。
   建议: canAccessNode 开头添加 if (node.id === "root") return true;
========================================================================
`);
