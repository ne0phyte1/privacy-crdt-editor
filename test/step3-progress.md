# 第3步进度报告：RBAC + ABAC 安全访问控制与隐私视图系统

> **项目**：基于 Yjs 的隐私保护结构化数据协同编辑器
> **步骤**：第3步 — 用户权限配置 · 正向视图变换 · 逆向映射与权限校验
> **状态**：✅ 已完成
> **日期**：2026-05-14

---

## 1. 目标概述

实现"每个用户只拿到由服务端根据权限生成的 View Tree / View Doc"这一核心安全架构：

- **用户配置**：支持 admin、leader、member、guest 四类角色，支持 group 分组
- **正向视图变换**：服务端根据用户权限，从 Master Y.Doc 完整树生成用户专属视图
- **逆向映射**：将用户对视图的操作（添加/修改/删除）映射回 Master Doc 的真实节点
- **权限校验**：在操作回写前执行 RBAC + ABAC 双重校验，拒绝越权操作
- **安全原则**：客户端永远不直接接触 Master Y.Doc，服务端是唯一的真相来源

---

## 2. 实现文件

### 2.1 新增文件

| 文件 | 说明 |
|------|------|
| [`configs/roles.json`](../configs/roles.json) | **独立角色配置** — 4 种角色的详细权限属性（优先级、可见性、编辑权限等） |
| [`configs/users.json`](../configs/users.json) | 用户配置文件（7 个用户，仅含用户基本信息） |
| [`backend/src/privacy/accessControl.ts`](../backend/src/privacy/accessControl.ts) | 权限校验模块：RBAC + ABAC + 操作鉴权 |
| [`backend/src/privacy/viewBuilder.ts`](../backend/src/privacy/viewBuilder.ts) | 正向视图变换：Master Doc → 用户专属视图树 |
| [`backend/src/privacy/inverseMapper.ts`](../backend/src/privacy/inverseMapper.ts) | 逆向映射：视图操作 → Master Doc 操作 + 权限校验 |
| [`tmp/test-privacy-view.html`](../tmp/test-privacy-view.html) | 隐私视图测试面板（可视化测试工具） |

### 2.2 修改文件

| 文件 | 说明 |
|------|------|
| [`backend/src/server.ts`](../backend/src/server.ts) | 新增 5 个安全相关 API（含 `/api/roles`） |
| [`backend/src/crdt/masterDoc.ts`](../backend/src/crdt/masterDoc.ts) | 示例数据增加 `leader` 角色支持 |
| [`configs/users.json`](../configs/users.json) | **移除** roles/policies 字段，角色配置抽离到 `roles.json` |

---

## 3. 用户与权限模型

### 3.1 角色配置（独立管理）

角色配置已从 `users.json` 中抽离，独立为 [`configs/roles.json`](../configs/roles.json)，由 [`accessControl.ts`](../backend/src/privacy/accessControl.ts) 的 `loadRolesConfig()` 加载并缓存。

| 角色 | 优先级 | 描述 | 关键属性 |
|------|--------|------|---------|
| `admin` | 100 | 管理员 — 可访问和编辑所有节点 | `canViewAll: true`, `canEditAll: true`, `allowedVisibilities: ["public","group","private"]` |
| `leader` | 80 | 组长 — 可访问 public 和本组 group 节点 | `canEditOwnGroup: true`, `allowedVisibilities: ["public","group"]` |
| `member` | 60 | 成员 — 可访问 public 和本组 group 节点 | `canEditOwnGroup: true`, `allowedVisibilities: ["public","group"]` |
| `guest` | 10 | 访客 — 仅可查看 public 节点，无权编辑 | `canEditOwnGroup: false`, `allowedVisibilities: ["public"]` |

**角色配置结构**：
```json
{
  "roles": {
    "admin": {
      "priority": 100,
      "description": "管理员 — 可访问和编辑所有节点",
      "canViewAll": true,
      "canEditAll": true,
      "canManageUsers": true,
      "allowedVisibilities": ["public", "group", "private"]
    },
    "member": {
      "priority": 60,
      "canViewAll": false,
      "canEditAll": false,
      "allowedVisibilities": ["public", "group"],
      "canEditOwnGroup": true
    }
  }
}
```

