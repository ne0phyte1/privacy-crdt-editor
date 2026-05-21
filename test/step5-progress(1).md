# 第5步进度报告：逆向映射 — 用户视图操作 → 完整文档操作

> **项目**：基于 Yjs 的隐私保护结构化数据协同编辑器
> **步骤**：第5步 — 逆向映射（用户视图操作 → 完整文档操作）
> **状态**：✅ 已完成
> **日期**：2026-05-14

---

## 1. 目标概述

实现**逆向映射**（Inverse Mapping）：用户在视图上的操作（insert/update/delete）经过逆向映射转换为完整文档（Master Y.Doc）操作，并执行权限校验后写入。

**核心原则**：
- 用户只在自己视图内操作，无法接触到完整文档
- `viewNodeId → realNodeId` 映射表解决视图到真实的转换
- 每一笔操作必须经过 `canEditNode()` 权限校验
- **JWT 认证**：`userId` 从 token 提取，禁止从请求体伪造

---

## 2. 实现文件

| 文件 | 说明 | 变更类型 |
|------|------|---------|
| [`backend/src/privacy/inverseMapper.ts`](../backend/src/privacy/inverseMapper.ts) | **核心**：逆向映射引擎，处理 insert/update/delete 三种操作类型 | ✅ 已有（完善） |
| [`backend/src/privacy/accessControl.ts`](../backend/src/privacy/accessControl.ts) | 权限引擎：`canEditNode()` 判断用户能否编辑节点 | ✅ 已有 |
| [`backend/src/server.ts`](../backend/src/server.ts:628) | API 层：`POST /api/operation` 端点，添加 `requireAuth` 中间件 | 🔧 **修改** |
| [`tmp/test-privacy-operation.html`](../tmp/test-privacy-operation.html) | **测试面板**：逆向映射全流程测试（含 JWT 认证） | 🆕 **新增** |

---

## 3. 逆向映射流程

```
POST /api/operation
     │
     ├── requireAuth() ← 🔐 【新增】从 JWT 提取 userId，禁止请求体传参
     │       │
     │       ├── 无 Token → 401 "未提供认证令牌"
     │       └── Token 无效 → 401 "认证令牌无效或已过期"
     │
     ├── mapAndValidateOperation()
     │       │
     │       ├── handleInsert()
     │       │       ├── 父节点 ID 即真实节点 ID
     │       │       ├── canEditNode() 权限校验
     │       │       └── 返回 MasterOperation（含 parentRealNodeId）
     │       │
     │       ├── handleUpdate()
     │       │       ├── mapViewToReal() → realNodeId
     │       │       ├── canEditNode() 权限校验
     │       │       └── 返回 MasterOperation（含 realNodeId + payload）
     │       │
     │       └── handleDelete()
     │               ├── mapViewToReal() → realNodeId
     │               ├── root 节点保护（不可删除）
     │               ├── canEditNode() 权限校验
     │               └── 返回 MasterOperation（含 realNodeId）
     │
     ├── 校验通过 → 写入 Master Y.Doc（insertNode / updateNode / deleteNode）
     │       └── 记录操作日志（operation_logs）
     │
     └── 校验拒绝 → 403 "无权修改该节点"
```

### 3.1 关键数据结构

**ViewOperation** — 用户提交的视图操作：
```typescript
interface ViewOperation {
  type: "insert" | "update" | "delete";
  viewNodeId?: string;           // 视图节点 ID
  parentViewNodeId?: string;     // 父视图节点 ID（insert 时）
  payload: {
    title?, content?,
    visibility?, ownerGroup?, allowedRoles?
  };
}
```

**MasterOperation** — 映射后的真实操作：
```typescript
interface MasterOperation {
  type: "insert" | "update" | "delete";
  realNodeId?: string;           // 真实节点 ID
  parentRealNodeId?: string;     // 父节点真实 ID
  payload: { ... };
}
```

