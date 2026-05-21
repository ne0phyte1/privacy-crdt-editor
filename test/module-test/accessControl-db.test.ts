/**
 * 第4步单元测试：accessControl（DB 依赖部分）— canEditNode / getUserById
 *
 * 测试范围：
 *   - canEditNode():    编辑权限校验（依赖 roleStore 中的角色配置）
 *   - getUserById():    根据 userId 从 SQLite 获取用户信息
 *   - getAllUsers():    获取所有用户列表
 *   - getAllRoles():    获取所有角色配置
 *   - getRoleConfig():  获取单角色配置
 *
 * 注意：checkRBAC / checkABAC / canAccessNode 的纯函数测试在 accessControl.test.ts 中。
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase, getDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers, createUser, deleteUser } from "../../backend/src/db/userStore.js";
import {
  canEditNode,
  getUserById,
  getAllUsers,
  getAllRoles,
  getRoleConfig,
} from "../../backend/src/privacy/accessControl.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { TreeNode } from "../../backend/src/crdt/masterDoc.js";

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "node-test",
    parentId: "root",
    title: "测试节点",
    content: "内容",
    visibility: "public",
    ownerGroup: "all",
    allowedRoles: ["admin", "leader", "member", "guest"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    db.prepare("DELETE FROM users WHERE user_id LIKE 'test_%'").run();
  } catch { /* ignore */ }
});

afterEach(() => {
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM users WHERE user_id = ?").run("test_edit_user");
  } catch { /* ignore */ }
});

// ============================================================
// canEditNode 测试（依赖 DB 中的角色配置）
// ============================================================

describe("canEditNode — 编辑权限校验", () => {
  const admin = { userId: "admin01", name: "管理员", role: "admin" as const, group: "admin" };
  const leader = { userId: "leaderA", name: "A组组长", role: "leader" as const, group: "groupA" };
  const member = { userId: "memberA1", name: "A组成员1", role: "member" as const, group: "groupA" };
  const guest = { userId: "guest01", name: "访客", role: "guest" as const, group: "guest" };

  it("admin 可以编辑任意非 root 节点（canEditAll = true）", () => {
    const node = makeNode({ id: "some-node", visibility: "private" });
    assert.strictEqual(canEditNode(admin, node), true);
  });

  it("只有 admin 可以编辑 root 节点", () => {
    const rootNode = makeNode({ id: "root" });
    assert.strictEqual(canEditNode(admin, rootNode), true);
    assert.strictEqual(canEditNode(leader, rootNode), false);
    assert.strictEqual(canEditNode(member, rootNode), false);
    assert.strictEqual(canEditNode(guest, rootNode), false);
  });

  it("已删除节点不能编辑", () => {
    const deletedNode = makeNode({ deleted: true });
    assert.strictEqual(canEditNode(admin, deletedNode), false);
    assert.strictEqual(canEditNode(leader, deletedNode), false);
  });

  it("leader 可以编辑本组的 group 节点", () => {
    const node = makeNode({ visibility: "group", ownerGroup: "groupA", allowedRoles: ["admin", "leader", "member"] });
    assert.strictEqual(canEditNode(leader, node), true);
  });

  it("leader 不可以编辑其他组的 group 节点", () => {
    const node = makeNode({ visibility: "group", ownerGroup: "groupB", allowedRoles: ["admin", "leader", "member"] });
    assert.strictEqual(canEditNode(leader, node), false);
  });

  it("member 可以编辑本组的 group 节点", () => {
    const node = makeNode({ visibility: "group", ownerGroup: "groupA", allowedRoles: ["admin", "leader", "member"] });
    assert.strictEqual(canEditNode(member, node), true);
  });

  it("member 不可以编辑其他组的 group 节点", () => {
    const node = makeNode({ visibility: "group", ownerGroup: "groupB", allowedRoles: ["admin", "leader", "member"] });
    assert.strictEqual(canEditNode(member, node), false);
  });

  it("leader 和 member 不可以编辑 private 节点", () => {
    const node = makeNode({ visibility: "private", allowedRoles: ["admin"] });
    assert.strictEqual(canEditNode(leader, node), false);
    assert.strictEqual(canEditNode(member, node), false);
  });

  it("guest 不能编辑任何节点（canEditOwnGroup = false）", () => {
    const publicNode = makeNode({ visibility: "public" });
    const groupNode = makeNode({ visibility: "group", ownerGroup: "guest", allowedRoles: ["admin", "guest"] });
    assert.strictEqual(canEditNode(guest, publicNode), false);
    assert.strictEqual(canEditNode(guest, groupNode), false);
  });

  it("leader 和 member 可以编辑 public 节点", () => {
    const node = makeNode({ visibility: "public", allowedRoles: ["admin", "leader", "member", "guest"] });
    assert.strictEqual(canEditNode(leader, node), true);
    assert.strictEqual(canEditNode(member, node), true);
  });

  it("即使有 canEditOwnGroup，也必须先有查看权限（RBAC 不通过则不能编辑）", () => {
    // member 的 allowedRoles 中不含 guest，所以 guest 不能访问 → 不能编辑
    const node = makeNode({
      visibility: "group",
      ownerGroup: "groupA",
      allowedRoles: ["admin", "leader", "member"], // guest 不在其中
    });
    // 创建一个 guest 但在 groupA 组 → ABAC 通过，但 RBAC 不通过
    const guestInGroupA: UserInfo = { userId: "g1", name: "g", role: "guest", group: "groupA" };
    assert.strictEqual(canEditNode(guestInGroupA, node), false);
  });
});

// ============================================================
// getUserById / getAllUsers / getAllRoles 测试
// ============================================================

describe("accessControl — 用户/角色查询（SQLite 数据源）", () => {
  it("getUserById: 获取存在的用户", () => {
    const user = getUserById("admin01");
    assert.ok(user !== undefined);
    assert.strictEqual(user!.userId, "admin01");
    assert.strictEqual(user!.name, "管理员");
    assert.strictEqual(user!.role, "admin");
    assert.strictEqual(user!.group, "admin");
  });

  it("getUserById: 不存在的用户返回 undefined", () => {
    const user = getUserById("nonexistent");
    assert.strictEqual(user, undefined);
  });

  it("getAllUsers: 返回所有用户", () => {
    const users = getAllUsers();
    assert.ok(users.length >= 7);
    // 验证每个用户的格式正确
    for (const u of users) {
      assert.ok(u.userId);
      assert.ok(u.name);
      assert.ok(["admin", "leader", "member", "guest"].includes(u.role));
    }
  });

  it("getAllRoles: 返回所有角色配置", () => {
    const roles = getAllRoles();
    assert.ok("admin" in roles);
    assert.ok("leader" in roles);
    assert.ok("member" in roles);
    assert.ok("guest" in roles);
    assert.strictEqual(roles["admin"].priority, 100);
  });

  it("getRoleConfig: 返回指定角色配置", () => {
    const config = getRoleConfig("leader");
    assert.ok(config !== undefined);
    assert.strictEqual(config!.canEditOwnGroup, true);
  });
});
