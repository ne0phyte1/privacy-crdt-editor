import express from "express";
import cors from "cors";
import { getMasterDoc } from "./crdt/masterDoc.js";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Privacy CRDT backend is running"
  });
});

/**
 * GET /api/master-tree
 * 调试接口：返回服务端 Master Y.Doc 的完整 JSON 树（仅供开发阶段使用）
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

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});