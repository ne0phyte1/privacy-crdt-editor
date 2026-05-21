/**
 * 第4步单元测试：viewBuilder — 正向视图变换（完整文档 → 用户专属视图）
 *
 * 测试范围：
 *   - buildViewTree():   根据权限递归过滤，生成视图树
 *   - buildUserView():   生成含统计信息的完整 UserView
 *   - findViewNode():    在视图树中按 viewNodeId 查找节点
 *
 * 这些函数依赖 canAccessNode()，后者是纯函数，因此本测试无需数据库。
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { buildViewTree, buildUserView, findViewNode } from "../../backend/src/privacy/viewBuilder.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { FlatTreeNode } from "../../backend/src/crdt/masterDoc.js";
import type { ViewNode, UserView } from "../../backend/src/privacy/viewBuilder.js";

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

/**
 * 构建与 MasterDoc.initSampleData() 一致的 5 节点树
 *
 * 树结构：
 *   root (public, all roles)
 *   ├── 公开介绍 (public, all roles)
 *   ├── A组任务 (group, groupA, admin/leader/member)
 *   ├── B组任务 (group, groupB, admin/leader/member)
 *   └── 管理员备注 (private, admin, [admin])
 */
function makeMasterTree(): FlatTreeNode {
  return {
    id: "root",
    parentId: "",
    title: "项目文档",
    content: "这是项目的根节点",
    visibility: "public",
    ownerGroup: "all",
    allowedRoles: ["admin", "leader", "member", "guest"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    children: [
      {
        id: "node-public",
        parentId: "root",
        title: "公开介绍",
        content: "这是所有人都能看到的公开内容。",
        visibility: "public",
        ownerGroup: "all",
        allowedRoles: ["admin", "leader", "member", "guest"],
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
      {
        id: "node-groupA",
        parentId: "root",
        title: "A组任务",
        content: "只有 A 组角色可以查看和编辑",
        visibility: "group",
        ownerGroup: "groupA",
        allowedRoles: ["admin", "leader", "member"],
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
      {
        id: "node-groupB",
        parentId: "root",
        title: "B组任务",
        content: "只有 B 组角色可以查看和编辑",
        visibility: "group",
        ownerGroup: "groupB",
        allowedRoles: ["admin", "leader", "member"],
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
      {
        id: "node-private",
        parentId: "root",
        title: "管理员备注",
        content: "仅管理员可见的敏感信息",
        visibility: "private",
        ownerGroup: "admin",
        allowedRoles: ["admin"],
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        children: [],
      },
    ],
  };
}

/** 递归统计 ViewNode 树中的节点数 */
function countViewNodes(node: ViewNode | null): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children) {
    count += countViewNodes(child);
  }
  return count;
}

/** 收集 ViewNode 树中所有节点的 viewNodeId */
function collectViewNodeIds(node: ViewNode | null): string[] {
  if (!node) return [];
  const ids = [node.viewNodeId];
  for (const child of node.children) {
    ids.push(...collectViewNodeIds(child));
  }
  return ids;
}

// ============================================================
// buildViewTree 测试
// ============================================================

describe("buildViewTree — 视图树构建", () => {
  const masterTree = makeMasterTree();

  it("admin 可以看到全部 5 个节点", () => {
    const admin = makeUser({ userId: "admin01", role: "admin", group: "admin" });
    const tree = buildViewTree(masterTree, admin);
    assert.ok(tree !== null);
    assert.strictEqual(countViewNodes(tree), 5);
    const ids = collectViewNodeIds(tree);
    assert.ok(ids.includes("root"));
    assert.ok(ids.includes("node-public"));
    assert.ok(ids.includes("node-groupA"));
    assert.ok(ids.includes("node-groupB"));
    assert.ok(ids.includes("node-private"));
  });

  it("leaderA 可以看到 3 个节点（root + 公开介绍 + A组任务）", () => {
    const leaderA = makeUser({ userId: "leaderA", role: "leader", group: "groupA" });
    const tree = buildViewTree(masterTree, leaderA);
    assert.ok(tree !== null);
    assert.strictEqual(countViewNodes(tree), 3);
    const ids = collectViewNodeIds(tree);
    assert.ok(ids.includes("root"));
    assert.ok(ids.includes("node-public"));
    assert.ok(ids.includes("node-groupA"));
    assert.ok(!ids.includes("node-groupB"));
    assert.ok(!ids.includes("node-private"));
  });

  it("memberA1 可以看到 3 个节点（root + 公开介绍 + A组任务）", () => {
    const memberA1 = makeUser({ userId: "memberA1", role: "member", group: "groupA" });
    const tree = buildViewTree(masterTree, memberA1);
    assert.ok(tree !== null);
    assert.strictEqual(countViewNodes(tree), 3);
  });

  it("memberB1 可以看到 3 个节点（root + 公开介绍 + B组任务）", () => {
    const memberB1 = makeUser({ userId: "memberB1", role: "member", group: "groupB" });
    const tree = buildViewTree(masterTree, memberB1);
    assert.ok(tree !== null);
    assert.strictEqual(countViewNodes(tree), 3);
    const ids = collectViewNodeIds(tree);
    assert.ok(ids.includes("node-groupB"));
    assert.ok(!ids.includes("node-groupA"));
  });

  it("guest01 只能看到 2 个节点（root + 公开介绍）", () => {
    const guest = makeUser({ userId: "guest01", role: "guest", group: "guest" });
    const tree = buildViewTree(masterTree, guest);
    assert.ok(tree !== null);
    assert.strictEqual(countViewNodes(tree), 2);
    const ids = collectViewNodeIds(tree);
    assert.ok(ids.includes("root"));
    assert.ok(ids.includes("node-public"));
    assert.ok(!ids.includes("node-groupA"));
    assert.ok(!ids.includes("node-groupB"));
    assert.ok(!ids.includes("node-private"));
  });

  it("已删除节点在视图内容中显示 '(该节点已被删除)'", () => {
    const treeWithDeleted: FlatTreeNode = {
      ...makeMasterTree(),
      children: [
        ...makeMasterTree().children!,
        {
          id: "node-deleted",
          parentId: "root",
          title: "已删除节点",
          content: "原始内容",
          visibility: "public",
          ownerGroup: "all",
          allowedRoles: ["admin", "leader", "member", "guest"],
          deleted: true,
          createdBy: "system",
          updatedBy: "system",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          children: [],
        },
      ],
    };

    const admin = makeUser({ role: "admin" });
    const tree = buildViewTree(treeWithDeleted, admin);
    assert.ok(tree !== null);
    // 找到已删除节点
    const deletedChild = tree!.children!.find((c) => c.realNodeId === "node-deleted");
    assert.ok(deletedChild);
    assert.strictEqual(deletedChild!.content, "(该节点已被删除)");
  });

  it("已删除节点对非 admin 不可见", () => {
    const treeWithDeleted: FlatTreeNode = {
      ...makeMasterTree(),
      children: [
        ...makeMasterTree().children!,
        {
          id: "node-deleted-2",
          parentId: "root",
          title: "已删除节点2",
          content: "内容",
          visibility: "public",
          ownerGroup: "all",
          allowedRoles: ["admin", "leader", "member", "guest"],
          deleted: true,
          createdBy: "system",
          updatedBy: "system",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          children: [],
        },
      ],
    };

    const member = makeUser({ role: "member", group: "groupA" });
    const tree = buildViewTree(treeWithDeleted, member);
    const ids = collectViewNodeIds(tree);
    assert.ok(!ids.includes("node-deleted-2"));
  });

  it("ViewNode 的 viewNodeId 与 realNodeId 一致", () => {
    const admin = makeUser({ role: "admin" });
    const tree = buildViewTree(makeMasterTree(), admin);
    assert.ok(tree !== null);
    assert.strictEqual(tree!.viewNodeId, tree!.realNodeId);
    for (const child of tree!.children!) {
      assert.strictEqual(child.viewNodeId, child.realNodeId);
    }
  });
});

// ============================================================
// buildUserView 测试
// ============================================================

describe("buildUserView — 完整用户视图（含元数据）", () => {
  const masterTree = makeMasterTree();

  it("返回正确的 userId / userName / role / group", () => {
    const user = makeUser({ userId: "leaderA", name: "A组组长", role: "leader", group: "groupA" });
    const view = buildUserView(masterTree, user);
    assert.strictEqual(view.userId, "leaderA");
    assert.strictEqual(view.userName, "A组组长");
    assert.strictEqual(view.role, "leader");
    assert.strictEqual(view.group, "groupA");
  });

  it("统计信息正确：totalNodeCount 为 5", () => {
    const view = buildUserView(masterTree, makeUser());
    assert.strictEqual(view.totalNodeCount, 5);
  });

  it("统计信息正确：admin 的 filteredCount = 0, visibleNodeCount = 5", () => {
    const admin = makeUser({ role: "admin" });
    const view = buildUserView(masterTree, admin);
    assert.strictEqual(view.filteredCount, 0);
    assert.strictEqual(view.visibleNodeCount, 5);
  });

  it("统计信息正确：leaderA 的 filteredCount = 2, visibleNodeCount = 3", () => {
    const leaderA = makeUser({ role: "leader", group: "groupA" });
    const view = buildUserView(masterTree, leaderA);
    assert.strictEqual(view.filteredCount, 2);
    assert.strictEqual(view.visibleNodeCount, 3);
  });

  it("统计信息正确：guest 的 filteredCount = 3, visibleNodeCount = 2", () => {
    const guest = makeUser({ role: "guest", group: "guest" });
    const view = buildUserView(masterTree, guest);
    assert.strictEqual(view.filteredCount, 3);
    assert.strictEqual(view.visibleNodeCount, 2);
  });

  it("mapping 表为每个可见节点记录 viewNodeId → realNodeId", () => {
    const admin = makeUser({ role: "admin" });
    const view = buildUserView(masterTree, admin);
    assert.strictEqual(view.mapping.length, view.visibleNodeCount);
    for (const m of view.mapping) {
      assert.strictEqual(m.viewNodeId, m.realNodeId);
    }
  });
});

// ============================================================
// findViewNode 测试
// ============================================================

describe("findViewNode — 在视图树中按 viewNodeId 查找节点", () => {
  const masterTree = makeMasterTree();
  const admin = makeUser({ role: "admin" });
  const view = buildUserView(masterTree, admin);

  it("查找到存在的节点", () => {
    const found = findViewNode(view, "node-public");
    assert.ok(found !== null);
    assert.strictEqual(found!.title, "公开介绍");
  });

  it("查找到 root 节点", () => {
    const found = findViewNode(view, "root");
    assert.ok(found !== null);
    assert.strictEqual(found!.title, "项目文档");
  });

  it("查找不存在的节点返回 null", () => {
    const found = findViewNode(view, "non-existent");
    assert.strictEqual(found, null);
  });

  it("在深层嵌套中也能查到（递归搜索）", () => {
    const found = findViewNode(view, "node-private");
    assert.ok(found !== null);
    assert.strictEqual(found!.title, "管理员备注");
  });

  it("空视图树（tree 为 null）返回 null", () => {
    const emptyView: UserView = {
      userId: "test",
      userName: "test",
      role: "guest",
      group: "guest",
      tree: null,
      mapping: [],
      filteredCount: 0,
      totalNodeCount: 0,
      visibleNodeCount: 0,
    };
    assert.strictEqual(findViewNode(emptyView, "root"), null);
  });
});
