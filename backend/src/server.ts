import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { getMasterDoc } from "./crdt/masterDoc.js";
import { getAllUsers, getAllRoles, getUserById, refreshUserCache } from "./privacy/accessControl.js";
import { buildUserView, buildViewTree, findViewNode } from "./privacy/viewBuilder.js";
import { mapAndValidateOperation, ViewOperation, OperationResult } from "./privacy/inverseMapper.js";
import { 
  validateBatchOperations, 
  validateRecursiveDelete, 
  validateMoveOperation,
  BatchOperation,
  BatchValidationResult 
} from "./privacy/operationValidator.js";
import { initializeDatabase, getDatabase } from "./db/database.js";
import { seedDefaultUsers } from "./db/userStore.js";
import { seedDefaultRoles } from "./db/roleStore.js";
import { getAllGroups, getAllGroupNames, createGroup, deleteGroup, seedDefaultGroups } from "./db/groupStore.js";
import { register, login, verifyToken, extractToken, JwtPayload } from "./auth/authService.js";
import { getAllRoleConfigs, getRoleConfig, createRole, updateRole, deleteRole, RoleConfig } from "./db/roleStore.js";
import { getAllUsers as getAllUsersFromDb, findUserByUserId, findUserByUsername, createUser, updateUser as updateUserDb, deleteUser } from "./db/userStore.js";
import { logOperation, getOperationLogs } from "./db/operationLogStore.js";
import { WebSocketServer } from "ws";
import { handleYjsConnection, shutdownYjsServer, syncTreeToAllRooms } from "./crdt/ySyncServer.js";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// Initialize DB
// ============================================================
initializeDatabase();
seedDefaultRoles();
seedDefaultUsers();
seedDefaultGroups();

// ============================================================
// JWT Auth Middleware
// ============================================================

function resolveUser(req: any, _res: any, next: any) {
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.currentUser = payload;
    }
  }
  next();
}

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);

  if (!token) {
    res.status(401).json({ status: "error", message: "No auth token provided" });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ status: "error", message: "Token invalid or expired" });
    return;
  }

  req.currentUser = payload;
  next();
}

function requireAdmin(req: any, res: any, next: any) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    res.status(403).json({ status: "error", message: "Admin permission required" });
    return;
  }
  next();
}

app.use(resolveUser);

// ============================================================
// Health Check
// ============================================================
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "Privacy CRDT backend is running" });
});

// ============================================================
// Auth Routes
// ============================================================