**OperationResult** — 校验结果：
```typescript
interface OperationResult {
  allowed: boolean;
  masterOp: MasterOperation | null;
  realNode: TreeNode | null;
  message: string;
}
```

---

## 4. 安全性增强

### 4.1 问题发现：原文 [`POST /api/operation`](backend/src/server.ts:632) 直接从请求体取 `userId`

```typescript
// ⚠️ 安全问题：userId 从请求体获取，可被任意伪造
const { userId, operation } = req.body;
```

**攻击场景**：攻击者可以任意指定 `userId` 冒充其他用户提交操作。

### 4.2 修复方案：添加 `requireAuth` 中间件 + 从 JWT 获取用户

修改后（[`server.ts:633-637`](backend/src/server.ts:633)）：
```typescript
app.post("/api/operation", requireAuth, (req: any, res) => {
  // 从 JWT 中获取当前用户信息（禁止从请求体取 userId）
  const jwtUser = req.currentUser as JwtPayload;
  const userId = jwtUser.userId;
```

**安全链条**：
```
客户端登录 → 获得 JWT（含 userId/role/group）
            ↓
请求 API → 携带 Authorization: Bearer <JWT>
            ↓
requireAuth 中间件 → 验证 JWT → 解析出 currentUser
            ↓
操作处理 → 从 currentUser 取 userId（信任来源）
            ↓
权限校验 → canEditNode(user, realNode) ← 基于 JWT 中的 role/group
```

---

## 5. 冒烟测试结果（修复后 — 所有场景通过）

### 5.1 测试环境

使用 `curl` 模拟完整逆向映射流程，覆盖身份认证、权限校验、越权拦截、root 保护等全部场景。

```
服务器：http://localhost:3001（SQLite 数据库）
```

### 5.2 测试结果

| 测试 | 结果 | 说明 |
|:-----|:----:|:-----|
| 未认证请求（无 JWT） | `HTTP 401` | requireAuth 中间件正确拦截 |
| Admin 插入节点（带 JWT） | `accepted` + `realNodeId` | 管理员 `canEditAll: true` |
| Admin 删除自己的节点（通过缓存 realNodeId） | `accepted` | 精确 ID 删除，不再按标题搜索 |
| memberA1 编辑 B组任务（跨组越权） | `rejected` | ABAC 组策略正确拦截 |
| guest01 编辑公开节点（访客无编辑权） | `rejected` | RBAC role 策略正确拦截 |
| Admin 删除 root 节点 | `rejected` | root 保护正常 |

### 5.3 服务器日志输出

```
[ACCESS GRANTED] 用户 admin01 (admin/admin) 操作成功: 节点已添加
[ACCESS GRANTED] 用户 admin01 (admin/admin) 操作成功: 节点已逻辑删除
[ACCESS DENIED] 用户 memberA1 操作被拒绝: 用户 memberA1 无权修改节点 "B组任务"
[ACCESS DENIED] 用户 guest01 操作被拒绝: 用户 guest01 无权修改节点 "公开介绍"
[ACCESS DENIED] 用户 admin01 操作被拒绝: 不能删除根节点
```

### 5.4 修复问题记录

| 问题 | 根因 | 修复 |
|:-----|:-----|:-----|
| `apiPost()` 在 403 时抛异常 | 对任意非 2xx HTTP 状态码直接抛错，而未先解析 JSON body | 先 `res.json()` 解析 body，只有 body 不含 `status` 字段才抛异常 |
| Admin 删除节点测试失败 | 使用 `find(c => c.title === "Admin插入测试")` 从视图树搜索，但旧测试运行遗留了多个同名已删除节点 | 缓存 `adminNodeId`（来自 insert 响应），直接用 ID 删除 |
| 子任务删除测试失败 | 同上，标题搜索找到已删除节点 | 缓存 `subtaskId`，改用唯一标题 `"子任务_测试"` + `===` 精确匹配 |

---

## 6. 测试面板

测试文件 [`tmp/test-privacy-operation.html`](../tmp/test-privacy-operation.html) 提供了完整的逆向映射测试功能：

