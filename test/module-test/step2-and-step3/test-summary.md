# 第2步 & 第3步 单元测试覆盖说明

> 测试框架: Vitest | 测试文件: 4 个 | 测试用例: 141 个 | 全部通过 ✅

---

## 运行方式

```bash
cd backend
npm test           # 单次运行
npm run test:watch # 监听模式
```

---

## 测试文件概览

### 1. step2-masterDoc.test.ts — 第2步: Master Y.Doc CRDT 文档模型

**文件**: `test/module-test/step2-masterDoc.test.ts`
**测试用例**: 31 个

| 测试组 | 测试内容 | 用例数 |
|--------|---------|--------|
| **初始化** | MasterDoc 构造函数创建 Y.Doc / Y.Map, getMasterDoc() 单例模式 | 4 |
| **initSampleData()** | 创建 5 个示例节点, root 节点结构, 三种 visibility 覆盖, TreeNode 字段完整性, 重复初始化 | 6 |
| **insertNode()** | 在父节点下插入, 返回 UUID, nodes Map 写入, children 列表更新, 非 root 父节点插入, 空 children 情况 | 5 |
| **updateNode()** | 更新标题/多字段, updatedBy/updatedAt 自动更新, 关键字段防覆写(id/createdAt/createdBy), 不存在/已删除节点返回 false | 6 |
| **deleteNode()** | 逻辑删除标记 deleted=true, 递归删除子孙节点, 不存在/已删除节点返回 false | 5 |
| **查询方法** | getNode/getChildrenIds/getDirectChildren/getMasterTree/getMasterTreeJSON/getAllNodes/getAllChildren, 已删除节点仍保留在树中 | 7 |
| **CRDT 事务安全性** | insertNode/updateNode/deleteNode 均在 Y.Doc.transact() 事务内执行, 批量操作一致性 | 3 |

**核心验证点**:
- ✅ Y.Doc 仅在服务端存在，使用 Y.Map 存储 nodes + children
- ✅ 所有写操作在 `doc.transact()` 事务中执行，保证 CRDT 一致性
- ✅ 逻辑删除保留完整历史（deleted 标记 + 保留在树中）
- ✅ 单例模式（全局唯一 MasterDoc 实例）
- ✅ UUID 节点 ID，防止并发冲突
- ✅ updateNode 类型安全（Partial<Omit<TreeNode, "id"|"createdAt"|"createdBy">>）

---

### 2. step3-accessControl.test.ts — 第3步: RBAC + ABAC 访问控制

**文件**: `test/module-test/step3-accessControl.test.ts`
**测试用例**: 38 个

| 测试组 | 测试内容 | 用例数 |
|--------|---------|--------|
| **用户配置加载** | getAllUsers 返回 7 用户, getUserById 查找/缺失, 4 种角色覆盖, 4 种分组覆盖 | 5 |
| **角色配置加载** | getAllRoles 返回 4 角色, getRoleConfig 获取 admin/leader/member/guest 具体属性, 优先级排序, 不存在角色 | 7 |
| **RBAC 策略** | admin 通吃所有节点, root 对所有人可见, 已删除节点对非 admin 隐藏/对 admin 可见, allowedRoles 白名单匹配 | 6 |
| **ABAC 策略** | public 全员可见, group 同组可见/异组拒绝, private 仅 admin 可见, root/已删除节点特殊处理 | 8 |
| **组合策略** | RBAC+ABAC 都通过才允许, 任一不通过即拒绝, admin 全通, 已删除节点处理 | 5 |
| **编辑权限(canEditNode)** | admin 编辑所有(root+private), root 仅 admin 可编辑, leader/member 编辑本组 group, 跨组拒绝, guest 禁止一切编辑, 已删除节点不可编辑, 无查看=无编辑, 不存在角色默认拒绝 | 11 |
| **缓存机制** | refreshUserCache 清除/重载 | 2 |

**核心验证点**:
- ✅ RBAC: 用户角色必须在节点的 allowedRoles 中
- ✅ ABAC: public 全员 / group 同组 / private 仅 admin
- ✅ 双重策略同时生效（canAccessNode = RBAC && ABAC）
- ✅ admin(100) > leader(80) > member(60) > guest(10) 优先级链
- ✅ 编辑权限 > 查看权限（guest 可查看 public 但不能编辑）
- ✅ 角色配置从 configs/roles.json 独立加载，动态可扩展
- ✅ 配置文件热加载支持（refreshUserCache）

---

### 3. step3-viewBuilder.test.ts — 第3步: 正向视图变换

**文件**: `test/module-test/step3-viewBuilder.test.ts`
**测试用例**: 22 个