编辑权限规则现在动态从角色配置读取（[`accessControl.ts:177-195`](../backend/src/privacy/accessControl.ts:177)）：

```typescript
export function canEditNode(user: UserInfo, node: TreeNode): boolean {
  const roleConfig = getRoleConfig(user.role);
  if (!roleConfig) return false;
  if (roleConfig.canEditAll) return true;        // admin 通吃
  if (!roleConfig.canEditOwnGroup) return false;  // guest 禁止编辑
  // ... 进一步校验
}
```

### 3.2 用户角色（简表）

| 角色 | 优先级 | 权限 | 示例用户 |
|------|--------|------|----------|
| `admin` | 100 | 完全访问，可看/编辑所有节点 | admin01 (管理员) |
| `leader` | 80 | 可访问 public、本组 group 节点 | leaderA, leaderB |
| `member` | 60 | 可访问 public 和本组 group 节点 | memberA1, memberA2, memberB1 |
| `guest` | 10 | 仅可访问 public 节点 | guest01 (访客) |

### 3.3 用户分组

| 组 | 用户 |
|----|------|
| `admin` | admin01 |
| `groupA` | leaderA, memberA1, memberA2 |
| `groupB` | leaderB, memberB1 |
| `guest` | guest01 |

### 3.4 节点可见性模型

```
项目文档 (root, public, all)          ← 所有人可见
├── 📄 公开介绍 (public, all)          ← 所有人可见
├── 👥 A组任务 (group, groupA)         ← admin + A组用户可见
├── 👥 B组任务 (group, groupB)         ← admin + B组用户可见
└── 🔒 管理员备注 (private, admin)     ← 仅 admin 可见
```

---

## 4. 两种隐私策略实现

### 4.1 RBAC（基于角色的访问控制）

定义于 [`accessControl.ts:76-91`](../backend/src/privacy/accessControl.ts:76)

**规则**：用户的 `role` 必须在节点的 `allowedRoles` 列表中。

```typescript
// 伪代码
function checkRBAC(user, node): boolean {
  if (user.role === "admin") return true;       // admin 通吃
  return node.allowedRoles.includes(user.role);  // 检查角色白名单
}
```

**节点配置示例**：
```json
{
  "title": "管理员备注",
  "allowedRoles": ["admin"]     // 只有 admin 角色可以访问
}
```

### 4.2 ABAC（基于节点属性的访问控制）

定义于 [`accessControl.ts:98-133`](../backend/src/privacy/accessControl.ts:98)

**规则**：根据节点的 `visibility` 和 `ownerGroup` 判断：

| visibility | 规则 |
|-----------|------|
| `public` | 所有用户可见 |
| `group` | 仅同组用户可见（`user.group === node.ownerGroup`） |
| `private` | 仅 admin 可见 |

### 4.3 组合策略

两种策略**同时生效**：`canAccessNode = checkRBAC(user, node) && checkABAC(user, node)`

---

## 5. 核心流程

### 5.1 正向视图变换

```
Master Y.Doc (完整树, 5节点)
       │
       ▼
 canAccessNode()  ← RBAC + ABAC 双重检查
       │
       ▼
User View Tree (只含权限内的节点)
       │
       ├── viewNodeId → realNodeId 映射表
       └── 统计信息 (total/visible/filtered)
```

实现于 [`viewBuilder.ts`](../backend/src/privacy/viewBuilder.ts) 的 [`buildUserView()`](../backend/src/privacy/viewBuilder.ts:73) 方法。

### 5.2 逆向映射与权限校验

```
用户视图操作 (update/insert/delete)
       │
       ▼
 mapAndValidateOperation()
       │
       ├── viewNodeId → realNodeId 映射
       ├── canEditNode() 权限校验
       │
       ├── 通过 → 写入 Master Y.Doc
       └── 拒绝 → 返回 403 + 日志记录
```