### 6.1 功能列表

| 功能 | 说明 |
|------|------|
| **JWT 登录** | 自动预登录所有 7 个用户，缓存 JWT |
| **用户切换** | 点击用户按钮自动切换，显示 JWT 状态 |
| **视图树展示** | 带 viewNodeId → realNodeId 的完整视图树 |
| **映射表** | viewNodeId ↔ realNodeId 对照表（用于验证逆向映射正确性） |
| **操作执行** | 支持 insert / update / delete 三种操作类型 |
| **操作历史** | 记录每笔操作的 userId + 类型 + 结果 |
| **Master 树查看** | 在新窗口中查看完整树（验证视图与 Master 的对应关系） |
| **安全测试套件** | 一键运行 11 项逆向映射安全测试 |

### 6.2 测试用例覆盖

| # | 测试名称 | 验证内容 | 状态 |
|:-:|---------|---------|:---:|
| 1 | 未携带 JWT 的操作被拒绝 | 身份认证 | ✅ |
| 2 | Admin 可以插入新节点 | `canEditAll: true` | ✅ |
| 3 | Admin 可以更新公开节点 | 合法操作 | ✅ |
| 4 | Admin 可以删除自己创建的节点 | `realNodeId` 缓存删除 | ✅ |
| 5 | memberA1 允许更新 A组任务（本人所属组） | 组内编辑权 | ✅ |
| 6 | memberA1 拒绝修改 B组任务（越权） | ⛔ 跨组 ABAC 拦截 | ✅ |
| 7 | memberA1 拒绝删除 B组任务（越权） | ⛔ 跨组 ABAC 拦截 | ✅ |
| 8 | guest01 拒绝编辑公开节点（角色无编辑权） | ⛔ RBAC 角色限制 | ✅ |
| 9 | leaderA 允许在 A组任务下插入子节点 | 合法操作 | ✅ |
| 10 | memberA1 能看到 leaderA 插入的子节点 | 视图同步 | ✅ |
| 11 | guest01 看不到 A组的子节点 | 权限隔离 | ✅ |
| 12 | Admin 可以删除刚插入的子任务（清理） | `subtaskId` 缓存删除 | ✅ |
| 13 | 任何用户不能删除根节点（root 保护） | ⛔ root 保护 | ✅ |

> **总计：13/13 全部通过 ✅**

### 6.3 关键修复：`apiPost()` 函数正确处理 403

在 [`tmp/test-privacy-operation.html:546-558`](../tmp/test-privacy-operation.html:546) 中，修复后的逻辑：

```javascript
async function apiPost(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // ✅ 只有非 2xx 且 body 不含 status 字段时才视为网络错误
  if (!res.ok && !data.status && !data.allowed) throw new Error(`HTTP ${res.status}`);
  return data;
}
```

### 6.4 关键修复：使用缓存的 `realNodeId` 替代标题搜索

**插入操作**：缓存 `realNodeId` 供后续删除使用
```javascript
const result = await apiPost("/api/operation", { operation: {...} }, token);
if (result.status === "accepted" && result.realNodeId) adminNodeId = result.realNodeId;
```

**删除操作**：直接用缓存的 ID，避免旧节点干扰
```javascript
const r = await apiPost("/api/operation", {
  operation: { type: "delete", viewNodeId: adminNodeId, payload: {} }
}, token);
adminNodeId = null;
```

---

## 7. 核心实现代码

### 7.1 逆向映射入口 — [`inverseMapper.ts:67-89`](../backend/src/privacy/inverseMapper.ts:67)

```typescript
export function mapAndValidateOperation(
  viewOp: ViewOperation,
  user: UserInfo,
  masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  switch (viewOp.type) {
    case "insert":  return handleInsert(viewOp, user, masterTree, getNode);
    case "update":  return handleUpdate(viewOp, user, masterTree, mappings, getNode);
    case "delete":  return handleDelete(viewOp, user, masterTree, mappings, getNode);
  }
}
```

