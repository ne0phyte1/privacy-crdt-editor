import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { getMasterDoc } from "./crdt/masterDoc.js";
import { getAllUsers, getAllRoles, getUserById, refreshUserCache } from "./privacy/accessControl.js";
import { buildUserView, buildViewTree, findViewNode } from "./privacy/viewBuilder.js";
import { mapAndValidateOperation, ViewOperation, OperationResult } from "./privacy/inverseMapper.js";
import { initializeDatabase, getDatabase } from "./db/database.js";
import { seedDefaultUsers } from "./db/userStore.js";
import { seedDefaultRoles } from "./db/roleStore.js";
import { register, login, verifyToken, extractToken, JwtPayload } from "./auth/authService.js";
import { getAllRoleConfigs, getRoleConfig, createRole, updateRole, deleteRole, RoleConfig } from "./db/roleStore.js";
import { getAllUsers as getAllUsersFromDb, findUserByUserId, findUserByUsername, createUser, updateUser as updateUserDb, deleteUser } from "./db/userStore.js";
import { logOperation, getOperationLogs } from "./db/operationLogStore.js";

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// 数据库初始化（启动时执行）
// ============================================================
initializeDatabase();
seedDefaultRoles();
seedDefaultUsers();

// ============================================================
// JWT 认证中间件（可选 — 部分路由不需要认证）
// ============================================================

/**
 * 从请求中解析当前用户信息
 * 如果请求头包含有效 Bearer Token，则设置 req.currentUser
 */
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

/**
 * 强制认证中间件 — 请求必须携带有效 JWT
 */
function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);

  if (!token) {
    res.status(401).json({
      status: "error",
      message: "未提供认证令牌",
    });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({
      status: "error",
      message: "认证令牌无效或已过期",
    });
    return;
  }

  req.currentUser = payload;
  next();
}

/**
 * 管理员权限中间件
 */
function requireAdmin(req: any, res: any, next: any) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    res.status(403).json({
      status: "error",
      message: "需要管理员权限",
    });
    return;
  }
  next();
}

// 注册解析用户中间件（全局）
app.use(resolveUser);

// ============================================================
// 健康检查
// ============================================================
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Privacy CRDT backend is running (SQLite)",
  });
});

// ============================================================
// 认证路由（注册 / 登录）
// ============================================================

/**
 * POST /api/auth/register
 * 用户注册
 */