app.post("/api/auth/register", (req, res) => {
  try {
    const { username, password } = req.body;
    // userId 可选：未提供时自动从 username 生成
    const userId = req.body.userId || username;

    if (!username || !password) {
      res.status(400).json({ status: "error", message: "username and password are required" });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = register({ userId, username, password }, ipAddress);

    if (result.success) {
      res.status(201).json({ status: "ok", message: result.message, token: result.token, user: result.user });
    } else {
      res.status(400).json({ status: "error", message: result.message });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ status: "error", message: "Username and password are required" });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = login({ username, password }, ipAddress);

    if (result.success) {
      res.json({ status: "ok", message: result.message, token: result.token, user: result.user });
    } else {
      res.status(400).json({ status: "error", message: result.message });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// View Routes
// ============================================================

/**
 * GET /api/view/:userId
 * Get view for a specific user (admin only, or self)
 */
app.get("/api/view/:userId", requireAuth, (req: any, res) => {
  try {
    const jwtUser = req.currentUser as JwtPayload;
    const userId = req.params.userId;

    // Only admin can view other users'' data
    if (userId !== jwtUser.userId && jwtUser.role !== "admin") {
      res.status(403).json({ status: "error", message: "No permission to view other users'' data" });
      return;
    }

    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }

    const masterDoc = getMasterDoc();
    const masterTree = masterDoc.getMasterTree();

    const userView = buildUserView(masterTree, user);

    res.json({
      status: "ok",
      view: {
        ...userView,
        stats: {
          totalNodes: userView.totalNodeCount,
          visibleNodes: userView.visibleNodeCount,
          filteredNodes: userView.filteredCount,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * GET /api/view
 * Get current user''s own view
 */
app.get("/api/view", requireAuth, (req: any, res) => {
  try {
    const jwtUser = req.currentUser as JwtPayload;
    const userId = jwtUser.userId;

    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }

    const masterDoc = getMasterDoc();
    const masterTree = masterDoc.getMasterTree();

    const userView = buildUserView(masterTree, user);

    res.json({
      status: "ok",
      view: {
        ...userView,
        stats: {
          totalNodes: userView.totalNodeCount,
          visibleNodes: userView.visibleNodeCount,
          filteredNodes: userView.filteredCount,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// User Management Routes (Admin only)
// ============================================================

app.get("/api/users", requireAuth, requireAdmin, (_req, res) => {
  try {
    const users = getAllUsersFromDb();
    res.json({ status: "ok", users });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.get("/api/users/:userId", requireAuth, (_req: any, res) => {
  try {
    const jwtUser = _req.currentUser as JwtPayload;
    if (jwtUser.role !== "admin" && jwtUser.userId !== _req.params.userId) {
      res.status(403).json({ status: "error", message: "No permission" });
      return;
    }
    const user = findUserByUserId(_req.params.userId);
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }
    res.json({
      status: "ok",
      user: {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        group: user.group_name,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
  try {
    const { userId, username, password, role, groupName } = req.body;

    if (!userId || !username || !password) {
      res.status(400).json({ status: "error", message: "userId, username and password are required" });
      return;
    }

    if (findUserByUserId(userId)) {
      res.status(400).json({ status: "error", message: "User ID already exists" });
      return;
    }

    if (findUserByUsername(username)) {
      res.status(400).json({ status: "error", message: "Username already exists" });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const newUser = createUser({ userId, username, passwordHash, role: role || "guest", groupName: groupName || "guest" });

    res.status(201).json({
      status: "ok",
      user: {
        userId: newUser.user_id,
        username: newUser.username,
        role: newUser.role,
        group: newUser.group_name,
        createdAt: newUser.created_at,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.put("/api/users/:userId", requireAuth, requireAdmin, (req, res) => {
  try {
    const { role, groupName, password } = req.body;
    const userId = req.params.userId;

    const user = findUserByUserId(userId);
    if (!user) {
      res.status(404).json({ status: "error", message: "User not found" });
      return;
    }

    const updates: any = {};
    if (role) updates.role = role;
    if (groupName) updates.groupName = groupName;
    if (password) updates.passwordHash = bcrypt.hashSync(password, 10);

    updateUserDb(userId, updates);
    res.json({ status: "ok", message: "User updated" });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.delete("/api/users/:userId", requireAuth, requireAdmin, (req, res) => {
  try {
    const userId = req.params.userId;
    if (userId === "admin01") {
      res.status(400).json({ status: "error", message: "Cannot delete default admin" });
      return;
    }
    const deleted = deleteUser(userId);
    if (deleted) {
      res.json({ status: "ok", message: "User deleted" });
    } else {
      res.status(404).json({ status: "error", message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// Group Management Routes (Admin only)
// ============================================================

app.get("/api/groups", requireAuth, requireAdmin, (_req, res) => {
  try {
    const groups = getAllGroups();
    res.json({ status: "ok", groups });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.post("/api/groups", requireAuth, requireAdmin, (req, res) => {
  try {
    const { groupName, description } = req.body;
    if (!groupName) {
      res.status(400).json({ status: "error", message: "groupName is required" });
      return;
    }
    const created = createGroup(groupName, description);
    if (created) {
      res.status(201).json({ status: "ok", group: created });
    } else {
      res.status(400).json({ status: "error", message: `分组 '${groupName}' 已存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.delete("/api/groups/:groupName", requireAuth, requireAdmin, (req, res) => {
  try {
    const groupName = req.params.groupName;
    // 级联降级：将该分组下所有用户变为 guest
    const allUsers = getAllUsersFromDb();
    let demotedCount = 0;
    for (const u of allUsers) {
      if (u.group === groupName) {
        updateUserDb(u.userId, { role: "guest", groupName: "guest" });
        demotedCount++;
      }
    }

    const deleted = deleteGroup(groupName);
    if (deleted) {
      const msg = demotedCount > 0
        ? `分组「${groupName}」已删除，${demotedCount} 名成员已降级为访客`
        : `分组「${groupName}」已删除`;
      res.json({ status: "ok", message: msg, demotedCount });
    } else {
      res.status(400).json({ status: "error", message: "无法删除 admin/guest 分组或分组不存在" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// Role Management Routes (Admin only)
// ============================================================

app.get("/api/roles", requireAuth, requireAdmin, (_req, res) => {
  try {
    const roles = getAllRoleConfigs();
    res.json({ status: "ok", roles });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.post("/api/roles", requireAuth, requireAdmin, (req, res) => {
  try {
    const { roleName, config } = req.body;
    if (!roleName || !config) {
      res.status(400).json({ status: "error", message: "roleName and config are required" });
      return;
    }
    const created = createRole(roleName, config);
    if (created) {
      res.status(201).json({ status: "ok", message: "Role " + roleName + " created" });
    } else {
      res.status(400).json({ status: "error", message: "Role " + roleName + " already exists" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.put("/api/roles/:roleName", requireAuth, requireAdmin, (req, res) => {
  try {
    const roleName = req.params.roleName;
    const { config } = req.body;
    const updated = updateRole(roleName, config);
    if (updated) {
      res.json({ status: "ok", message: "Role " + roleName + " updated" });
    } else {
      res.status(404).json({ status: "error", message: "Role not found" });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// Operation Route
// ============================================================

app.post("/api/operation", requireAuth, (req: any, res) => {
  try {
    const jwtUser = req.currentUser as JwtPayload;
    const userId = jwtUser.userId;

    const { operation } = req.body;

    if (!operation) {
      res.status(400).json({ status: "error", message: "operation is required" });
      return;
    }

    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ status: "error", message: "User " + userId + " not found" });
      return;
    }

    const masterDoc = getMasterDoc();
    const masterTree = masterDoc.getMasterTree();

    const userView = buildUserView(masterTree, user);

    const result: OperationResult = mapAndValidateOperation(
      operation as ViewOperation,
      user,
      masterTree,
      userView.mapping,
      (nodeId: string) => masterDoc.getNode(nodeId)
    );

    if (!result.allowed) {
      console.log("[ACCESS DENIED] User " + userId + " operation rejected: " + result.message);
      res.status(403).json({ status: "rejected", message: result.message, operationType: operation.type });
      return;
    }

    const masterOp = result.masterOp!;
    let opResult: any = { status: "accepted", message: result.message };

    switch (masterOp.type) {
      case "insert": {
        const newId = masterDoc.insertNode(
          masterOp.parentRealNodeId || "root",
          masterOp.payload.title || "New Node",
          masterOp.payload.content || "",
          masterOp.payload.level || 3,
          masterOp.payload.target || user.group,
          userId
        );
        opResult.realNodeId = newId;
        opResult.message = "Node created";
        logOperation({ userId, action: "insert", target: "node:" + newId });
        masterDoc.saveToFile(); syncTreeToAllRooms();
        break;
      }

      case "update": {
        const fields: Record<string, any> = {};
        if (masterOp.payload.title !== undefined) fields.title = masterOp.payload.title;
        if (masterOp.payload.content !== undefined) fields.content = masterOp.payload.content;
        if (masterOp.payload.level !== undefined) fields.level = masterOp.payload.level;
        if (masterOp.payload.target !== undefined) fields.target = masterOp.payload.target;

        const success = masterDoc.updateNode(masterOp.realNodeId!, fields, userId);
        if (success) {
          opResult.message = "Node updated";
          logOperation({ userId, action: "update", target: "node:" + masterOp.realNodeId, detail: fields });
          masterDoc.saveToFile(); syncTreeToAllRooms();
        } else {
          opResult = { status: "error", message: "Node does not exist or has been deleted" };
        }
        break;
      }

      case "delete": {
        const success = masterDoc.deleteNode(masterOp.realNodeId!, userId);
        if (success) {
          opResult.message = "Node logically deleted";
          logOperation({ userId, action: "delete", target: "node:" + masterOp.realNodeId });
          masterDoc.saveToFile(); syncTreeToAllRooms();
        } else {
          opResult = { status: "error", message: "Node does not exist or has been deleted" };
        }
        break;
      }
    }

    console.log("[ACCESS GRANTED] User " + userId + " (" + user.role + "/" + user.group + ") operation success: " + opResult.message);
    res.json(opResult);
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

app.post("/api/reload-users", (_req, res) => {
  try {
    refreshUserCache();
    const users = getAllUsers();
    const roles = getAllRoles();
    res.json({
      status: "ok",
      message: "In-memory DB has " + users.length + " users, " + Object.keys(roles).length + " roles",
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// Start Server (HTTP + WebSocket)
// ============================================================
const server = app.listen(port, () => {
  console.log("Backend server running at http://localhost:" + port);
  const userCount = getAllUsers().length;
  console.log("In-memory DB loaded, user count: " + userCount);
});

// WebSocket for Yjs collaboration
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // Extract token from query string: /ws?token=xxx
  const url = new URL(req.url || "/", "http://localhost");
  const token = url.searchParams.get("token");
  
  if (!token) {
    ws.close(4001, "No auth token");
    return;
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    ws.close(4001, "Invalid token");
    return;
  }
  
  const user = getUserById(payload.userId);
  if (!user) {
    ws.close(4001, "User not found");
    return;
  }
  
  const masterDoc = getMasterDoc();
  handleYjsConnection(ws, user, (id) => masterDoc.getNode(id), masterDoc);
  
  console.log(`[WS] ${user.userId} connected (${wss.clients.size} clients)`);
});
// ============================================================
// Graceful Shutdown
// ============================================================
process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down...");
  shutdownYjsServer();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[Server] SIGINT received, shutting down...");
  shutdownYjsServer();
  process.exit(0);
});



