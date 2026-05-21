/**
 * 第5步单元测试：inverseMapper — 逆向映射（视图操作 → Master 操作）
 *
 * 测试范围：
 *   - mapAndValidateOperation():  入口函数，按 operation.type 分发处理
 *   - handleInsert():  插入操作的视图→真实映射 + 权限校验
 *   - handleUpdate():  更新操作的视图→真实映射 + 权限校验
 *   - handleDelete():  删除操作的视图→真实映射 + root 保护 + 权限校验
 *   - mapViewToReal():  viewNodeId → realNodeId 映射表查询
 *   - 错误处理：缺少必填字段 / 节点不存在 / 未知操作类型
 *
 * 注意：canEditNode() 依赖数据库中的角色配置，因此本测试需要 DB 初始化。
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { closeDatabase, initializeDatabase } from "../../backend/src/db/database.js";
import { seedDefaultRoles } from "../../backend/src/db/roleStore.js";
import { seedDefaultUsers } from "../../backend/src/db/userStore.js";
import { mapAndValidateOperation } from "../../backend/src/privacy/inverseMapper.js";
import type { ViewOperation, ViewMapping } from "../../backend/src/privacy/viewBuilder.js";
import type { UserInfo } from "../../backend/src/privacy/accessControl.js";
import type { FlatTreeNode, TreeNode } from "../../backend/src/crdt/masterDoc.js";

// ============================================================
// 测试数据
// ============================================================

const adminUser: UserInfo = {
  userId: "admin01",
  name: "管理员",
  role: "admin",
  group: "admin",
};

const leaderA: UserInfo = {
  userId: "leaderA",
  name: "A组组长",
  role: "leader",
  group: "groupA",
};

const memberA1: UserInfo = {
  userId: "memberA1",
  name: "A组成员1",
  role: "member",
  group: "groupA",
};

const memberB1: UserInfo = {
  userId: "memberB1",
  name: "B组成员1",
  role: "member",
  group: "groupB",
};

const guestUser: UserInfo = {
  userId: "guest01",
  name: "访客",
  role: "guest",
  group: "guest",
};

/** 构建一个 5 节点测试树（与 MasterDoc 示例数据一致） */
function makeTestTree(): { tree: FlatTreeNode; nodeMap: Map<string, TreeNode> } {
  const nodeMap = new Map<string, TreeNode>();

  const root: TreeNode = {
    id: "root",
    parentId: "",
    title: "项目文档",
    content: "根节点",
    visibility: "public",
    ownerGroup: "all",
    allowedRoles: ["admin", "leader", "member", "guest"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  nodeMap.set("root", root);

  const publicNode: TreeNode = {
    id: "node-public",
    parentId: "root",
    title: "公开介绍",
    content: "公开内容",
    visibility: "public",
    ownerGroup: "all",
    allowedRoles: ["admin", "leader", "member", "guest"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  nodeMap.set("node-public", publicNode);

  const groupANode: TreeNode = {
    id: "node-groupA",
    parentId: "root",
    title: "A组任务",
    content: "A组内容",
    visibility: "group",
    ownerGroup: "groupA",
    allowedRoles: ["admin", "leader", "member"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  nodeMap.set("node-groupA", groupANode);

  const groupBNode: TreeNode = {
    id: "node-groupB",
    parentId: "root",
    title: "B组任务",
    content: "B组内容",
    visibility: "group",
    ownerGroup: "groupB",
    allowedRoles: ["admin", "leader", "member"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  nodeMap.set("node-groupB", groupBNode);

  const privateNode: TreeNode = {
    id: "node-private",
    parentId: "root",
    title: "管理员备注",
    content: "敏感信息",
    visibility: "private",
    ownerGroup: "admin",
    allowedRoles: ["admin"],
    deleted: false,
    createdBy: "system",
    updatedBy: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  nodeMap.set("node-private", privateNode);

  const tree: FlatTreeNode = {
    ...root,
    children: [
      { ...publicNode, children: [] },
      { ...groupANode, children: [] },
      { ...groupBNode, children: [] },
      { ...privateNode, children: [] },
    ],
  };

  return { tree, nodeMap };
}

/** 创建 viewNodeId = realNodeId 的映射表 */
function makeMappings(ids: string[]): ViewMapping[] {
  return ids.map((id) => ({ viewNodeId: id, realNodeId: id }));
}

const ALL_IDS = ["root", "node-public", "node-groupA", "node-groupB", "node-private"];

/** getNode 工厂函数 */
function makeGetNode(nodeMap: Map<string, TreeNode>) {
  return (nodeId: string) => nodeMap.get(nodeId);
}

before(() => {
  closeDatabase();
  initializeDatabase();
  seedDefaultRoles();
  seedDefaultUsers();
});

// ============================================================
// handleInsert 测试
// ============================================================

describe("mapAndValidateOperation — insert 操作", () => {
  const { tree, nodeMap } = makeTestTree();
  const mappings = makeMappings(ALL_IDS);
  const getNode = makeGetNode(nodeMap);

  it("admin 可以在 root 下插入新节点", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "root",
      payload: {
        title: "新节点",
        content: "内容",
        visibility: "public",
      },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.ok(result.masterOp);
    assert.strictEqual(result.masterOp!.type, "insert");
    assert.strictEqual(result.masterOp!.parentRealNodeId, "root");
    assert.strictEqual(result.masterOp!.payload.title, "新节点");
  });

  it("admin 可以在 group 节点下插入子节点", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "node-groupA",
      payload: { title: "子任务" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.parentRealNodeId, "node-groupA");
  });

  it("leaderA 可以在 A 组节点下插入", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "node-groupA",
      payload: { title: "A组新任务" },
    };

    const result = mapAndValidateOperation(op, leaderA, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
  });

  it("memberA1 不可以在 B 组节点下插入（跨组）", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "node-groupB",
      payload: { title: "越权插入" },
    };

    const result = mapAndValidateOperation(op, memberA1, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("无权"));
  });

  it("guest 不能在任意节点下插入（无编辑权限）", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "node-public",
      payload: { title: "访客插入" },
    };

    const result = mapAndValidateOperation(op, guestUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
  });

  it("缺少 parentViewNodeId 返回失败", () => {
    const op: ViewOperation = {
      type: "insert",
      payload: { title: "无父节点" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("缺少 parentViewNodeId"));
  });

  it("父节点不存在返回失败", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "non-existent-parent",
      payload: { title: "孤儿节点" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不存在"));
  });

  it("插入时 payload 使用默认值填充", () => {
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: "root",
      payload: {}, // 空 payload
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.payload.title, "新节点");
    assert.strictEqual(result.masterOp!.payload.content, "");
    assert.strictEqual(result.masterOp!.payload.visibility, "public");
  });
});

// ============================================================
// handleUpdate 测试
// ============================================================

describe("mapAndValidateOperation — update 操作", () => {
  const { tree, nodeMap } = makeTestTree();
  const mappings = makeMappings(ALL_IDS);
  const getNode = makeGetNode(nodeMap);

  it("admin 可以更新任意节点", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-public",
      payload: { title: "更新后的标题" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.type, "update");
    assert.strictEqual(result.masterOp!.realNodeId, "node-public");
    assert.strictEqual(result.masterOp!.payload.title, "更新后的标题");
  });

  it("leaderA 可以更新本组的 group 节点", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-groupA",
      payload: { content: "更新内容" },
    };

    const result = mapAndValidateOperation(op, leaderA, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
  });

  it("memberB1 不可以更新 A 组节点（跨组）", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-groupA",
      payload: { title: "越权更新" },
    };

    const result = mapAndValidateOperation(op, memberB1, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("无权修改"));
  });

  it("guest 不可以更新任意节点", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-public",
      payload: { title: "访客更新" },
    };

    const result = mapAndValidateOperation(op, guestUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
  });

  it("缺少 viewNodeId 返回失败", () => {
    const op: ViewOperation = {
      type: "update",
      payload: { title: "无 viewNodeId" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("缺少 viewNodeId"));
  });

  it("更新的节点不存在返回失败", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "non-existent-node",
      payload: { title: "幽灵节点" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不存在"));
  });

  it("update 可以部分更新字段（只有传入的字段出现在 payload 中）", () => {
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-public",
      payload: { title: "新标题" }, // 只传 title，不传 content
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.payload.title, "新标题");
    assert.strictEqual(result.masterOp!.payload.content, undefined);
  });
});

