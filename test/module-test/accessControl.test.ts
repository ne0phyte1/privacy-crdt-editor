/**
 * 第4步单元测试：accessControl — RBAC / ABAC / canAccessNode 权限校验
 *
 * 测试范围：
 *   - checkRBAC():  基于角色的访问控制（纯函数）
 *   - checkABAC():  基于节点属性的访问控制（纯函数）
 *   - canAccessNode():  RBAC + ABAC 组合校验（纯函数）
 *
 * 这些函数不依赖数据库，使用构造的测试数据直接测试。
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { checkRBAC, checkABAC, canAccessNode } from "../../backend/src/privacy/accessControl.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { TreeNode } from "../../backend/src/crdt/masterDoc.js";

// ============================================================
// 测试数据工厂
// ============================================================

function makeUser(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    userId: "testUser",
    name: "测试用户",
    role: "member",
    group: "groupA",
    ...overrides,
  };
}

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: "node-1",
    parentId: "root",
    title: "测试节点",
    content: "测试内容",
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

const ROOT_NODE = makeNode({ id: "root", parentId: "", title: "根节点" });

// ============================================================
// checkRBAC 测试
// ============================================================

describe("checkRBAC — 基于角色的访问控制", () => {
  it("root 节点始终可见（无论用户角色）", () => {
    const guest = makeUser({ role: "guest" });
    assert.strictEqual(checkRBAC(guest, ROOT_NODE), true);
  });

  it("admin 角色可以访问任意节点", () => {
    const admin = makeUser({ role: "admin" });
    const privateNode = makeNode({
      visibility: "private",
      allowedRoles: ["admin"],
    });
    assert.strictEqual(checkRBAC(admin, privateNode), true);
  });

  it("已删除节点对非 admin 不可见", () => {
    const member = makeUser({ role: "member" });
    const deletedNode = makeNode({ deleted: true });
    assert.strictEqual(checkRBAC(member, deletedNode), false);
  });

  it("已删除节点对 admin 可见", () => {
    const admin = makeUser({ role: "admin" });
    const deletedNode = makeNode({ deleted: true });
    assert.strictEqual(checkRBAC(admin, deletedNode), true);
  });

  it("用户 role 在 allowedRoles 中 → 通过", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ allowedRoles: ["admin", "member"] });
    assert.strictEqual(checkRBAC(member, node), true);
  });

  it("用户 role 不在 allowedRoles 中 → 拒绝", () => {
    const guest = makeUser({ role: "guest" });
    const node = makeNode({ allowedRoles: ["admin", "leader", "member"] });
    assert.strictEqual(checkRBAC(guest, node), false);
  });
});

// ============================================================
// checkABAC 测试
// ============================================================

describe("checkABAC — 基于节点属性的访问控制", () => {
  it("root 节点始终可见", () => {
    const guest = makeUser({ role: "guest" });
    assert.strictEqual(checkABAC(guest, ROOT_NODE), true);
  });

  it("admin 可以访问任意节点", () => {
    const admin = makeUser({ role: "admin" });
    const privateNode = makeNode({ visibility: "private" });
    assert.strictEqual(checkABAC(admin, privateNode), true);
  });

  it("已删除节点对非 admin 不可见", () => {
    const member = makeUser({ role: "member" });
    const node = makeNode({ deleted: true, visibility: "public" });
    assert.strictEqual(checkABAC(member, node), false);
  });

  it("已删除节点对 admin 可见", () => {
    const admin = makeUser({ role: "admin" });
    const node = makeNode({ deleted: true });
    assert.strictEqual(checkABAC(admin, node), true);
  });

  describe("visibility = public", () => {
    it("所有用户可见（member）", () => {
      const member = makeUser({ role: "member" });
      assert.strictEqual(checkABAC(member, makeNode({ visibility: "public" })), true);
    });

    it("所有用户可见（guest）", () => {
      const guest = makeUser({ role: "guest" });
      assert.strictEqual(checkABAC(guest, makeNode({ visibility: "public" })), true);
    });
  });

  describe("visibility = group", () => {
    it("同组用户可见", () => {
      const memberA = makeUser({ role: "member", group: "groupA" });
      const node = makeNode({ visibility: "group", ownerGroup: "groupA" });
      assert.strictEqual(checkABAC(memberA, node), true);
    });

    it("不同组用户不可见", () => {
      const memberA = makeUser({ role: "member", group: "groupA" });
      const node = makeNode({ visibility: "group", ownerGroup: "groupB" });
      assert.strictEqual(checkABAC(memberA, node), false);
    });
  });

  describe("visibility = private", () => {
    it("非 admin 不可见", () => {
      const leader = makeUser({ role: "leader" });
      const node = makeNode({ visibility: "private" });
      assert.strictEqual(checkABAC(leader, node), false);
    });

    it("admin 可见", () => {
      const admin = makeUser({ role: "admin" });
      const node = makeNode({ visibility: "private" });
      assert.strictEqual(checkABAC(admin, node), true);
    });
  });
});

// ============================================================
// canAccessNode 测试（组合策略）
// ============================================================

describe("canAccessNode — RBAC + ABAC 组合策略", () => {
  it("admin 可以访问任意节点", () => {
    const admin = makeUser({ role: "admin" });
    const privateNode = makeNode({
      visibility: "private",
      allowedRoles: ["admin"],
    });
    assert.strictEqual(canAccessNode(admin, privateNode), true);
  });

  it("root 节点始终可访问", () => {
    const guest = makeUser({ role: "guest" });
    assert.strictEqual(canAccessNode(guest, ROOT_NODE), true);
  });

  it("RBAC 通过 + ABAC 通过 → 允许访问", () => {
    const member = makeUser({ role: "member", group: "groupA" });
    const node = makeNode({
      visibility: "group",
      ownerGroup: "groupA",
      allowedRoles: ["admin", "leader", "member"],
    });
    assert.strictEqual(canAccessNode(member, node), true);
  });

  it("RBAC 通过 + ABAC 拒绝 → 拒绝访问", () => {
    const member = makeUser({ role: "member", group: "groupA" });
    const node = makeNode({
      visibility: "group",
      ownerGroup: "groupB", // 不同组 → ABAC 拒绝
      allowedRoles: ["admin", "leader", "member"],
    });
    assert.strictEqual(canAccessNode(member, node), false);
  });

  it("RBAC 拒绝 + ABAC 通过 → 拒绝访问", () => {
    const guest = makeUser({ role: "guest" });
    const node = makeNode({
      visibility: "public", // ABAC 通过
      allowedRoles: ["admin", "member"], // guest 不在列表中 → RBAC 拒绝
    });
    assert.strictEqual(canAccessNode(guest, node), false);
  });

  it("已删除节点：admin 可见", () => {
    const admin = makeUser({ role: "admin" });
    const deletedNode = makeNode({ deleted: true, allowedRoles: ["admin"] });
    assert.strictEqual(canAccessNode(admin, deletedNode), true);
  });

  it("已删除节点：非 admin 不可见", () => {
    const member = makeUser({ role: "member" });
    const deletedNode = makeNode({ deleted: true });
    assert.strictEqual(canAccessNode(member, deletedNode), false);
  });
});