实现于 [`inverseMapper.ts`](../backend/src/privacy/inverseMapper.ts) 的 [`mapAndValidateOperation()`](../backend/src/privacy/inverseMapper.ts:85) 方法。

### 5.3 编辑权限规则

定义于 [`accessControl.ts:152-185`](../backend/src/privacy/accessControl.ts:152)

| 角色 | public | group (同组) | group (异组) | private |
|------|--------|-------------|-------------|---------|
| admin | ✅ | ✅ | ✅ | ✅ |
| leader | ✅ | ✅ | ❌ | ❌ |
| member | ✅ | ✅ | ❌ | ❌ |
| guest | ❌ | ❌ | ❌ | ❌ |

---

## 6. API 接口

### 6.1 新增接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/users` | 获取所有用户列表（用于前端用户切换） |
| `GET` | `/api/view/:userId` | **核心接口**：获取指定用户的专属视图树 |
| `POST` | `/api/operation` | **核心接口**：用户提交视图操作 + 权限校验 |
| `GET` | `/api/roles` | 获取所有角色配置及详细属性 |
| `POST` | `/api/reload-users` | 重新加载用户配置和角色配置（无需重启） |

### 6.2 GET /api/view/:userId 响应示例

```json
{
  "status": "ok",
  "view": {
    "userId": "memberA1",
    "userName": "A组成员1",
    "role": "member",
    "group": "groupA",
    "tree": {
      "viewNodeId": "root",
      "realNodeId": "root",
      "title": "项目文档",
      "children": [
        {
          "viewNodeId": "n1-uuid",
          "realNodeId": "n1-uuid",
          "title": "公开介绍",
          "visibility": "public"
        },
        {
          "viewNodeId": "n2-uuid",
          "realNodeId": "n2-uuid",
          "title": "A组任务",
          "visibility": "group",
          "ownerGroup": "groupA"
        }
      ]
    },
    "stats": {
      "totalNodes": 5,
      "visibleNodes": 3,
      "filteredNodes": 2
    }
  }
}
```

### 6.3 POST /api/operation 请求/响应

**请求体**：
```json
{
  "userId": "memberA1",
  "operation": {
    "type": "update",
    "viewNodeId": "n2-uuid",
    "payload": { "title": "A组任务-已完成" }
  }
}
```

**成功响应（200）**：
```json
{ "status": "accepted", "message": "节点已更新" }
```

**拒绝响应（403）**：
```json
{
  "status": "rejected",
  "message": "用户 memberA1 无权修改节点 \"B组任务\"",
  "operationType": "update"
}
```

---

## 7. 验证结果

### 7.1 视图隔离测试

| 用户 | 角色 | 可见节点 | 过滤节点 | 验证 |
|------|------|---------|---------|------|
| admin01 | admin | 5/5 | 0 | ✅ 全部可见 |
| leaderA | leader | 3/5 | 2 | ✅ 公开 + A组任务 |
| memberA1 | member | 3/5 | 2 | ✅ 公开 + A组任务 |
| memberB1 | member | 3/5 | 2 | ✅ 公开 + B组任务 |
| guest01 | guest | 2/5 | 3 | ✅ 仅公开节点 |

### 7.2 权限校验测试

| 测试场景 | 结果 | 说明 |
|----------|------|------|
| memberA1 更新 A组任务 | ✅ 通过 | 同组成员可编辑 |
| memberA1 更新 B组任务 | ❌ 拒绝 403 | 越权操作被拦截 |
| guest01 更新公开介绍 | ❌ 拒绝 403 | guest 无编辑权限 |
| admin01 在 root 下添加节点 | ✅ 通过 | admin 可管理所有节点 |
| memberA1 在公开介绍下添加子节点 | ✅ 通过 | public 节点可编辑 |

### 7.3 完整流程验证

```
memberA1 视图:
  项目文档 (public)
  ├── 公开介绍 (public)
  │   └── A组的具体任务 (group)      ← 由 memberA1 添加
  └── A组任务 (group)

guest01 视图:
  项目文档 (public)
  └── 公开介绍 (public)
                                         ← B组任务、管理员备注、A组任务不可见
```

