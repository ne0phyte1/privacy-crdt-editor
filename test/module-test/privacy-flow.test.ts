/**
 * 第4步+第5步 集成测试：privacy-flow — 隐私操作全流程
 *
 * 测试范围（模拟 POST /api/operation 的完整处理链）：
 *   ① MasterDoc.initSampleData() → 完整文档树
 *   ② buildUserView(masterTree, user) → 用户专属视图 + mapping 表
 *   ③ mapAndValidateOperation(viewOp, user, masterTree, mappings, getNode) → 逆向映射 + 权限校验
 *   ④ MasterDoc.insertNode / updateNode / deleteNode → 写入真实文档
 *   ⑤ 再次 buildUserView → 验证写入后视图一致性
 *
 * 覆盖场景：
 *   - 全角色（admin/leader/member/guest）的完整操作流
 *   - 跨组越权拦截
 *   - Root 保护
 *   - 操作后视图同步验证
 *   - getDefaultAllowedRoles 的隐式行为
 *   - 已删除节点的级联处理
 *
 * 注意：
 *   - canEditNode() 依赖 roleStore，本测试需要 DB 初始化
 *   - MasterDoc.initSampleData() 的根节点 id 固定为 "root"，子节点使用随机 UUID，
 *     因此本测试通过 title 查找节点 ID
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";
import { MasterDoc, FlatTreeNode } from "../../backend/src/crdt/masterDoc.js";
import { buildUserView, findViewNode } from "../../backend/src/privacy/viewBuilder.js";
import { mapAndValidateOperation } from "../../backend/src/privacy/inverseMapper.js";
import { canEditNode, canAccessNode } from "../../backend/src/privacy/accessControl.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { ViewOperation } from "../../backend/src/privacy/inverseMapper.js";
import type { UserView, ViewMapping } from "../../backend/src/privacy/viewBuilder.js";

// ============================================================
// 测试数据
// ============================================================

const adminUser: UserInfo = {
  userId: "admin01", name: "管理员", role: "admin", group: "admin",
};
const leaderA: UserInfo = {
  userId: "leaderA", name: "A组组长", role: "leader", group: "groupA",
};
const memberA1: UserInfo = {
  userId: "memberA1", name: "A组成员1", role: "member", group: "groupA",
};
const memberB1: UserInfo = {
  userId: "memberB1", name: "B组成员1", role: "member", group: "groupB",
};
const guestUser: UserInfo = {
  userId: "guest01", name: "访客", role: "guest", group: "guest",
};

// ============================================================
// 辅助：根据 title 在 MasterDoc 树中查找节点 ID
// ============================================================

/** 在 FlatTreeNode 树中递归查找匹配 title 的节点 ID */
function findNodeIdByTitle(tree: FlatTreeNode, title: string): string | undefined {
  if (tree.title === title) return tree.id;
  if (tree.children) {
    for (const c of tree.children) {
      const found = findNodeIdByTitle(c, title);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * 创建全新 MasterDoc 并提取关键节点 ID
 *
 * initSampleData() 生成的树结构：
 *   root (id="root")
 *   ├── "公开介绍" (public, all)
 *   ├── "A组任务" (group, groupA)
 *   ├── "B组任务" (group, groupB)
 *   └── "管理员备注" (private, admin)
 */
interface SampleNodeIds {
  root: string;
  publicNode: string;   // "公开介绍"
  groupANode: string;   // "A组任务"
  groupBNode: string;   // "B组任务"
  privateNode: string;  // "管理员备注"
}

function createFreshDocWithIds(): { doc: MasterDoc; ids: SampleNodeIds } {
  const doc = new MasterDoc();
  doc.initSampleData();
  const tree = doc.getMasterTree();

  const ids: SampleNodeIds = {
    root: "root",
    publicNode: findNodeIdByTitle(tree, "公开介绍")!,
    groupANode: findNodeIdByTitle(tree, "A组任务")!,
    groupBNode: findNodeIdByTitle(tree, "B组任务")!,
    privateNode: findNodeIdByTitle(tree, "管理员备注")!,
  };

  // 验证所有节点 ID 都已找到
  for (const [key, id] of Object.entries(ids)) {
    assert.ok(id, `应找到 ${key} 节点`);
    assert.ok(doc.getNode(id), `${key} (${id}) 应在 MasterDoc 中存在`);
  }

  return { doc, ids };
}

/** 在视图树中递归收集所有 viewNodeId */
function collectIds(node: any): string[] {
  if (!node) return [];
  const ids = [node.viewNodeId || node.id];
  if (node.children) {
    for (const c of node.children) ids.push(...collectIds(c));
  }
  return ids;
}

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
});

// ============================================================
// 流程 1：完整插入流程（admin / leader / member / guest）
// ============================================================

describe("隐私操作全流程 — insert", () => {
  it("admin 插入节点 → 写入 MasterDoc → 视图更新可见", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    // 1. 逆向映射 + 权限校验
    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.root,
      payload: { title: "Admin插入的节点", content: "测试内容", visibility: "public" },
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true, "admin 应有插入权限");
    assert.ok(result.masterOp, "应返回 masterOp");
    assert.strictEqual(result.masterOp!.type, "insert");
    assert.strictEqual(result.masterOp!.parentRealNodeId, ids.root);

    // 2. 写入 MasterDoc
    const op = result.masterOp!;
    const newId = doc.insertNode(
      op.parentRealNodeId!, op.payload.title!, op.payload.content || "",
      op.payload.visibility || "public", op.payload.ownerGroup || adminUser.group,
      op.payload.allowedRoles || ["admin", "member", "guest"], adminUser.userId
    );
    assert.ok(newId, "应返回新节点 ID");
    assert.ok(doc.getNode(newId), "新节点应在 MasterDoc 中");

    // 3. 重建视图，验证 admin 能看到新节点
    const updatedView = buildUserView(doc.getMasterTree(), adminUser);
    const viewIds = collectIds(updatedView.tree);
    assert.ok(viewIds.includes(newId), "admin 视图应包含新插入的节点");
  });

  it("leaderA 插入节点到 A组任务下 → 写入成功", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, leaderA);

    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.groupANode,
      payload: { title: "LeaderA插入的子任务", visibility: "group", ownerGroup: "groupA" },
    };
    const result = mapAndValidateOperation(
      viewOp, leaderA, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.parentRealNodeId, ids.groupANode);

    // 写入
    const op = result.masterOp!;
    const newId = doc.insertNode(
      op.parentRealNodeId!, op.payload.title!, op.payload.content || "",
      op.payload.visibility || "public", op.payload.ownerGroup || leaderA.group,
      op.payload.allowedRoles || ["admin", "leader", "member"], leaderA.userId
    );
    assert.ok(doc.getNode(newId));

    // leaderA 可见
    const updatedView = buildUserView(doc.getMasterTree(), leaderA);
    assert.ok(collectIds(updatedView.tree).includes(newId));

    // 同组 memberA1 也应可见（leader 创建的节点 allowedRoles 包含 member）
    const memberView = buildUserView(doc.getMasterTree(), memberA1);
    assert.ok(collectIds(memberView.tree).includes(newId),
      "同组成员应能看到 leader 创建的节点");
  });

  it("memberA1 插入节点到 A组任务下 → 写入成功 → 本组可见", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, memberA1);

    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.groupANode,
      payload: { title: "MemberA1插入的子任务", visibility: "group", ownerGroup: "groupA" },
    };
    const result = mapAndValidateOperation(
      viewOp, memberA1, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);

    const op = result.masterOp!;
    // 使用 getDefaultAllowedRoles 返回的默认值
    const defaultRoles = op.payload.allowedRoles!;
    console.log(`[BUG_CHECK] getDefaultAllowedRoles("member") = ${JSON.stringify(defaultRoles)}`);

    const newId = doc.insertNode(
      op.parentRealNodeId!, op.payload.title!, op.payload.content || "",
      op.payload.visibility || "public", op.payload.ownerGroup || memberA1.group,
      defaultRoles, memberA1.userId
    );
    assert.ok(doc.getNode(newId));

    // memberA1 自己可见
    const memberView = buildUserView(doc.getMasterTree(), memberA1);
    assert.ok(collectIds(memberView.tree).includes(newId));

    // ⚠️ BUG: getDefaultAllowedRoles("member") 返回 ["admin", "member"]，
    // 缺少 "leader"。导致 leaderA 看不到 member 创建的节点。
    const leaderView = buildUserView(doc.getMasterTree(), leaderA);
    const leaderVisible = collectIds(leaderView.tree).includes(newId);
    console.log(`[BUG_CHECK] leaderA 能否看到 memberA1 创建的节点: ${leaderVisible}`);
    if (!leaderVisible) {
      console.log(`[BUG] getDefaultAllowedRoles("member") 返回 ${JSON.stringify(defaultRoles)}，` +
        `排除了 "leader"。建议改为 ["admin", "leader", "member"]。`);
    }
  });

  it("memberA1 试图在 B组任务下插入 → 被拒绝（跨组）", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, memberA1);

    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.groupBNode,
      payload: { title: "越权插入B组" },
    };
    const result = mapAndValidateOperation(
      viewOp, memberA1, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false, "跨组插入应被拒绝");
    assert.ok(result.message.includes("无权"));
  });

  it("guest 试图插入节点 → 被拒绝（无编辑权）", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, guestUser);

    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.publicNode,
      payload: { title: "访客尝试插入" },
    };
    const result = mapAndValidateOperation(
      viewOp, guestUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false, "guest 无编辑权限");
  });
});