app.post("/api/auth/register", (req, res) => {
  try {
    const { userId, username, password, name, role, groupName } = req.body;

    if (!userId || !username || !password || !name) {
      res.status(400).json({
        status: "error",
        message: "userId、username、password 和 name 是必填字段",
      });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = register({ userId, username, password, name, role, groupName }, ipAddress);

    if (result.success) {
      res.status(201).json({
        status: "ok",
        message: result.message,
        token: result.token,
        user: result.user,
      });
    } else {
      res.status(400).json({
        status: "error",
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/auth/login
 * 用户登录
 */
app.post("/api/auth/login", (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        status: "error",
        message: "username 和 password 是必填字段",
      });
      return;
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = login({ username, password }, ipAddress);

    if (result.success) {
      res.json({
        status: "ok",
        message: result.message,
        token: result.token,
        user: result.user,
      });
    } else {
      res.status(401).json({
        status: "error",
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/auth/verify
 * 验证当前令牌是否有效
 */
app.post("/api/auth/verify", requireAuth, (req: any, res) => {
  res.json({
    status: "ok",
    message: "令牌有效",
    user: req.currentUser,
  });
});

// ============================================================
// 用户管理路由（需要管理员权限）
// ============================================================

/**
 * GET /api/users
 * 获取所有用户列表
 */
app.get("/api/users", (req: any, res) => {
  try {
    // 如果有认证信息并且是 admin，返回完整信息；否则只返回公开信息
    if (req.currentUser && req.currentUser.role === "admin") {
      const users = getAllUsersFromDb();
      res.json({ status: "ok", users });
    } else {
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
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/users/:userId
 * 获取指定用户详细信息
 */
app.get("/api/users/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const user = findUserByUserId(userId);
    if (!user) {
      res.status(404).json({ status: "error", message: `用户 ${userId} 不存在` });
      return;
    }
    res.json({
      status: "ok",
      user: {
        userId: user.user_id,
        username: user.username,
        name: user.name,
        role: user.role,
        group: user.group_name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * POST /api/users
 * 创建新用户（管理员）
 */
app.post("/api/users", requireAuth, requireAdmin, (req: any, res) => {
  try {
    const { userId, username, password, name, role, groupName } = req.body;
    if (!userId || !username || !password || !name) {
      res.status(400).json({ status: "error", message: "userId、username、password、name 是必填字段" });
      return;
    }

    const result = createUser({
      userId,
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      name,
      role: role || "member",
      groupName: groupName || "default",
    });

    logOperation({
      userId: req.currentUser.userId,
      action: "create_user",
      target: `user:${userId}`,
      detail: { createdUserId: userId, role: role || "member" },
    });

    res.status(201).json({
      status: "ok",
      message: `用户 ${userId} 创建成功`,
      user: {
        userId: result.user_id,
        username: result.username,
        name: result.name,
        role: result.role,
        group: result.group_name,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * PUT /api/users/:userId
 * 更新用户信息（管理员）
 */
app.put("/api/users/:userId", requireAuth, requireAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    const { name, role, groupName, password } = req.body;

    const input: any = {};
    if (name !== undefined) input.name = name;
    if (role !== undefined) input.role = role;
    if (groupName !== undefined) input.groupName = groupName;
    if (password !== undefined) {
      input.passwordHash = bcrypt.hashSync(password, 10);
    }

    const success = updateUserDb(userId, input);
    if (success) {
      res.json({ status: "ok", message: `用户 ${userId} 已更新` });
    } else {
      res.status(404).json({ status: "error", message: `用户 ${userId} 不存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * DELETE /api/users/:userId
 * 删除用户（管理员）
 */
app.delete("/api/users/:userId", requireAuth, requireAdmin, (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === "admin01") {
      res.status(400).json({ status: "error", message: "不能删除超级管理员" });
      return;
    }
    const success = deleteUser(userId);
    if (success) {
      res.json({ status: "ok", message: `用户 ${userId} 已删除` });
    } else {
      res.status(404).json({ status: "error", message: `用户 ${userId} 不存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// 角色管理路由（需要管理员权限）
// ============================================================

/**
 * GET /api/roles
 * 获取所有角色配置
 */
app.get("/api/roles", (_req, res) => {
  try {
    const roles = getAllRoles();
    res.json({ status: "ok", roles });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * GET /api/roles/:roleName
 * 获取角色详情
 */
app.get("/api/roles/:roleName", (req, res) => {
  try {
    const { roleName } = req.params;
    const config = getRoleConfig(roleName);
    if (!config) {
      res.status(404).json({ status: "error", message: `角色 ${roleName} 不存在` });
      return;
    }
    res.json({ status: "ok", role: { roleName, ...config } });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * POST /api/roles
 * 创建新角色（管理员）
 */
app.post("/api/roles", requireAuth, requireAdmin, (req: any, res) => {
  try {
    const { roleName, priority, description, canViewAll, canEditAll, canManageUsers, allowedVisibilities, canEditOwnGroup } = req.body;
    if (!roleName) {
      res.status(400).json({ status: "error", message: "roleName 是必填字段" });
      return;
    }

    const config: RoleConfig = {
      priority: priority || 0,
      description: description || "",
      canViewAll: canViewAll || false,
      canEditAll: canEditAll || false,
      canManageUsers: canManageUsers || false,
      allowedVisibilities: allowedVisibilities || ["public"],
      canEditOwnGroup: canEditOwnGroup || false,
    };

    const success = createRole(roleName, config);
    if (success) {
      res.status(201).json({ status: "ok", message: `角色 ${roleName} 创建成功` });
    } else {
      res.status(400).json({ status: "error", message: `角色 ${roleName} 已存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * PUT /api/roles/:roleName
 * 更新角色配置（管理员）
 */
app.put("/api/roles/:roleName", requireAuth, requireAdmin, (req, res) => {
  try {
    const { roleName } = req.params;
    const { priority, description, canViewAll, canEditAll, canManageUsers, allowedVisibilities, canEditOwnGroup } = req.body;

    const config: Partial<RoleConfig> = {};
    if (priority !== undefined) config.priority = priority;
    if (description !== undefined) config.description = description;
    if (canViewAll !== undefined) config.canViewAll = canViewAll;
    if (canEditAll !== undefined) config.canEditAll = canEditAll;
    if (canManageUsers !== undefined) config.canManageUsers = canManageUsers;
    if (allowedVisibilities !== undefined) config.allowedVisibilities = allowedVisibilities;
    if (canEditOwnGroup !== undefined) config.canEditOwnGroup = canEditOwnGroup;

    const success = updateRole(roleName, config);
    if (success) {
      res.json({ status: "ok", message: `角色 ${roleName} 已更新` });
    } else {
      res.status(404).json({ status: "error", message: `角色 ${roleName} 不存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * DELETE /api/roles/:roleName
 * 删除角色（管理员）
 */
app.delete("/api/roles/:roleName", requireAuth, requireAdmin, (req, res) => {
  try {
    const { roleName } = req.params;
    if (["admin", "leader", "member", "guest"].includes(roleName)) {
      res.status(400).json({ status: "error", message: "不能删除系统内置角色" });
      return;
    }
    const success = deleteRole(roleName);
    if (success) {
      res.json({ status: "ok", message: `角色 ${roleName} 已删除` });
    } else {
      res.status(404).json({ status: "error", message: `角色 ${roleName} 不存在` });
    }
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// 操作日志路由（管理员）
// ============================================================

/**
 * GET /api/logs
 * 获取操作日志（管理员）
 */
app.get("/api/logs", requireAuth, requireAdmin, (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const userId = req.query.userId as string || undefined;

    const result = getOperationLogs(page, pageSize, userId);
    res.json({ status: "ok", ...result });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// Master Doc 调试接口
// ============================================================

/**
 * GET /api/master-tree
 * 调试接口：返回服务端 Master Y.Doc 的完整 JSON 树
 */
app.get("/api/master-tree", (_req, res) => {
  try {
    const masterDoc = getMasterDoc();
    const tree = masterDoc.getMasterTreeJSON();
    res.json({ status: "ok", tree });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
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
 */
app.get("/api/view/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const user = getUserById(userId);

    if (!user) {
      res.status(404).json({ status: "error", message: `用户 ${userId} 不存在` });
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
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * POST /api/operation
 * 核心接口：用户提交视图操作，服务端执行逆向映射 + 权限校验
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
      res.status(404).json({ status: "error", message: `用户 ${userId} 不存在` });
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
      console.log(`[ACCESS DENIED] 用户 ${userId} 操作被拒绝: ${result.message}`);
      res.status(403).json({ status: "rejected", message: result.message, operationType: operation.type });
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

        // 记录操作日志
        logOperation({ userId, action: "insert", target: `node:${newId}` });
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
          logOperation({ userId, action: "update", target: `node:${masterOp.realNodeId}`, detail: fields });
        } else {
          opResult = { status: "error", message: "节点不存在或已被删除" };
        }
        break;
      }

      case "delete": {
        const success = masterDoc.deleteNode(masterOp.realNodeId!, userId);
        if (success) {
          opResult.message = "节点已逻辑删除";
          logOperation({ userId, action: "delete", target: `node:${masterOp.realNodeId}` });
        } else {
          opResult = { status: "error", message: "节点不存在或已被删除" };
        }
        break;
      }
    }

    console.log(`[ACCESS GRANTED] 用户 ${userId} 操作成功: ${opResult.message}`);
    res.json(opResult);
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

/**
 * POST /api/reload-users
 * 重新加载用户配置（SQLite 版本 — 直接读取数据库）
 */
app.post("/api/reload-users", (_req, res) => {
  try {
    refreshUserCache();
    const users = getAllUsers();
    const roles = getAllRoles();
    res.json({
      status: "ok",
      message: `SQLite 中现有 ${users.length} 个用户，${Object.keys(roles).length} 种角色`,
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: (error as Error).message });
  }
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  const userCount = getAllUsers().length;
  console.log(`SQLite 数据库已加载，用户数: ${userCount}`);
});