// ============================================================
// handleDelete 测试
// ============================================================

describe("mapAndValidateOperation — delete 操作", () => {
  const { tree, nodeMap } = makeTestTree();
  const mappings = makeMappings(ALL_IDS);
  const getNode = makeGetNode(nodeMap);

  it("admin 可以删除非 root 节点", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "node-public",
      payload: {},
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.type, "delete");
    assert.strictEqual(result.masterOp!.realNodeId, "node-public");
  });

  it("任何用户都不能删除 root 节点", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "root",
      payload: {},
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不能删除根节点"));
  });

  it("leaderA 可以删除本组的 group 节点", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "node-groupA",
      payload: {},
    };

    const result = mapAndValidateOperation(op, leaderA, tree, mappings, getNode);
    assert.strictEqual(result.allowed, true);
  });

  it("memberA1 不可以删除 B 组节点（跨组）", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "node-groupB",
      payload: {},
    };

    const result = mapAndValidateOperation(op, memberA1, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("无权删除"));
  });

  it("guest 不可以删除任何节点", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "node-public",
      payload: {},
    };

    const result = mapAndValidateOperation(op, guestUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
  });

  it("缺少 viewNodeId 返回失败", () => {
    const op: ViewOperation = {
      type: "delete",
      payload: {},
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("缺少 viewNodeId"));
  });

  it("删除不存在的节点返回失败", () => {
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: "non-existent-node",
      payload: {},
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("不存在"));
  });
});

// ============================================================
// 边界情况 / 错误处理
// ============================================================

describe("mapAndValidateOperation — 边界与错误处理", () => {
  const { tree, nodeMap } = makeTestTree();
  const mappings = makeMappings(ALL_IDS);
  const getNode = makeGetNode(nodeMap);

  it("未知操作类型返回失败", () => {
    const op: any = {
      type: "unknown_op",
      viewNodeId: "node-public",
      payload: {},
    };

    const result = mapAndValidateOperation(op, adminUser, tree, mappings, getNode);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.message.includes("未知的操作类型"));
  });

  it("viewNodeId 不在映射表中时，mapViewToReal 回退到原 viewNodeId", () => {
    // 如果 viewNodeId 等于真实 nodeId（即当前设计的简化映射），
    // 即使不在映射表中也能正常工作
    const emptyMappings: ViewMapping[] = [];
    const op: ViewOperation = {
      type: "update",
      viewNodeId: "node-public", // 恰好等于真实 nodeId
      payload: { title: "直接匹配" },
    };

    const result = mapAndValidateOperation(op, adminUser, tree, emptyMappings, getNode);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.masterOp!.realNodeId, "node-public");
  });
});