// ============================================================
// 流程 2：完整更新流程
// ============================================================

describe("隐私操作全流程 — update", () => {
  it("admin 更新节点 → MasterDoc 内容改变 → 视图反映更新", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: ids.publicNode,
      payload: { title: "已更新的公开介绍", content: "新内容" },
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.realNodeId, ids.publicNode);

    // 写入
    const op = result.masterOp!;
    const success = doc.updateNode(op.realNodeId!, {
      title: op.payload.title,
      content: op.payload.content,
    }, adminUser.userId);
    assert.strictEqual(success, true);

    // 验证 MasterDoc 中的变更
    const updatedNode = doc.getNode(ids.publicNode);
    assert.ok(updatedNode);
    assert.strictEqual(updatedNode!.title, "已更新的公开介绍");
    assert.strictEqual(updatedNode!.content, "新内容");

    // 视图也反映变更
    const updatedView = buildUserView(doc.getMasterTree(), adminUser);
    const found = findViewNode(updatedView, ids.publicNode);
    assert.ok(found);
    assert.strictEqual(found!.title, "已更新的公开介绍");
  });

  it("leaderA 可以更新本组的 group 节点", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, leaderA);

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: ids.groupANode,
      payload: { content: "A组更新内容" },
    };
    const result = mapAndValidateOperation(
      viewOp, leaderA, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);

    const op = result.masterOp!;
    doc.updateNode(op.realNodeId!, { content: op.payload.content }, leaderA.userId);
    assert.strictEqual(doc.getNode(ids.groupANode)!.content, "A组更新内容");
  });

  it("memberA1 更新 B组节点 → 被拒绝（跨组 + 视图不可见）", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, memberA1);

    // memberA1 的视图中 B组任务不可见（被过滤了）
    assert.ok(!collectIds(userView.tree).includes(ids.groupBNode),
      "memberA1 视图中不应包含 B组任务");

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: ids.groupBNode,
      payload: { title: "越权更新B组" },
    };
    const result = mapAndValidateOperation(
      viewOp, memberA1, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false, "跨组更新应被拒绝");
  });

  it("guest 尝试更新公开节点 → 被拒绝", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, guestUser);

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: ids.publicNode,
      payload: { title: "访客想改标题" },
    };
    const result = mapAndValidateOperation(
      viewOp, guestUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false);
  });

  it("更新不存在的节点 ID → 返回失败", () => {
    const { doc } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: "ghost-node-99999",
      payload: { title: "幽灵更新" },
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不存在"));
  });

  it("更新已删除节点 → 被拒绝", () => {
    const { doc, ids } = createFreshDocWithIds();
    // 先删除一个节点
    doc.deleteNode(ids.publicNode, adminUser.userId);
    assert.strictEqual(doc.getNode(ids.publicNode)!.deleted, true);

    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    const viewOp: ViewOperation = {
      type: "update",
      viewNodeId: ids.publicNode,
      payload: { title: "尝试更新已删除节点" },
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false, "已删除节点不应允许编辑");
  });
});

