# 第4步进度报告：正向视图变换 — 完整文档 → 用户专属视图

> **项目**：基于 Yjs 的隐私保护结构化数据协同编辑器
> **步骤**：第4步 — 正向视图变换（完整文档 → 用户专属视图）
> **状态**：✅ 已完成
> **日期**：2026-05-14

---

## 1. 目标概述

实现**正向视图变换**（Forward View Transformation）：服务端根据用户的角色（RBAC）和节点属性（ABAC），将 Master Y.Doc 完整文档树动态生成为该用户专属的视图树。

**核心原则**：
- 客户端永远不直接接触 Master Y.Doc
- 每个用户只拿到自己有权限看到的数据
- 服务端是唯一的真相来源（single source of truth）

---

## 2. 实现文件

| 文件 | 说明 |
|------|------|
| [`backend/src/privacy/viewBuilder.ts`](../backend/src/privacy/viewBuilder.ts) | **核心**：视图构建器，递归过滤不可见节点，生成视图树 + 映射表 |
| [`backend/src/privacy/accessControl.ts`](../backend/src/privacy/accessControl.ts) | 权限引擎：RBAC + ABAC 双重过滤 |
| [`backend/src/server.ts`](../backend/src/server.ts) | API 层：`GET /api/view/:userId` 触发正向视图变换 |

---

## 3. 正向视图变换流程

```
Master Y.Doc (完整树, 5节点)
       │
       ▼
  buildUserView(masterTree, user)
       │
       ├── buildViewNode() 递归遍历每个节点
       │       │
       │       ├── canAccessNode()  ← RBAC + ABAC 双重检查
       │       │       │
       │       │       ├── checkRBAC(): 用户 role ∈ node.allowedRoles?
       │       │       └── checkABAC(): visibility 策略检查
       │       │               ├── public → 所有人可见
       │       │               ├── group  → 同组用户可见
       │       │               └── private → 仅 admin 可见
       │       │
       │       ├── 通过 → 创建 ViewNode（含 viewNodeId ↔ realNodeId 映射）
       │       ├── 拒绝 → 记录 filteredCount，返回 null
       │       └── 递归处理子节点
       │
       └── UserView {
             tree: ViewNode (用户可见的子树),
             mapping: ViewMapping[] (viewNodeId → realNodeId),
             filteredCount: number,
             totalNodeCount: number,
             visibleNodeCount: number
           }
```

### 3.1 关键数据结构

**ViewNode** — 用户在前端看到的视图节点：
```typescript
interface ViewNode {
  viewNodeId: string;          // 视图节点 ID
  realNodeId: string;          // 对应 Master Doc 的真实节点 ID
  title: string;
  content: string;
  visibility: "public" | "group" | "private";
  ownerGroup: string;
  children: ViewNode[];
}
```

**UserView** — 完整用户视图结果：
```typescript
interface UserView {
  userId: string;
  userName: string;
  role: string;
  group: string;
  tree: ViewNode | null;
  mapping: ViewMapping[];
  filteredCount: number;       // 被过滤的节点数
  totalNodeCount: number;      // 完整树节点数
  visibleNodeCount: number;    // 可见节点数
}
```

**ViewMapping** — 视图节点到真实节点的映射：
```typescript
interface ViewMapping {
  viewNodeId: string;
  realNodeId: string;
}
```

---

## 4. 双重权限过滤策略

### 4.1 RBAC（基于角色的访问控制）— [`accessControl.ts:91-103`](../backend/src/privacy/accessControl.ts:91)

```typescript
function checkRBAC(user: UserInfo, node: TreeNode): boolean {
  if (user.role === "admin") return true;       // admin 通吃
  return node.allowedRoles.includes(user.role);  // 检查角色白名单
}
```

每个节点配置 `allowedRoles` 数组，只有列表中的角色可以访问。

### 4.2 ABAC（基于节点属性的访问控制）— [`accessControl.ts:116-141`](../backend/src/privacy/accessControl.ts:116)

