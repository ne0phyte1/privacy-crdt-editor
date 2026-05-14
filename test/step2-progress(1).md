# 第2步进度报告：服务端 Master Y.Doc 完整 CRDT 文档模型

> **项目**：基于 Yjs 的隐私保护结构化数据协同编辑器
> **步骤**：第2步 — Master Y.Doc 完整 CRDT 文档模型
> **状态**：✅ 已完成
> **日期**：2026-05-14

---

## 1. 目标概述

实现服务端唯一的 Master Y.Doc CRDT 文档模型，该文档：
- 仅在**服务端内存**中维护，客户端**不直接连接或获取**完整文档
- 使用 **Yjs** 作为底层 CRDT 一致性引擎
- 维护完整的 JSON 树结构，支持增删改查操作
- 为后续隐私视图变换（第4步）提供数据基础

---

## 2. 实现文件

### 2.1 新增文件

| 文件 | 说明 |
|------|------|
| [`backend/src/crdt/masterDoc.ts`](../backend/src/crdt/masterDoc.ts) | MasterDoc 类 + TreeNode 类型定义 + 单例导出 |

### 2.2 修改文件

| 文件 | 说明 |
|------|------|
| [`backend/src/server.ts`](../backend/src/server.ts) | 新增 4 个调试 REST API 端点 |

---

## 3. 数据模型设计

### 3.1 TreeNode 节点类型

```typescript
interface TreeNode {
  id: string;            // 节点唯一标识（UUID）
  parentId: string;      // 父节点 ID
  title: string;         // 节点标题
  content: string;       // 节点内容
  visibility: "public" | "group" | "private";  // 可见性策略
  ownerGroup: string;    // 所属用户组
  allowedRoles: string[]; // 允许访问的角色列表
  deleted: boolean;      // 逻辑删除标记
  createdBy: string;     // 创建者
  updatedBy: string;     // 最后更新者
  createdAt: string;     // 创建时间
  updatedAt: string;     // 最后更新时间
}
```

### 3.2 Yjs 存储结构

```
Y.Doc
├── nodes: Y.Map<TreeNode>         // nodeId → TreeNode
└── children: Y.Map<string[]>      // parentId → childId[]
```

- **nodes**：以 `nodeId` 为 key 的 Map，存储所有节点
- **children**：以 `parentId` 为 key 的 Map，存储父子关系
- 所有操作都在 `doc.transact()` 事务中执行，保证 CRDT 一致性

### 3.3 示例数据

```
项目文档 (root, public, all)
├── 📄 公开介绍 (public, all)
├── 👥 A组任务 (group, groupA)
├── 👥 B组任务 (group, groupB)
└── 🔒 管理员备注 (private, admin)
```

四种节点覆盖了三种可见性策略（public / group / private），为后续隐私视图测试提供基础。

---

## 4. MasterDoc 类核心方法

| 方法 | 说明 | CRDT 事务 |
|------|------|-----------|
| `initSampleData()` | 初始化 5 个示例节点（root + 4个子节点） | ✅ |
| `insertNode()` | 在指定父节点下插入新节点，自动维护 children 关系 | ✅ |
| `updateNode()` | 更新节点指定字段（title/content/visibility 等） | ✅ |
| `deleteNode()` | 递归逻辑删除节点及其所有子孙节点 | ✅ |
| `getNode()` | 获取单个节点 | ❌ 读操作 |
| `getMasterTree()` | 递归构建完整嵌套树 | ❌ 读操作 |
| `getMasterTreeJSON()` | 返回序列化的 JSON 树 | ❌ 读操作 |

### 关键设计说明

**逻辑删除**：删除操作使用 `deleted` 标记而非物理移除，保留完整历史记录。递归删除时自动遍历所有子孙节点。

**单例模式**：通过 `getMasterDoc()` 全局单例确保服务端只有一个 Y.Doc 实例。

**类型安全**：`updateNode` 的 `fields` 参数使用 `Partial<Omit<TreeNode, "id" | "createdAt" | "createdBy">>`，防止修改关键字段。

---

## 5. 调试 API 接口