// ============================================================
// 流程 3：完整删除流程
// ============================================================

describe("隐私操作全流程 — delete", () => {
  it("admin 删除节点 → 逻辑删除 → 视图仍可见（内容标注删除）", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    const viewOp: ViewOperation = {
      type: "delete",
      viewNodeId: ids.publicNode,
      payload: {},
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.realNodeId, ids.publicNode);

    // 执行删除
    const op = result.masterOp!;
    const success = doc.deleteNode(op.realNodeId!, adminUser.userId);
    assert.strictEqual(success, true);
    assert.strictEqual(doc.getNode(ids.publicNode)!.deleted, true);

    // admin 仍可在视图中看到（显示 "(该节点已被删除)"）
    const updatedView = buildUserView(doc.getMasterTree(), adminUser);
    const found = findViewNode(updatedView, ids.publicNode);
    assert.ok(found, "admin 视图中仍应看到已删除节点");
    assert.strictEqual(found!.content, "(该节点已被删除)");
  });

  it("非 admin 删除节点后视图中消失", () => {
    const { doc, ids } = createFreshDocWithIds();
    // 先让 leaderA 在 A组任务下创建一个节点
    const newId = doc.insertNode(
      ids.groupANode, "A组临时节点", "内容", "group", "groupA",
      ["admin", "leader", "member"], leaderA.userId
    );

    // leaderA 删除它
    doc.deleteNode(newId, leaderA.userId);
    assert.strictEqual(doc.getNode(newId)!.deleted, true);

    // leaderA 重建视图 → 该节点应被过滤（非 admin 看不到已删除节点）
    const updatedView = buildUserView(doc.getMasterTree(), leaderA);
    const viewIds = collectIds(updatedView.tree);
    assert.ok(!viewIds.includes(newId),
      `非 admin 视图中不应包含已删除节点 ${newId}`);
  });

  it("删除 root → 被拒绝", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    const viewOp: ViewOperation = {
      type: "delete",
      viewNodeId: ids.root,
      payload: {},
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false, "任何用户都不能删除 root");
    assert.ok(result.message.includes("不能删除根节点"));
  });

  it("memberB1 删除 A组节点 → 被拒绝（跨组 + 不可见）", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, memberB1);

    const viewOp: ViewOperation = {
      type: "delete",
      viewNodeId: ids.groupANode,
      payload: {},
    };
    const result = mapAndValidateOperation(
      viewOp, memberB1, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false);
  });

  it("guest 尝试删除公开节点 → 被拒绝", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, guestUser);

    const viewOp: ViewOperation = {
      type: "delete",
      viewNodeId: ids.publicNode,
      payload: {},
    };
    const result = mapAndValidateOperation(
      viewOp, guestUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false);
  });
});