### 7.2 插入操作处理 — [`inverseMapper.ts:95-153`](../backend/src/privacy/inverseMapper.ts:95)

```typescript
function handleInsert(viewOp, user, _masterTree, getNode): OperationResult {
  const parentViewNodeId = viewOp.parentViewNodeId;
  // viewNodeId === realNodeId（简化映射），父节点 ID 直接作为真实节点 ID
  const parentRealNodeId = parentViewNodeId;
  const parentNode = getNode(parentRealNodeId);

  // 检查用户是否有权限在父节点下添加子节点
  if (!canEditNode(user, parentNode)) {
    return { allowed: false, message: `用户无权在父节点下添加子节点` };
  }

  return { allowed: true, masterOp: { type: "insert", parentRealNodeId, payload } };
}
```

### 7.3 更新/删除处理 — [`inverseMapper.ts:159-285`](../backend/src/privacy/inverseMapper.ts:159)

```typescript
function handleUpdate(viewOp, user, _masterTree, mappings, getNode): OperationResult {
  const realNodeId = mapViewToReal(viewNodeId, mappings); // viewNodeId → realNodeId
  const realNode = getNode(realNodeId);

  if (!canEditNode(user, realNode)) {
    return { allowed: false, message: `用户无权修改节点` };
  }
  return { allowed: true, masterOp: { type: "update", realNodeId, payload } };
}
```

### 7.4 视图到真实节点映射 — [`inverseMapper.ts:294-297`](../backend/src/privacy/inverseMapper.ts:294)

```typescript
function mapViewToReal(viewNodeId: string, mappings: ViewMapping[]): string {
  const mapping = mappings.find((m) => m.viewNodeId === viewNodeId);
  return mapping ? mapping.realNodeId : viewNodeId;
}
```

由于当前设计 `viewNodeId === realNodeId`（简化映射），该函数主要保持接口一致性，为未来支持不同的视图/真实节点 ID 预留。

---

## 8. 完整安全架构

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端                                    │
│  ┌─────────────┐    ┌──────────────────────┐               │
│  │ 用户操作     │    │ JWT (userId/role)    │               │
│  │ {viewOp}    │    │ Authorization: Bearer │               │
│  └──────┬──────┘    └─────────┬────────────┘               │
│         │                     │                             │
└─────────┼─────────────────────┼─────────────────────────────┘
          │ POST /api/operation │
          ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    服务端                                    │
│                                                              │
│  ① requireAuth 中间件                                        │
│     └── 验证 JWT → 解析 currentUser                          │
│                                                              │
│  ② getUserById(from jwtUserId)                                 │
│     └── 从 SQLite 获取完整用户信息                            │
│                                                              │
│  ③ buildUserView(masterTree, user)                           │
│     └── 生成该用户当前的视图 + mapping 表                     │
│                                                              │
│  ④ mapAndValidateOperation(viewOp, user, mapping)            │
│     ├── mapViewToReal() → realNodeId                         │
│     ├── canEditNode(user, realNode)                          │
│     │   ├── checkRBAC: user.role ∈ node.allowedRoles?        │
│     │   └── checkABAC: visibility + group 策略               │
│     └── allowed=true? → MasterOperation                      │
│                                                              │
│  ⑤ 写入 Master Y.Doc                                         │
│     ├── insertNode() / updateNode() / deleteNode()           │
│     └── logOperation() → SQLite                              │
│                                                              │
│  ⑥ 重新生成所有用户的视图                                    │
│     └── 下次 GET /api/view/:userId 时自动反映                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. 后续步骤

逆向映射完成后，第6步将实现**显式权限校验与越权拦截**的增强功能：
- 更细粒度的操作级权限控制
- 越权操作的审计日志
- 批量操作校验

当前系统已具备完整的逆向映射链：`JWT认证 → 视图操作 → 映射转换 → 权限校验 → Master写入 → 视图刷新`。
