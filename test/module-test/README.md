# 模块单元测试说明

## 运行环境

- Node.js >= 22
- 在项目根目录执行命令

## 运行全部测试

```bash
npx tsx --test --test-reporter spec --test-concurrency=1 test/module-test/*.test.ts
```

> 注意：数据库相关测试共享同一个 SQLite 文件，必须串行执行（`--test-concurrency=1`）。

## 运行单个测试文件

```bash
npx tsx --test --test-reporter spec test/module-test/<文件名>.test.ts
```

示例：

```bash
# 运行访问控制纯函数测试（无需数据库）
npx tsx --test --test-reporter spec test/module-test/accessControl.test.ts

# 运行视图构建器测试
npx tsx --test --test-reporter spec test/module-test/viewBuilder.test.ts
```

## 测试文件清单与覆盖范围

### 第4步（SQLite 数据库迁移 + 正向视图变换）

| 文件 | 依赖 DB | 测试内容 |
|------|:-------:|---------|
| `database.test.ts` | 是 | 数据库初始化、三张表结构验证、WAL 模式、外键约束、种子数据幂等性 |
| `userStore.test.ts` | 是 | 用户 CRUD：`findUserByUserId` / `findUserByUsername` / `getAllUsers` / `createUser` / `updateUser`（动态字段）/ `deleteUser` / `getUserCount` |
| `roleStore.test.ts` | 是 | 角色 CRUD：`getRoleConfig` / `getAllRoleConfigs` / `roleExists` / `createRole` / `updateRole` / `deleteRole` / `toRoleConfig` 类型转换（INTEGER→boolean、JSON→数组） |
| `operationLogStore.test.ts` | 是 | 操作日志：`logOperation`（含可选字段）/ `getOperationLogs`（分页、按 userId 筛选、降序排列） |
| `authService.test.ts` | 是 | 认证服务：`register`（字段验证、唯一性检查、密码长度）/ `login`（密码验证）/ `verifyToken` / `extractToken` / 注册→登录→验证全流程 |
| `accessControl.test.ts` | 否 | 纯函数权限校验：`checkRBAC`（角色白名单、admin 通吃、已删除节点）/ `checkABAC`（public/group/private 可见性）/ `canAccessNode`（RBAC+ABAC 组合） |
| `accessControl-db.test.ts` | 是 | DB 依赖权限校验：`canEditNode`（admin/leader/member/guest 编辑权、root 保护、跨组拦截）/ `getUserById` / `getAllUsers` / `getAllRoles` |
| `viewBuilder.test.ts` | 否 | 正向视图变换：`buildViewTree`（5 角色×5 节点完整过滤矩阵）/ `buildUserView`（统计信息 totalNodeCount / filteredCount / visibleNodeCount）/ `findViewNode`（递归查找、空树处理） |

### 第5步（逆向映射）

| 文件 | 依赖 DB | 测试内容 |
|------|:-------:|---------|
| `inverseMapper.test.ts` | 是 | 逆向映射引擎：`mapAndValidateOperation` 的 insert / update / delete 三种操作；权限校验（admin 通吃、同组可编辑、跨组拒绝、guest 无编辑权）；root 节点防删除保护；缺少必填字段错误处理；节点不存在错误处理；未知操作类型错误处理；映射表回退逻辑 |

## 测试统计

共 **9 个测试文件**，**165 条测试用例**（全部通过）。

---

## 测试中发现的问题

以下问题在测试编写过程中暴露，需要开发人员确认和处理：

### ⚠️ `roleStore.createRole()` 重复创建时抛异常而非返回 false

- **位置**：`backend/src/db/roleStore.ts:95` — `createRole()` 使用 `INSERT INTO`（未加 `OR IGNORE`），重复创建时抛出 `SQLITE_CONSTRAINT_UNIQUE` 异常
- **影响**：`backend/src/server.ts:414` 的 API 路由期望 `createRole` 返回 `false` 来响应 400，但该分支永远不会执行——异常会落到外层 catch 返回 500
- **测试条目**：`roleStore.test.ts` → `createRole: [注意] 重复创建抛异常而非返回 false`

> 以上是测试过程中观察到的行为不一致，非测试代码本身的 bug。请开发人员确认是否需要修改 `roleStore.ts`（加 `INSERT OR IGNORE`）或修改 `server.ts`（改为 try/catch 处理异常）。
