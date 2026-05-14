import express from "express";
import cors from "cors";
import { getMasterDoc } from "./crdt/masterDoc.js";
import { getAllUsers, getAllRoles, getUserById, refreshUserCache } from "./privacy/accessControl.js";
import { buildUserView, buildViewTree, findViewNode } from "./privacy/viewBuilder.js";
import { mapAndValidateOperation, ViewOperation, OperationResult } from "./privacy/inverseMapper.js";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// 健康检查
// ============================================================
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Privacy CRDT backend is running"
  });
});

// ============================================================
// 用户管理
// ============================================================

/**
 * GET /api/users
 * 获取所有用户列表（用于前端用户切换）
 */
app.get("/api/users", (_req, res) => {
  try {
    const users = getAllUsers();
    res.json({
      status: "ok",
      users: users.map((u) => ({
        userId: u.userId,
        name: u.name,
        role: u.role,
        group: u.group,
      })),
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/roles
 * 获取所有角色配置（从 configs/roles.json 加载）
 */
app.get("/api/roles", (_req, res) => {
  try {
    const roles = getAllRoles();
    res.json({
      status: "ok",
      roles,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

// ============================================================
// Master Doc 调试接口（仅开发阶段）
// ============================================================

/**
 * GET /api/master-tree
 * 调试接口：返回服务端 Master Y.Doc 的完整 JSON 树
 */
app.get("/api/master-tree", (_req, res) => {
  try {
    const masterDoc = getMasterDoc();
    const tree = masterDoc.getMasterTreeJSON();
    res.json({
      status: "ok",
      tree
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message
    });
  }
});

/**
 * POST /api/master/nodes
 * 调试接口：在 Master 文档中插入一个新节点
 */
app.post("/api/master/nodes", (req, res) => {
  try {
    const { parentId, title, content, visibility, ownerGroup, allowedRoles, userId } = req.body;
    if (!parentId || !title) {
      res.status(400).json({ status: "error", message: "parentId 和 title 是必填字段" });
      return;
    }
    const masterDoc = getMasterDoc();
    const newId = masterDoc.insertNode(
      parentId || "root",
      title,
      content || "",
      visibility || "public",
      ownerGroup || "all",
      allowedRoles || ["admin", "member", "guest"],
      userId || "debug-user"
    );
    res.json({ status: "ok", nodeId: newId });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * PUT /api/master/nodes/:nodeId
 * 调试接口：更新指定节点
 */
app.put("/api/master/nodes/:nodeId", (req, res) => {
  try {
    const { nodeId } = req.params;
    const { fields, userId } = req.body;
    if (!fields) {
      res.status(400).json({ status: "error", message: "fields 是必填字段" });
      return;
    }
    const masterDoc = getMasterDoc();
    const success = masterDoc.updateNode(nodeId, fields, userId || "debug-user");
    if (success) {
      res.json({ status: "ok", message: "节点已更新" });
    } else {
      res.status(404).json({ status: "error", message: "节点不存在或已被删除" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * DELETE /api/master/nodes/:nodeId
 * 调试接口：逻辑删除指定节点
 */
app.delete("/api/master/nodes/:nodeId", (req, res) => {
  try {
    const { nodeId } = req.params;
    const userId = req.query.userId as string || "debug-user";
    const masterDoc = getMasterDoc();
    const success = masterDoc.deleteNode(nodeId, userId);
    if (success) {
      res.json({ status: "ok", message: "节点已逻辑删除" });
    } else {
      res.status(404).json({ status: "error", message: "节点不存在或已被删除" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// 隐私视图 API（核心功能）
// ============================================================

/**
 * GET /api/view/:userId
 * 核心接口：获取指定用户的专属视图树
 * 服务端根据用户权限，从 Master Y.Doc 生成该用户可见的视图树
 */
app.get("/api/view/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const user = getUserById(userId);

    if (!user) {
      res.status(404).json({
        status: "error",
        message: `用户 ${userId} 不存在`,
      });
      return;
    }

    const masterDoc = getMasterDoc();
    const masterTree = masterDoc.getMasterTree();
    const userView = buildUserView(masterTree, user);

    res.json({
      status: "ok",
      view: {
        userId: userView.userId,
        userName: userView.userName,
        role: userView.role,
        group: userView.group,
        tree: userView.tree,
        stats: {
          totalNodes: userView.totalNodeCount,
          visibleNodes: userView.visibleNodeCount,
          filteredNodes: userView.filteredCount,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/operation
 * 核心接口：用户提交视图操作，服务端执行逆向映射 + 权限校验
 *
 * 请求体格式：
 * {
 *   "userId": "memberA1",
 *   "operation": {
 *     "type": "update" | "insert" | "delete",
 *     "viewNodeId": "xxx",        // update/delete 时必填
 *     "parentViewNodeId": "xxx",  // insert 时必填
 *     "payload": { ... }
 *   }
 * }
 */
app.post("/api/operation", (req, res) => {
  try {
    const { userId, operation } = req.body;

    if (!userId) {
      res.status(400).json({ status: "error", message: "userId 是必填字段" });
      return;
    }

    if (!operation) {
      res.status(400).json({ status: "error", message: "operation 是必填字段" });
      return;
    }

    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({
        status: "error",
        message: `用户 ${userId} 不存在`,
      });
      return;
    }

    const masterDoc = getMasterDoc();
    const masterTree = masterDoc.getMasterTree();

    // 获取该用户的视图映射
    const userView = buildUserView(masterTree, user);

    // 逆向映射 + 权限校验
    const result: OperationResult = mapAndValidateOperation(
      operation as ViewOperation,
      user,
      masterTree,
      userView.mapping,
      (nodeId: string) => masterDoc.getNode(nodeId)
    );

    if (!result.allowed) {
      // 权限校验未通过 — 记录并拒绝
      console.log(`[ACCESS DENIED] 用户 ${userId} 操作被拒绝: ${result.message}`);
      res.status(403).json({
        status: "rejected",
        message: result.message,
        operationType: operation.type,
      });
      return;
    }

    // 权限校验通过 — 写入 Master Y.Doc
    const masterOp = result.masterOp!;
    let opResult: any = { status: "accepted", message: result.message };

    switch (masterOp.type) {
      case "insert": {
        const newId = masterDoc.insertNode(
          masterOp.parentRealNodeId || "root",
          masterOp.payload.title || "新节点",
          masterOp.payload.content || "",
          masterOp.payload.visibility || "public",
          masterOp.payload.ownerGroup || user.group,
          masterOp.payload.allowedRoles || ["admin", "member", "guest"],
          userId
        );
        opResult.realNodeId = newId;
        opResult.message = "节点已添加";
        break;
      }

      case "update": {
        const fields: Record<string, any> = {};
        if (masterOp.payload.title !== undefined) fields.title = masterOp.payload.title;
        if (masterOp.payload.content !== undefined) fields.content = masterOp.payload.content;
        if (masterOp.payload.visibility !== undefined) fields.visibility = masterOp.payload.visibility;
        if (masterOp.payload.ownerGroup !== undefined) fields.ownerGroup = masterOp.payload.ownerGroup;
        if (masterOp.payload.allowedRoles !== undefined) fields.allowedRoles = masterOp.payload.allowedRoles;

        const success = masterDoc.updateNode(masterOp.realNodeId!, fields, userId);
        if (success) {
          opResult.message = "节点已更新";
        } else {
          opResult = {
            status: "error",
            message: "节点不存在或已被删除",
          };
        }
        break;
      }

      case "delete": {
        const success = masterDoc.deleteNode(masterOp.realNodeId!, userId);
        if (success) {
          opResult.message = "节点已逻辑删除";
        } else {
          opResult = {
            status: "error",
            message: "节点不存在或已被删除",
          };
        }
        break;
      }
    }

    console.log(`[ACCESS GRANTED] 用户 ${userId} 操作成功: ${opResult.message}`);
    res.json(opResult);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/reload-users
 * 重新加载用户配置（无需重启服务端）
 */
app.post("/api/reload-users", (_req, res) => {
  try {
    refreshUserCache();
    const users = getAllUsers();
    const roles = getAllRoles();
    res.json({
      status: "ok",
      message: `已重新加载配置，共 ${users.length} 个用户，${Object.keys(roles).length} 种角色`,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Users loaded: ${getAllUsers().length} users`);
});