```typescript
function checkABAC(user: UserInfo, node: TreeNode): boolean {
  switch (node.visibility) {
    case "public":  return true;                          // 所有人
    case "group":   return user.group === node.ownerGroup; // 同组
    case "private": return user.role === "admin";          // 仅 admin
  }
}
```

### 4.3 组合策略 — [`accessControl.ts:150-160`](../backend/src/privacy/accessControl.ts:150)

两种策略**同时生效**，必须都通过才允许访问：
```typescript
function canAccessNode(user: UserInfo, node: TreeNode): boolean {
  return checkRBAC(user, node) && checkABAC(user, node);
}
```

---

## 5. API 接口

### GET `/api/view/:userId` — [`server.ts:594-626`](../backend/src/server.ts:594)

核心接口：获取指定用户的专属视图树。

**请求示例**：
```bash
GET /api/view/leaderA
```

**响应示例**（格式化后）：
```json
{
  "status": "ok",
  "view": {
    "userId": "leaderA",
    "userName": "A组组长",
    "role": "leader",
    "group": "groupA",
    "tree": {
      "viewNodeId": "root",
      "realNodeId": "root",
      "title": "项目文档",
      "visibility": "public",
      "children": [
        { "viewNodeId": "...", "title": "公开介绍", "visibility": "public", "children": [] },
        { "viewNodeId": "...", "title": "A组任务", "visibility": "group", "ownerGroup": "groupA", "children": [] }
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

---

## 6. 验证结果 — 全覆盖测试

所有测试通过 ✅

### 6.1 admin01（管理员）

| 节点 | visibility | RBAC 检查 | ABAC 检查 | 结果 |
|------|-----------|-----------|-----------|------|
| 项目文档 (root) | public | ✅ admin 通吃 | ✅ root 始终可见 | ✅ 可见 |
| 公开介绍 | public | ✅ admin 通吃 | ✅ public | ✅ 可见 |
| A组任务 | group | ✅ admin 通吃 | ✅ admin 通吃 | ✅ 可见 |
| B组任务 | group | ✅ admin 通吃 | ✅ admin 通吃 | ✅ 可见 |
| 管理员备注 | private | ✅ admin 通吃 | ✅ admin 通吃 | ✅ 可见 |

**统计**：5/5 可见，0 过滤 ✅

### 6.2 leaderA（A组组长）

| 节点 | RBAC 检查 | ABAC 检查 | 结果 |
|------|-----------|-----------|------|
| 项目文档 (root) | ✅ root 始终可见 | ✅ root 始终可见 | ✅ 可见 |
| 公开介绍 | ✅ leader ∈ allowedRoles | ✅ public | ✅ 可见 |
| A组任务 | ✅ leader ∈ allowedRoles | ✅ leaderA.group === ownerGroup(groupA) | ✅ 可见 |
| B组任务 | ✅ leader ∈ allowedRoles | ❌ leaderA.group(groupA) !== ownerGroup(groupB) | ❌ 过滤 |
| 管理员备注 | ❌ leader ∉ allowedRoles([admin]) | ❌ private 仅 admin | ❌ 过滤 |

**统计**：3/5 可见，2 过滤 ✅

### 6.3 memberA1（A组成员）

**统计**：3/5 可见，2 过滤 ✅（与 leaderA 结果一致，符合预期）

### 6.4 memberB1（B组成员）

**统计**：3/5 可见（root + 公开介绍 + B组任务），2 过滤（A组任务 + 管理员备注）✅

### 6.5 guest01（访客）

| 节点 | RBAC 检查 | ABAC 检查 | 结果 |
|------|-----------|-----------|------|
| 项目文档 (root) | ✅ root 始终可见 | ✅ root 始终可见 | ✅ 可见 |
| 公开介绍 | ✅ guest ∈ allowedRoles | ✅ public | ✅ 可见 |
| A组任务 | ❌ guest ∉ allowedRoles([admin,leader,member]) | ❌ group 非同组 | ❌ 过滤 |
| B组任务 | ❌ guest ∉ allowedRoles | ❌ group 非同组 | ❌ 过滤 |
| 管理员备注 | ❌ guest ∉ allowedRoles([admin]) | ❌ private | ❌ 过滤 |

**统计**：2/5 可见，3 过滤 ✅

### 6.6 汇总表

| 用户 | 角色/组 | 可见 | 过滤 | 可见节点 |
|------|---------|:----:|:----:|---------|
| admin01 | admin | **5/5** | 0 | 全部：公开介绍 + A组任务 + B组任务 + 管理员备注 |
| leaderA | leader/groupA | **3/5** | 2 | 公开介绍 + A组任务 |
| memberA1 | member/groupA | **3/5** | 2 | 公开介绍 + A组任务 |
| memberB1 | member/groupB | **3/5** | 2 | 公开介绍 + B组任务 |
| guest01 | guest | **2/5** | 3 | 仅公开介绍 |

---

## 7. 核心实现代码

### 7.1 视图构建器 — [`viewBuilder.ts:57-75`](../backend/src/privacy/viewBuilder.ts:57)

```typescript
export function buildViewTree(
  masterTree: FlatTreeNode,
  user: UserInfo
): ViewNode | null {
  return buildViewNode(masterTree, user, mapping, countTotal, countFiltered);
}
```

### 7.2 递归过滤 — [`viewBuilder.ts:125-185`](../backend/src/privacy/viewBuilder.ts:125)

```typescript
function buildViewNode(node, user, mapping, countTotal, countFiltered): ViewNode | null {
  countTotal();

  // 双重权限检查
  if (!canAccessNode(user, nodeForCheck)) {
    countFiltered();
    return null;  // 不可见 → 过滤
  }

  // 递归处理子节点（子节点不可见不影响父节点）
  const visibleChildren = node.children.map(child =>
    buildViewNode(child, user, mapping, countTotal, countFiltered)
  ).filter(Boolean);

  // 创建视图节点 + 记录映射
  const viewNode = { viewNodeId: node.id, realNodeId: node.id, ... };
  mapping.push({ viewNodeId: node.id, realNodeId: node.id });
  return viewNode;
}
```

**关键设计**：
1. 父节点可见时，即使子节点全部被过滤，父节点依然显示（保持树结构）
2. 已删除节点的内容显示为"`(该节点已被删除)`"
3. `viewNodeId === realNodeId` — 简化正向+逆向映射的一致性

---

## 8. 安全架构

```
┌─────────────────────────────────────────────────────┐
│                    服务端                             │
│                                                      │
│  ┌─────────────────────────────────┐                │
│  │  Master Y.Doc (完整文档)         │                │
│  │  - nodes: Y.Map<TreeNode>       │                │
│  │  - children: Y.Map<string[]>    │                │
│  └────────┬────────────────────────┘                │
│           │                                          │
│           ▼                                          │
│  ┌─────────────────────────────────┐                │
│  │  canAccessNode() ← RBAC + ABAC  │                │
│  └────────┬────────────────────────┘                │
│           │                                          │
│           ▼                                          │
│  ┌─────────────────────────────────┐                │
│  │  User View Tree (专属视图)       │                │
│  │  - 仅包含用户有权限的节点         │                │
│  │  - 附有 viewNodeId→realNodeId   │                │
│  │    映射表（用于后续逆向映射）     │                │
│  └─────────────────────────────────┘                │
│           │                                          │
└───────────┼──────────────────────────────────────────┘
            │  REST API (仅返回视图)
            ▼
┌─────────────────────────────────────────────────────┐
│                 客户端                                │
│  用户只能看到自己的视图，无法接触到完整文档           │
└─────────────────────────────────────────────────────┘
```

---

## 9. 后续步骤

正向视图变换完成后，第5步将实现**逆向映射**（视图操作 → 完整文档操作）：
- 用户在视图上编辑 → 通过映射表找到真实节点
- 权限校验 → 写入 Master Y.Doc
- 重新生成所有用户的视图（实现多用户同步）

当前 [`inverseMapper.ts`](../backend/src/privacy/inverseMapper.ts) 和 [`server.ts`](../backend/src/server.ts) 中的 `POST /api/operation` 接口已预先实现逆向映射的完整框架，可直接在第5步中验证。
