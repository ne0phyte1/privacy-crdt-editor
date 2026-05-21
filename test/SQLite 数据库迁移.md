# 第4步进度报告：SQLite 数据库迁移 · 用户认证与 CRUD 管理

> **项目**：基于 Yjs 的隐私保护结构化数据协同编辑器
> **步骤**：第4步 — SQLite 数据库存储 · JWT 认证 · 用户与角色 CRUD
> **状态**：✅ 已完成
> **日期**：2026-05-14

---

## 1. 目标概述

将角色、用户等内容从 JSON 配置文件（[`configs/`](../configs)）迁移到 **SQLite 数据库**，实现完整的用户注册、登录、JWT 认证，以及管理员对所辖数据的增删改查。

- **数据库引擎**：SQLite（[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)）
- **密码加密**：bcrypt（[`bcryptjs`](https://github.com/dcodeIO/bcryptjs)）
- **令牌管理**：JWT（[`jsonwebtoken`](https://github.com/auth0/node-jsonwebtoken)）
- **架构原则**：种子数据内联在代码中，不再依赖外部配置文件

---

## 2. 实现文件

### 2.1 新增文件

| 文件 | 说明 |
|------|------|
| [`backend/src/db/database.ts`](../backend/src/db/database.ts) | **数据库初始化模块** — 创建 SQLite 数据库、三张表结构、WAL 模式 |
| [`backend/src/db/userStore.ts`](../backend/src/db/userStore.ts) | **用户数据访问层** — 完整的用户 CRUD + 种子数据（7 个默认用户） |
| [`backend/src/db/roleStore.ts`](../backend/src/db/roleStore.ts) | **角色数据访问层** — 完整的角色 CRUD + 种子数据（4 个默认角色） |
| [`backend/src/db/operationLogStore.ts`](../backend/src/db/operationLogStore.ts) | **操作日志存储** — 记录用户操作、分页查询 |
| [`backend/src/auth/authService.ts`](../backend/src/auth/authService.ts) | **认证服务** — 注册、登录、JWT 令牌生成与验证 |

### 2.2 修改文件

| 文件 | 说明 |
|------|------|
| [`backend/src/privacy/accessControl.ts`](../backend/src/privacy/accessControl.ts) | 从 JSON 文件读取改为从 SQLite 实时读取 |
| [`backend/src/server.ts`](../backend/src/server.ts) | 新增 13 个 API 路由 + JWT 认证中间件 |
| [`.gitignore`](../.gitignore) | 添加 `backend/data/` 忽略数据库文件 |

### 2.3 删除文件

| 文件 | 说明 |
|------|------|
| [`configs/users.json`](../configs/users.json) | **已删除** — 用户种子数据已内联到 [`userStore.ts`](../backend/src/db/userStore.ts:164) |
| [`configs/roles.json`](../configs/roles.json) | **已删除** — 角色种子数据已内联到 [`roleStore.ts`](../backend/src/db/roleStore.ts:177) |

---

## 3. 数据库设计

### 3.1 ER 图

```
┌───────────────────────────────────┐
│            users                  │
├───────────────────────────────────┤
│ id            INTEGER PRIMARY KEY │
│ user_id       TEXT UNIQUE NOT NULL │
│ username      TEXT UNIQUE NOT NULL │
│ password_hash TEXT NOT NULL        │ ← bcrypt 加密
│ name          TEXT NOT NULL        │
│ role          TEXT NOT NULL        │ → roles.role_name
│ group_name    TEXT NOT NULL        │
│ created_at    TEXT                 │
│ updated_at    TEXT                 │
└───────────────────────────────────┘
        │ 1
        │
        │ * (FK)
        ▼
┌───────────────────────────────────┐
│        operation_logs             │
├───────────────────────────────────┤
│ id          INTEGER PRIMARY KEY   │
│ user_id     TEXT NOT NULL          │
│ action      TEXT NOT NULL          │
│ target      TEXT                   │
│ detail      TEXT (JSON)            │
│ ip_address  TEXT                   │
│ created_at  TEXT                   │
└───────────────────────────────────┘

┌───────────────────────────────────┐
│            roles                  │
├───────────────────────────────────┤
│ id                 INTEGER PK     │
│ role_name          TEXT UNIQUE     │
│ priority           INTEGER        │
│ description        TEXT            │
│ can_view_all       BOOLEAN (0/1)   │
│ can_edit_all       BOOLEAN (0/1)   │
│ can_manage_users   BOOLEAN (0/1)   │
│ allowed_visibilities TEXT (JSON)   │
│ can_edit_own_group BOOLEAN (0/1)   │
│ created_at         TEXT            │
│ updated_at         TEXT            │
└───────────────────────────────────┘
```

### 3.2 数据库配置

定义于 [`database.ts`](../backend/src/db/database.ts:10)：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 数据库路径 | `backend/data/privacy-crdt.db` | 自动创建 data 目录 |
| 同步模式 | `WAL` (Write-Ahead Logging) | 提高并发读写性能 |
| 外键约束 | 启用 | 保证 `operation_logs.user_id` 引用有效性 |
| 引擎 | `better-sqlite3` (同步 API) | 无需 async/await，简化代码 |

### 3.3 用户表结构

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | 自增主键 |
| `user_id` | TEXT | NOT NULL UNIQUE | 用户标识（如 "admin01"） |
| `username` | TEXT | NOT NULL UNIQUE | 登录用户名 |
| `password_hash` | TEXT | NOT NULL | bcrypt 加密密码 |
| `name` | TEXT | NOT NULL | 显示名称 |
| `role` | TEXT | NOT NULL DEFAULT 'member' | 角色引用 |
| `group_name` | TEXT | NOT NULL DEFAULT 'guest' | 所属组 |
| `created_at` | TEXT | DEFAULT datetime('now') | 创建时间 |
| `updated_at` | TEXT | DEFAULT datetime('now') | 更新时间 |

### 3.4 角色表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `role_name` | TEXT UNIQUE | 角色名（admin/leader/member/guest） |
| `priority` | INTEGER | 优先级（100/80/60/10） |
| `description` | TEXT | 角色描述 |
| `can_view_all` | INTEGER (0/1) | 是否可查看所有节点 |
| `can_edit_all` | INTEGER (0/1) | 是否可编辑所有节点 |
| `can_manage_users` | INTEGER (0/1) | 是否可管理用户 |
| `allowed_visibilities` | TEXT (JSON) | 允许的可见性数组 |
| `can_edit_own_group` | INTEGER (0/1) | 是否可编辑本组 |

---

## 4. 种子数据

### 4.1 默认用户

定义于 [`userStore.ts:164`](../backend/src/db/userStore.ts:164)，所有用户密码均为 `password123`（bcrypt 加密）。

| 用户 ID | 用户名 | 显示名 | 角色 | 组 |
|---------|--------|--------|------|----|
| `admin01` | admin01 | 管理员 | admin | admin |
| `leaderA` | leaderA | A组组长 | leader | groupA |
| `memberA1` | memberA1 | A组成员1 | member | groupA |
| `memberA2` | memberA2 | A组成员2 | member | groupA |
| `leaderB` | leaderB | B组组长 | leader | groupB |
| `memberB1` | memberB1 | B组成员1 | member | groupB |
| `guest01` | guest01 | 访客 | guest | guest |

### 4.2 默认角色

定义于 [`roleStore.ts:177`](../backend/src/db/roleStore.ts:177)：

| 角色 | 优先级 | 描述 | 关键属性 |
|------|--------|------|---------|
| `admin` | 100 | 管理员 — 可访问和编辑所有节点 | `canViewAll: true`, `canEditAll: true`, `canManageUsers: true`, `allowedVisibilities: ["public","group","private"]` |
| `leader` | 80 | 组长 — 可访问 public 和本组 group 节点 | `canEditOwnGroup: true`, `allowedVisibilities: ["public","group"]` |
| `member` | 60 | 成员 — 可访问 public 和本组 group 节点 | `canEditOwnGroup: true`, `allowedVisibilities: ["public","group"]` |
| `guest` | 10 | 访客 — 仅可查看 public 节点 | `canEditOwnGroup: false`, `allowedVisibilities: ["public"]` |

### 4.3 种子数据加载逻辑

采用**首次启动插入**策略 — 检查表中是否有数据，无数据时才插入：

```typescript
// userStore.ts:183 — 仅当用户表为空时插入种子用户
export function seedDefaultUsers(): void {
  const count = getUserCount();
  if (count > 0) return; // 已有用户，跳过

  const insertMany = db.transaction(() => {
    for (const u of DEFAULT_USERS) {
      insertStmt.run({ /* ... */ });
    }
  });
  insertMany();
}
```

```typescript
// roleStore.ts:234 — 仅当角色表为空时插入种子角色
export function seedDefaultRoles(): void {
  const count = db.prepare("SELECT COUNT(*) as count FROM roles").get();
  if (count.count > 0) return; // 已有角色，跳过
  // ... 事务插入
}
```

---

## 5. 认证系统

### 5.1 JWT 令牌

| 配置项 | 值 |
|--------|-----|
| 密钥 | `process.env.JWT_SECRET || "privacy-crdt-editor-jwt-secret-2024"` |
| 过期时间 | 24h |
| 算法 | HS256 |
| Payload | `{ userId, username, role, group }` |

### 5.2 注册流程

```
POST /api/auth/register
  │
  ├── 验证必填字段 (userId, username, password, name)
  ├── 验证密码长度 >= 6
  ├── 检查 username 唯一性
  ├── 检查 userId 唯一性
  ├── bcrypt.hashSync(password, 10)
  ├── INSERT INTO users
  ├── logOperation("register")
  ├── jwt.sign({ userId, username, role, group })
  └── 返回 { token, user }
```

### 5.3 登录流程

```
POST /api/auth/login
  │
  ├── 验证必填字段 (username, password)
  ├── SELECT * FROM users WHERE username = ?
  ├── bcrypt.compareSync(password, storedHash)
  ├── logOperation("login")
  ├── jwt.sign({ userId, username, role, group })
  └── 返回 { token, user }
```

### 5.4 认证中间件

定义于 [`server.ts:37-89`](../backend/src/server.ts:37)：

| 中间件 | 说明 | 使用位置 |
|--------|------|---------|
| `resolveUser` | **可选认证** — 有 Token 则解析，无 Token 则跳过 | 全局注册 |
| `requireAuth` | **强制认证** — 无有效 Token 返回 401 | 受保护路由 |
| `requireAdmin` | **管理员权限** — 非 admin 返回 403 | 管理路由 |

---

## 6. API 接口

### 6.1 认证接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `POST` | `/api/auth/register` | 🔓 公开 | 用户注册（返回 JWT） |
| `POST` | `/api/auth/login` | 🔓 公开 | 用户登录（返回 JWT） |
| `POST` | `/api/auth/verify` | 🔐 需登录 | 验证当前令牌有效性 |

### 6.2 用户管理接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/api/users` | 🔓 公开* | 获取用户列表（admin 获取完整信息，其他人获取基本信息） |
| `GET` | `/api/users/:userId` | 🔓 公开 | 获取指定用户详细信息 |
| `POST` | `/api/users` | 🔐 管理员 | 创建新用户 |
| `PUT` | `/api/users/:userId` | 🔐 管理员 | 更新用户信息 |
| `DELETE` | `/api/users/:userId` | 🔐 管理员 | 删除用户（**admin01 不可删除**） |

### 6.3 角色管理接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/api/roles` | 🔓 公开 | 获取所有角色配置及详细属性 |
| `GET` | `/api/roles/:roleName` | 🔓 公开 | 获取角色详情 |
| `POST` | `/api/roles` | 🔐 管理员 | 创建新角色 |
| `PUT` | `/api/roles/:roleName` | 🔐 管理员 | 更新角色配置 |
| `DELETE` | `/api/roles/:roleName` | 🔐 管理员 | 删除角色（**内置角色不可删除**） |

### 6.4 其他接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| `GET` | `/api/logs` | 🔐 管理员 | 获取操作日志（分页，可按 userId 筛选） |
| `GET` | `/api/health` | 🔓 公开 | 健康检查 |

### 6.5 请求/响应示例

**注册**：
```bash
POST /api/auth/register
Content-Type: application/json

{
  "userId": "newuser01",
  "username": "newuser01",
  "password": "pass123",
  "name": "新用户",
  "role": "member",
  "groupName": "groupA"
}
```

**成功响应 (201)**：
```json
{
  "status": "ok",
  "message": "注册成功",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "userId": "newuser01",
    "username": "newuser01",
    "name": "新用户",
    "role": "member",
    "group": "groupA"
  }
}
```

**登录**：
```bash
POST /api/auth/login
Content-Type: application/json

{ "username": "admin01", "password": "password123" }
```

**管理员创建用户**：
```bash
POST /api/users
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{
  "userId": "newmember",
  "username": "newmember",
  "password": "pass123",
  "name": "新成员",
  "role": "member",
  "groupName": "groupA"
}
```

**删除保护**：
```bash
DELETE /api/users/admin01
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

→ 400 { "status": "error", "message": "不能删除超级管理员" }
```

---

## 7. 核心代码架构

### 7.1 数据访问层模式

所有数据访问层采用 **单一职责 + 纯函数** 设计，每个模块只负责一张表的操作：

```
database.ts        ← 单例数据库连接 + 表结构初始化
     │
     ├── userStore.ts        ← users 表 CRUD + 种子数据
     ├── roleStore.ts        ← roles 表 CRUD + 种子数据
     └── operationLogStore.ts ← operation_logs 表写入与分页查询
     
authService.ts     ← 依赖 userStore + jwt + bcrypt
accessControl.ts   ← 依赖 userStore + roleStore（实时读取 SQLite）
```

### 7.2 类型转换

角色表使用 `INTEGER (0/1)` 存储布尔值，通过 [`toRoleConfig()`](../backend/src/db/roleStore.ts:37) 转换为 `RoleConfig` 接口：

```typescript
// roleStore.ts:37 — 数据库记录 → 业务对象
function toRoleConfig(record: RoleRecord): RoleConfig {
  let visibilities = JSON.parse(record.allowed_visibilities);
  return {
    priority: record.priority,
    canViewAll: record.can_view_all === 1,      // INTEGER → boolean
    canEditAll: record.can_edit_all === 1,
    allowedVisibilities: visibilities,           // JSON string → string[]
    // ...
  };
}
```

### 7.3 动态 SQL 构建

`updateUser` 和 `updateRole` 采用**动态 SQL** 方式，只更新请求中携带的字段：

```typescript
// userStore.ts:106 — 只更新提供的字段
export function updateUser(userId: string, input: UpdateUserInput): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    values.push(input.name);
  }
  if (input.role !== undefined) {
    fields.push("role = ?");
    values.push(input.role);
  }
  // ... 其他字段

  fields.push("updated_at = datetime('now')");
  values.push(userId);

  const sql = `UPDATE users SET ${fields.join(", ")} WHERE user_id = ?`;
  return db.prepare(sql).run(...values).changes > 0;
}
```

---

## 8. 操作日志

### 8.1 日志记录时机

| 操作类型 | 记录位置 | 日志 action |
|----------|---------|------------|
| 用户注册 | [`authService.ts:101`](../backend/src/auth/authService.ts:101) | `register` |
| 用户登录 | [`authService.ts:168`](../backend/src/auth/authService.ts:168) | `login` |
| 管理员创建用户 | [`server.ts:284`](../backend/src/server.ts:284) | `create_user` |
| 插入文档节点 | [`server.ts:692`](../backend/src/server.ts:692) | `insert` |
| 更新文档节点 | [`server.ts:707`](../backend/src/server.ts:707) | `update` |
| 删除文档节点 | [`server.ts:718`](../backend/src/server.ts:718) | `delete` |

### 8.2 日志查询

```http
GET /api/logs?page=1&pageSize=50&userId=admin01
Authorization: Bearer <admin-token>
```

响应：
```json
{
  "status": "ok",
  "logs": [
    {
      "id": 1,
      "user_id": "admin01",
      "action": "login",
      "target": "user",
      "detail": "{\"username\":\"admin01\"}",
      "ip_address": "::1",
      "created_at": "2026-05-14 12:00:00"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

---

## 9. 安全措施

| 措施 | 实现位置 | 说明 |
|------|---------|------|
| **密码加密** | [`authService.ts:87`](../backend/src/auth/authService.ts:87) | bcrypt hashSync + salt rounds = 10 |
| **JWT 鉴权** | [`server.ts:37-89`](../backend/src/server.ts:37) | Bearer Token + 签名验证 |
| **管理员保护** | [`server.ts:80`](../backend/src/server.ts:80) | `requireAdmin` 中间件 |
| **admin01 防删除** | [`server.ts:342`](../backend/src/server.ts:342) | 硬编码保护 |
| **内置角色防删除** | [`server.ts:461`](../backend/src/server.ts:461) | admin/leader/member/guest 不可删除 |
| **密码不返前端** | 全系统 | 查询时只返回公开信息，不含 `password_hash` |
| **输入验证** | [`authService.ts:53-66`](../backend/src/auth/authService.ts:53) | 必填字段 + 密码长度检查 |

---

## 10. 验证结果

### 10.1 认证测试

| 测试项 | 结果 |
|--------|------|
| `POST /api/auth/register` — 正常注册 | ✅ 返回 JWT + 用户信息 |
| `POST /api/auth/register` — 重复用户名 | ✅ 拒绝，返回错误信息 |
| `POST /api/auth/login` — 正确凭据 | ✅ 返回 JWT + 用户信息 |
| `POST /api/auth/login` — 错误密码 | ✅ 拒绝，返回 401 |
| `POST /api/auth/login` — 不存在的用户 | ✅ 拒绝，返回 401 |
| `POST /api/auth/verify` — 有效令牌 | ✅ 返回令牌中的用户信息 |
| `POST /api/auth/verify` — 无令牌 | ✅ 返回 401 |

### 10.2 用户 CRUD 测试

| 测试项 | 结果 |
|--------|------|
| `GET /api/users` — 未登录 (公开信息) | ✅ 返回基本用户列表 |
| `GET /api/users` — admin 登录 (完整信息) | ✅ 返回含 userId/group 的完整信息 |
| `POST /api/users` — admin 创建用户 | ✅ 创建成功，返回 201 |
| `POST /api/users` — 非 admin 创建 | ✅ 拒绝，返回 403 |
| `PUT /api/users/:userId` — admin 更新 | ✅ 更新成功 |
| `DELETE /api/users/:userId` — 普通用户 | ✅ 删除成功 |
| `DELETE /api/users/admin01` — 防删除保护 | ✅ 拒绝，返回 400 |

### 10.3 角色 CRUD 测试

| 测试项 | 结果 |
|--------|------|
| `GET /api/roles` | ✅ 返回 4 个角色配置（admin/leader/member/guest） |
| `POST /api/roles` — admin 创建新角色 | ✅ 创建成功 |
| `PUT /api/roles/:roleName` — 更新角色属性 | ✅ 更新成功 |
| `DELETE /api/roles/:roleName` — 内置角色 | ✅ 拒绝，返回 400 |
| `DELETE /api/roles/:roleName` — 自定义角色 | ✅ 删除成功 |

### 10.4 数据持久化测试

| 测试项 | 结果 |
|--------|------|
| 删除数据库文件 → 重启服务器 | ✅ 重新创建表和种子数据 |
| 保留数据库文件 → 重启服务器 | ✅ 保留已有数据，不重复插入 |
| 删除 `configs/` 目录 → 重启服务器 | ✅ 正常运行，不依赖配置文件 |

---

## 11. 测试工具

[`tmp/test-auth-crud.html`](../tmp/test-auth-crud.html) — 认证与 CRUD 可视化测试面板。

**功能**：
- 登录/注册表单
- JWT 令牌查看器
- 用户管理表格（支持编辑/删除）
- 角色管理（支持创建/编辑/删除）
- 操作日志查看器（分页浏览）
- 自动以 admin01 登录

**使用方式**：
```bash
# 1. 启动后端
cd backend && npm run dev

# 2. 浏览器打开
open tmp/test-auth-crud.html
```

---

## 12. 项目结构（第4步完成后）

```
privacy-crdt-editor/
├── backend/
│   ├── data/
│   │   └── privacy-crdt.db          ← 新增：SQLite 数据库文件
│   ├── src/
│   │   ├── auth/
│   │   │   └── authService.ts        ← 新增：JWT 认证服务
│   │   ├── crdt/
│   │   │   └── masterDoc.ts
│   │   ├── db/
│   │   │   ├── database.ts            ← 新增：SQLite 初始化
│   │   │   ├── userStore.ts           ← 新增：用户 CRUD
│   │   │   ├── roleStore.ts           ← 新增：角色 CRUD
│   │   │   └── operationLogStore.ts   ← 新增：操作日志
│   │   ├── privacy/
│   │   │   ├── accessControl.ts       ← 修改：使用 SQLite
│   │   │   ├── viewBuilder.ts
│   │   │   └── inverseMapper.ts
│   │   └── server.ts                  ← 修改：新增 13 个路由
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── App.css
├── tmp/
│   ├── crdt.txt
│   ├── 对话和后续.txt
│   ├── step2-progress.md
│   ├── step3-progress.md
│   ├── step4-progress.md             ← 新增：本进度文档
│   ├── test-master-doc.html
│   ├── test-privacy-view.html
│   └── test-auth-crud.html           ← 新增：认证/CRUD 测试面板
└── readme.md
```

---

## 13. 关键技术决策

1. **better-sqlite3（同步 API）而非 sqlite3（回调 API）** — 同步 API 在 Node.js 中执行 SQL 更简洁，避免回调嵌套或 async/await 复杂性；better-sqlite3 性能也优于 sqlite3

2. **WAL 模式** — Write-Ahead Logging 显著提升并发读性能，适合服务端多请求并发场景

3. **种子数据内联而非独立文件** — 移除对 `configs/` 目录的依赖，项目更自包含；启动时检查数据是否存在，避免重复插入

4. **JWT 无状态认证** — 服务器不保存会话状态，便于横向扩展；JWT payload 包含用户角色信息，减少数据库查询

5. **密码 bcrypt 加密** — 即使数据库泄露，密码原文也不暴露；salt rounds = 10 在安全性和性能之间取得平衡

6. **admin01 不可删除 + 内置角色只读保护** — 防止误操作导致系统失去管理员或关键角色配置

7. **accessControl.ts 从文件缓存改为 SQLite 实时读取** — 保证权限数据一致性，添加/修改角色后无需手动刷新缓存；为多实例部署做准备