所有接口仅用于**开发阶段调试**，正式环境中客户端不直接调用。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/master-tree` | 返回服务端完整 JSON 树 |
| `POST` | `/api/master/nodes` | 插入新节点 |
| `PUT` | `/api/master/nodes/:nodeId` | 更新节点字段 |
| `DELETE` | `/api/master/nodes/:nodeId` | 逻辑删除节点 |

### 请求/响应示例

```
GET /api/master-tree

Response:
{
  "status": "ok",
  "tree": {
    "id": "root",
    "title": "项目文档",
    "children": [
      { "id": "n1", "title": "公开介绍", "visibility": "public", ... },
      { "id": "n2", "title": "A组任务", "visibility": "group", "ownerGroup": "groupA", ... },
      ...
    ]
  }
}
```

---

## 6. 测试工具

[`tmp/test-master-doc.html`](../tmp/test-master-doc.html) — 独立测试前端页面。

**功能**：
- 树形展示 Master Y.Doc 完整文档
- 可视化增删改节点操作
- 实时操作日志
- 节点详情面板（含完整 JSON 查看）
- 颜色标识：🟢 public / 🔵 group / 🔒 private / ✕ deleted

**使用方式**：
```bash
# 1. 启动后端
cd backend && npm run dev

# 2. 浏览器打开
open tmp/test-master-doc.html
```

---

## 7. 验证结果

所有接口测试通过 ✅

| 测试项 | 结果 |
|--------|------|
| `GET /api/health` | ✅ 返回 `{"status":"ok","message":"Privacy CRDT backend is running"}` |
| `GET /api/master-tree` | ✅ 返回完整嵌套树结构（root + 4个子节点） |
| `POST /api/master/nodes` | ✅ 插入新节点成功，返回新 nodeId |
| `PUT /api/master/nodes/:nodeId` | ✅ 更新节点字段成功，updatedBy/updatedAt 自动更新 |
| `DELETE /api/master/nodes/:nodeId` | ✅ 逻辑删除成功，节点标记为 deleted |
| 插入子节点 → 重新获取树 | ✅ 新节点出现在 children 列表中 |
| 更新根节点标题 → 重新获取 | ✅ 标题已更新 |

---

## 8. 项目结构（第2步完成后）

```
privacy-crdt-editor/
├── backend/
│   ├── src/
│   │   ├── crdt/
│   │   │   └── masterDoc.ts      ← 新增：Master Y.Doc 文档模型
│   │   └── server.ts              ← 修改：新增 4 个调试 API
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── App.css
│   └── package.json
├── tmp/
│   ├── crdt.txt                    ← 需求文档
│   ├── 对话和后续.txt              ← 设计讨论
│   └── test-master-doc.html        ← 新增：测试前端页面
└── readme.md
```

---

## 9. 后续步骤计划

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 第3步 | 用户与权限配置（RBAC + ABAC） | 第2步 ✅ |
| 第4步 | 正向视图变换：完整文档 → 用户专属视图 | 第3步 |
| 第5步 | 逆向映射：视图操作 → 完整文档操作 | 第4步 |
| 第6步 | 权限校验与越权拦截 | 第5步 |
| 第7步 | 前端树形编辑界面 | 第6步 |
| 第8步 | 多用户视图同步 | 第7步 |
| 第9步 | 离线编辑模拟 | 第8步 |
| 第10步 | 测试、文档、演示 | 第1-9步 |

---

## 10. 关键技术决策

1. **Y.Doc 仅在服务端存在** — 这是整个隐私保护架构的基础，客户端永远不直接获取完整 Y.Doc
2. **Y.Map 存储结构** — 使用 `nodes` 和 `children` 两个 Y.Map 分离节点数据和父子关系，便于 CRDT 并发合并
3. **UUID 节点 ID** — 使用 `uuid` 库生成全局唯一 ID，避免并发冲突
4. **逻辑删除** — 保留已删除节点的元数据，支持操作回滚和审计日志
5. **单例模式** — 保证服务端进程中只有一个 Master Y.Doc 实例，简化状态管理