| 测试组 | 测试内容 | 用例数 |
|--------|---------|--------|
| **admin 视图** | 全部 5 节点可见, 三种 visibility 类型全覆盖, private 节点可见 | 3 |
| **leaderA 视图** | 3 节点可见(root+public+groupA), B组任务和管理员备注被过滤 | 4 |
| **memberA1 视图** | 3 节点可见(root+public+groupA), 与 leaderA 视图一致, B组/private 过滤 | 3 |
| **memberB1 视图** | 3 节点可见(root+public+groupB), A组任务/管理员备注被过滤 | 3 |
| **guest01 视图** | 2 节点可见(root+public), 所有 group/private 过滤, children 数组精确验证 | 4 |
| **元数据与统计** | userId/userName/role/group 正确, totalNodeCount=5, visible+filtered=total, mapping 表完整 | 4 |
| **findViewNode** | 查找存在/不存在节点, null tree 处理 | 3 |
| **ViewNode 结构** | viewNodeId===realNodeId, 必要字段完整性, children 嵌套正确, 已过滤节点不出现 | 4 |

**核心验证点**:
- ✅ 五种用户角色各自获得正确的视图隔离
- ✅ admin(5) > leader(3) > guest(2) 可见节点递减
- ✅ 统计信息精确(totalNodes/visibleNodes/filteredNodes)
- ✅ viewNodeId === realNodeId（简化映射设计）
- ✅ ViewNode 递归过滤：不可见节点及其子孙全部不出现在视图中

---

### 4. step3-inverseMapper.test.ts — 第3步: 逆向映射与权限校验

**文件**: `test/module-test/step3-inverseMapper.test.ts`
**测试用例**: 31 个

| 测试组 | 测试内容 | 用例数 |
|--------|---------|--------|
| **Insert 操作** | admin 在 root 下插入允许, memberA1 在 public/同组 group 下插入允许, 异组 group 拒绝, guest 拒绝, 缺少 parentViewNodeId, 父节点不存在, MasterOperation 结构验证 | 8 |
| **Update 操作** | memberA1 更新同组 group 允许/异组拒绝, 更新 public 允许, guest 拒绝所有, admin 更新 private/root 允许, member 更新 root 拒绝, 缺少 viewNodeId, 目标不存在 | 9 |
| **Delete 操作** | admin 删除子节点允许, memberA1 删除同组允许/异组拒绝, 所有用户删除 root 拒绝(含 admin), guest 拒绝, 缺少 viewNodeId | 6 |
| **映射表** | viewNodeId→realNodeId 正确映射, 无效 viewNodeId, 所有映射 entry 验证 | 3 |
| **边界情况** | 未知操作类型, 拒绝消息包含 userId(审计), 通过消息标记 allowed, realNode 指向正确 | 4 |

**核心验证点**:
- ✅ Insert 三重校验：父节点存在性 + 父节点编辑权限 + 用户角色
- ✅ Update 双重映射：viewNodeId→realNodeId + canEditNode 权限校验
- ✅ Delete root 保护（所有用户不可删除根节点）
- ✅ 跨组操作被拒绝并返回明确错误消息（含 userId 用于审计）
- ✅ 操作拒绝时返回 403/rejected，通过时返回 accepted
- ✅ MasterOperation 与 ViewOperation 映射关系正确

---

## 测试覆盖的操作校验矩阵

### 查看权限 (canAccessNode)

| 节点类型 | admin | leaderA | memberA1 | memberB1 | guest01 |
|---------|-------|---------|----------|----------|---------|
| root (public) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 公开介绍 (public) | ✅ | ✅ | ✅ | ✅ | ✅ |
| A组任务 (group, groupA) | ✅ | ✅ | ✅ | ❌ | ❌ |
| B组任务 (group, groupB) | ✅ | ❌ | ❌ | ✅ | ❌ |
| 管理员备注 (private) | ✅ | ❌ | ❌ | ❌ | ❌ |

### 编辑权限 (canEditNode)

| 操作 | admin | leaderA | memberA1 | memberB1 | guest01 |
|------|-------|---------|----------|----------|---------|
| 编辑 root | ✅ | ❌ | ❌ | ❌ | ❌ |
| 编辑 public 节点 | ✅ | ✅ | ✅ | ✅ | ❌ |
| 编辑 A组任务 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 编辑 B组任务 | ✅ | ❌ | ❌ | ✅ | ❌ |
| 编辑管理员备注 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 删除任意节点 | ✅ | 本组 | 本组 | 本组 | ❌ |
| 删除 root | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 文件结构

```
test/module-test/
├── step2-masterDoc.test.ts        ← 31 用例: MasterDoc CRDT 文档模型
├── step3-accessControl.test.ts    ← 38 用例: RBAC + ABAC 权限校验
├── step3-viewBuilder.test.ts      ← 22 用例: 正向视图变换
├── step3-inverseMapper.test.ts    ← 31 用例: 逆向映射与权限校验
└── test-summary.md                ← 本文件
```