// ============================================================
// 流程 4：操作后多用户视图同步验证
// ============================================================

describe("隐私操作全流程 — 多用户视图同步", () => {
  it("admin 在 A组任务下插入子节点 → A组成员可见 → B组成员不可见", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    // Admin 在 A组任务下插入一个 group 节点
    const viewOp: ViewOperation = {
      type: "insert",
      parentViewNodeId: ids.groupANode,
      payload: {
        title: "Admin创建的A组子任务",
        visibility: "group",
        ownerGroup: "groupA",
      },
    };
    const result = mapAndValidateOperation(
      viewOp, adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);

    const op = result.masterOp!;
    const newId = doc.insertNode(
      op.parentRealNodeId!, op.payload.title!, op.payload.content || "",
      op.payload.visibility || "group", op.payload.ownerGroup || "groupA",
      op.payload.allowedRoles || ["admin", "leader", "member", "guest"], adminUser.userId
    );
    assert.ok(doc.getNode(newId));

    const updatedTree = doc.getMasterTree();

    // A组成员可见
    const memberAIds = collectIds(buildUserView(updatedTree, memberA1).tree);
    assert.ok(memberAIds.includes(newId), "A组成员应能看到Admin在A组下创建的节点");

    // B组成员不可见
    const memberBIds = collectIds(buildUserView(updatedTree, memberB1).tree);
    assert.ok(!memberBIds.includes(newId), "B组成员不应看到Admin在A组下创建的节点");

    // guest 不可见
    const guestIds = collectIds(buildUserView(updatedTree, guestUser).tree);
    assert.ok(!guestIds.includes(newId), "访客不应看到group节点");
  });

  it("操作后 mapping 表更新正确", () => {
    const { doc, ids } = createFreshDocWithIds();

    const view1 = buildUserView(doc.getMasterTree(), adminUser);
    const initialMappingCount = view1.mapping.length;
    assert.strictEqual(view1.visibleNodeCount, initialMappingCount,
      "mapping 条目数应等于可见节点数");

    // 插入新节点后，视图重建
    doc.insertNode(ids.root, "新节点", "内容", "public", "all",
      ["admin", "leader", "member", "guest"], adminUser.userId);

    const view2 = buildUserView(doc.getMasterTree(), adminUser);
    assert.strictEqual(view2.mapping.length, view2.visibleNodeCount);
    assert.ok(view2.mapping.length > initialMappingCount,
      "插入节点后 mapping 应增加");
  });

  it("节点被过滤后（非 admin 删除）mapping 条目减少", () => {
    const { doc, ids } = createFreshDocWithIds();
    // 创建一个 leaderA 可见的节点
    const newId = doc.insertNode(
      ids.groupANode, "临时A组节点", "内容", "group", "groupA",
      ["admin", "leader", "member"], leaderA.userId
    );

    const viewBefore = buildUserView(doc.getMasterTree(), leaderA);
    const beforeCount = viewBefore.visibleNodeCount;
    assert.ok(collectIds(viewBefore.tree).includes(newId));

    // 删除后 leaderA 不可见（非admin看不到已删除节点）
    doc.deleteNode(newId, adminUser.userId);
    const viewAfter = buildUserView(doc.getMasterTree(), leaderA);
    assert.ok(!collectIds(viewAfter.tree).includes(newId),
      "非 admin 删除节点后视图中应消失");
    assert.strictEqual(viewAfter.visibleNodeCount, beforeCount - 1,
      "visibleNodeCount 应减 1");
  });
});