---

## 8. 测试工具

[`tmp/test-privacy-view.html`](../tmp/test-privacy-view.html) — 隐私视图可视化测试面板。

**功能**：
- 用户切换（7 个用户一键切换）
- 视图树展示（颜色标识 public/group/private）
- 实时操作测试（添加/修改/删除 + 权限校验）
- 多用户视图对比
- 一键运行安全验证测试（6 项自动化测试）
- 完整操作日志

**使用方式**：
```bash
# 1. 启动后端
cd backend && npm run dev

# 2. 浏览器打开
open tmp/test-privacy-view.html
```

---

## 9. 项目结构（第3步完成后）

```
privacy-crdt-editor/
├── backend/
│   ├── src/
│   │   ├── crdt/
│   │   │   └── masterDoc.ts              ← 修改：增加 leader 角色支持
│   │   ├── privacy/
│   │   │   ├── accessControl.ts           ← 新增：RBAC + ABAC 权限校验
│   │   │   ├── viewBuilder.ts             ← 新增：正向视图变换
│   │   │   └── inverseMapper.ts           ← 新增：逆向映射 + 权限校验
│   │   └── server.ts                      ← 修改：新增安全 API
│   ├── package.json
│   └── tsconfig.json
├── configs/
│   ├── roles.json                         ← 新增：独立角色配置（4 种角色属性）
│   └── users.json                         ← 新增：用户配置（7 个用户，角色引用 roles.json）
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── App.css
├── tmp/
│   ├── crdt.txt
│   ├── 对话和后续.txt
│   ├── step2-progress.md
│   ├── step3-progress.md                  ← 新增：本进度文档
│   ├── test-master-doc.html
│   └── test-privacy-view.html             ← 新增：隐私视图测试面板
└── readme.md
```

---

## 10. 角色配置抽离说明

角色配置从 `users.json` 抽离到独立的 `roles.json`，带来以下好处：

1. **关注点分离** — `users.json` 只管理用户与角色的关联，`roles.json` 专注定义角色本身的属性
2. **配置复用** — 角色配置可被多个策略模块引用（RBAC 校验、前端展示、审计日志）
3. **动态扩展** — 新增角色无需修改权限校验代码，只需在 `roles.json` 添加配置
4. **前端感知** — 通过 `GET /api/roles` 接口，前端可动态展示每种角色的详细权限说明
5. **热加载** — `POST /api/reload-users` 同时刷新用户缓存和角色缓存

```typescript
// server.ts — /api/roles 响应示例
{
  "status": "ok",
  "roles": {
    "admin": { "priority": 100, "description": "管理员", "canViewAll": true, ... },
    "leader": { "priority": 80, "description": "组长", "canEditOwnGroup": true, ... },
    "member": { "priority": 60, "allowedVisibilities": ["public", "group"], ... },
    "guest": { "priority": 10, "canEditOwnGroup": false, ... }
  }
}
```

---

## 11. 关键技术决策

1. **双层策略（RBAC + ABAC）** — 同时检查角色白名单和节点属性，满足题目"至少两种隐私策略"的要求
2. **viewNodeId === realNodeId** — 简化正向映射设计，视图节点 ID 直接使用真实节点 UUID
3. **编辑权限 > 查看权限** — guest 可以看到 public 节点但不能编辑，体现更细粒度的控制
4. **服务端唯一真相源** — 所有权限校验、数据写入都在服务端完成，客户端只展示视图
5. **操作日志** — 服务端记录每次操作的 `[ACCESS GRANTED]` 和 `[ACCESS DENIED]`，支持安全审计

---

## 12. 后续步骤计划

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 第4步 | 前端树形编辑界面（React） | 第3步 ✅ |
| 第5步 | 多用户视图同步（WebSocket） | 第4步 |
| 第6步 | 离线编辑模拟 | 第5步 |
| 第7步 | 测试、文档、演示 | 第1-6步 |