// ============================================================
// 流程 5：边界情况与错误处理
// ============================================================

describe("隐私操作全流程 — 边界情况", () => {
  it("canEdit → canAccess 不变式：能编辑则必能访问", () => {
    const { doc } = createFreshDocWithIds();
    const testUsers = [adminUser, leaderA, memberA1, memberB1, guestUser];

    // 收集所有节点
    function collectAllNodeIds(tree: FlatTreeNode): string[] {
      const ids = [tree.id];
      if (tree.children) {
        for (const c of tree.children) ids.push(...collectAllNodeIds(c));
      }
      return ids;
    }
    const allNodeIds = collectAllNodeIds(doc.getMasterTree());

    for (const user of testUsers) {
      for (const nodeId of allNodeIds) {
        const node = doc.getNode(nodeId);
        if (!node) continue;

        const canEdit = canEditNode(user, node);
        if (canEdit) {
          const canAccess = canAccessNode(user, node);
          assert.ok(canAccess,
            `用户 ${user.userId} 可编辑节点 ${nodeId}，但不可访问，逻辑矛盾`);
        }
      }
    }
  });

  it("guest 在常规文档中至少能看到 root + 公开节点", () => {
    const { doc, ids } = createFreshDocWithIds();
    const view = buildUserView(doc.getMasterTree(), guestUser);
    assert.ok(view.tree !== null);
    assert.ok(view.visibleNodeCount >= 2,
      `guest 应至少看到 2 个节点，实际: ${view.visibleNodeCount}`);
    const viewIds = collectIds(view.tree);
    assert.ok(viewIds.includes(ids.root), "guest 应能看到 root");
    assert.ok(viewIds.includes(ids.publicNode), "guest 应能看到公开节点");
    assert.ok(!viewIds.includes(ids.privateNode), "guest 不应看到 private 节点");
  });

  it("insert 操作的 allowedRoles 默认值 = getDefaultAllowedRoles(role)", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();

    // admin → ["admin", "leader", "member", "guest"]
    const adminView = buildUserView(masterTree, adminUser);
    const adminResult = mapAndValidateOperation(
      { type: "insert", parentViewNodeId: ids.root, payload: { title: "Admin默认角色测试" } },
      adminUser, masterTree, adminView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(adminResult.allowed, true);
    assert.deepStrictEqual(adminResult.masterOp!.payload.allowedRoles,
      ["admin", "leader", "member", "guest"]);

    // leader → ["admin", "leader", "member"]
    const leaderView = buildUserView(masterTree, leaderA);
    const leaderResult = mapAndValidateOperation(
      { type: "insert", parentViewNodeId: ids.groupANode, payload: { title: "Leader默认角色测试" } },
      leaderA, masterTree, leaderView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(leaderResult.allowed, true);
    assert.deepStrictEqual(leaderResult.masterOp!.payload.allowedRoles,
      ["admin", "leader", "member"]);

    // member → ["admin", "member"]
    const memberView = buildUserView(masterTree, memberA1);
    const memberResult = mapAndValidateOperation(
      { type: "insert", parentViewNodeId: ids.groupANode, payload: { title: "Member默认角色测试" } },
      memberA1, masterTree, memberView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(memberResult.allowed, true);
    // 当前实现 — 详见 BUG #1
    assert.deepStrictEqual(memberResult.masterOp!.payload.allowedRoles,
      ["admin", "member"],
      "getDefaultAllowedRoles('member') 当前返回 ['admin', 'member']，缺少 'leader'");

    // guest — 无编辑权限，insert 被 canEditNode 拒绝
    const guestView = buildUserView(masterTree, guestUser);
    const guestResult = mapAndValidateOperation(
      { type: "insert", parentViewNodeId: ids.publicNode, payload: { title: "Guest默认角色测试" } },
      guestUser, masterTree, guestView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(guestResult.allowed, false,
      "guest 不应有编辑权限");
  });

  it("insert 操作 payload 的默认值填充正确", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    // 空 payload
    const result = mapAndValidateOperation(
      { type: "insert", parentViewNodeId: ids.root, payload: {} },
      adminUser, masterTree, userView.mapping,
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.payload.title, "新节点");
    assert.strictEqual(result.masterOp!.payload.content, "");
    assert.strictEqual(result.masterOp!.payload.visibility, "public");
    assert.strictEqual(result.masterOp!.payload.ownerGroup, adminUser.group);
  });

  it("delete 操作级联：删除父节点 → 子节点也标记为 deleted", () => {
    const { doc, ids } = createFreshDocWithIds();
    // 在 A组任务下建一个子节点
    const childId = doc.insertNode(
      ids.groupANode, "子任务", "子内容", "group", "groupA",
      ["admin", "leader", "member"], adminUser.userId
    );

    // 删除父节点（A组任务）
    doc.deleteNode(ids.groupANode, adminUser.userId);
    assert.strictEqual(doc.getNode(ids.groupANode)!.deleted, true);
    assert.strictEqual(doc.getNode(childId)!.deleted, true,
      "级联删除：子节点也应被标记为 deleted");

    // admin 仍可在视图中看到这两个已删除节点
    const view = buildUserView(doc.getMasterTree(), adminUser);
    const foundParent = findViewNode(view, ids.groupANode);
    assert.ok(foundParent, "admin 应能看到已删除的父节点");
    assert.strictEqual(foundParent!.content, "(该节点已被删除)");
  });

  it("叶子节点（无子节点）的更新和删除操作正常", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();

    // ids.publicNode 是叶子节点
    const node = doc.getNode(ids.publicNode);
    assert.ok(node);
    assert.strictEqual(doc.getChildrenIds(ids.publicNode).length, 0);

    // 更新叶子节点
    const userView = buildUserView(masterTree, adminUser);
    const updateResult = mapAndValidateOperation(
      { type: "update", viewNodeId: ids.publicNode, payload: { content: "叶子更新" } },
      adminUser, masterTree, userView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(updateResult.allowed, true);

    // 删除叶子节点
    const delResult = mapAndValidateOperation(
      { type: "delete", viewNodeId: ids.publicNode, payload: {} },
      adminUser, masterTree, userView.mapping, (id) => doc.getNode(id)
    );
    assert.strictEqual(delResult.allowed, true);
  });
});

// ============================================================
// 流程 6：映射表独立性测试
// ============================================================

describe("隐私操作全流程 — 映射表独立性", () => {
  it("mapViewToReal: viewNodeId 在映射表中时返回 realNodeId", () => {
    const { doc } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();
    const userView = buildUserView(masterTree, adminUser);

    // 在当前设计中 viewNodeId === realNodeId
    for (const m of userView.mapping) {
      assert.strictEqual(m.viewNodeId, m.realNodeId);
    }

    // 验证 resolveRealNodeId 能正确找到
    for (const m of userView.mapping) {
      const real = userView.mapping.find((e) => e.viewNodeId === m.viewNodeId)?.realNodeId;
      assert.strictEqual(real, m.realNodeId);
    }
  });

  it("viewNodeId 不在映射表中时 mapViewToReal 回退到原 viewNodeId", () => {
    const { doc, ids } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();

    // 使用空映射表 → mapViewToReal 回退到 viewNodeId 本身
    // viewNodeId 恰好等于 realNodeId，所以 getNode 可以工作
    const result = mapAndValidateOperation(
      { type: "update", viewNodeId: ids.publicNode, payload: { title: "映射表回退测试" } },
      adminUser, masterTree, [],  // 空映射表
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.realNodeId, ids.publicNode,
      "当映射表为空时，应回退到原 viewNodeId（恰好等于 realNodeId）");
  });

  it("viewNodeId 不在映射表中且不等于任何 realNodeId → 返回失败", () => {
    const { doc } = createFreshDocWithIds();
    const masterTree = doc.getMasterTree();

    const result = mapAndValidateOperation(
      { type: "update", viewNodeId: "completely-fake-id", payload: { title: "无效" } },
      adminUser, masterTree, [],
      (id) => doc.getNode(id)
    );
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不存在"));
  });
});

// ============================================================
// ⚠️ BUG 报告汇总
// ============================================================

console.log(`
========================================================================
 BUG 报告汇总 (privacy-flow.test.ts)
========================================================================

 BUG #1: getDefaultAllowedRoles("member") 缺少 "leader"
   文件: backend/src/privacy/inverseMapper.ts:308
   现象: member 角色插入节点时，allowedRoles 只包含 ["admin", "member"]，
         不包含 "leader"。导致组长看不到组员创建的节点。
   影响: 当 member 创建节点且不显式传 allowedRoles 时，leader 无法
         在视图中看到该节点。这与 seed data 中 A组/B组任务节点的
         allowedRoles ["admin", "leader", "member"] 不一致。
   建议: 将 case "member" 的返回值改为 ["admin", "leader", "member"]。

 BUG #2: authService.register() 未校验 userId 字段
   文件: backend/src/auth/authService.ts:54
   现象: register() 只检查了 username、password、name，未检查 userId。
         虽然 server.ts 的 API 层做了检查，但直接调用 service 层函数
         可创建无 userId 的用户。
   建议: 在 register() 中添加 !input.userId 检查，保持防御层次一致。

 BUG #3: canAccessNode 对已删除节点的处理先于 root 检查
   文件: backend/src/privacy/accessControl.ts:150-153
   现象: canAccessNode() 在开头检查 node.deleted 时没有先判断
         node.id === "root"。如果 root.deleted 被意外设为 true，
         非 admin 用户将看不到 root。
   风险: 当前有 server 层保护 root 不被删除，但缺少防御性编程。
   建议: 在 canAccessNode 开头添加: if (node.id === "root") return true;

 BUG #4: operationLogStore 测试 FOREIGN KEY 约束失败
   文件: test/module-test/operationLogStore.test.ts
   现象: logOperation() 为不存在的 test 用户写入日志时，触发
         FOREIGN KEY constraint failed（user_id 引用 users 表）。
         虽然 logOperation 有 try/catch 静默吞掉了错误，但日志实际
         未写入，导致后续断言失败。
   建议: 测试应先在 users 表创建 test 用户，或在 test before() 中
         插入 test 用户。

========================================================================
`);
