import { UserInfo, canAccessNode, canEditNode } from "./accessControl.js";
import { TreeNode, FlatTreeNode } from "../crdt/masterDoc.js";
import { ViewMapping, ViewNode, UserView } from "./viewBuilder.js";

// ============================================================
// 视图操作类型定义
// ============================================================

export type ViewOperationType = "insert" | "update" | "delete";

/**
 * 用户在前端发起的视图操作
 */
export interface ViewOperation {
  type: ViewOperationType;
  viewNodeId?: string;           // 操作的视图节点 ID（update/delete 时必填）
  parentViewNodeId?: string;     // 父视图节点 ID（insert 时必填）
  payload: {
    title?: string;
    content?: string;
    visibility?: "public" | "group" | "private";
    ownerGroup?: string;
    allowedRoles?: string[];
  };
}

/**
 * 转换后的 Master Doc 操作（经过逆向映射）
 */
export interface MasterOperation {
  type: ViewOperationType;
  realNodeId?: string;           // 映射后的真实节点 ID
  parentRealNodeId?: string;     // 父节点真实 ID
  payload: {
    title?: string;
    content?: string;
    visibility?: "public" | "group" | "private";
    ownerGroup?: string;
    allowedRoles?: string[];
  };
}

/**
 * 操作验证结果
 */
export interface OperationResult {
  allowed: boolean;
  masterOp: MasterOperation | null;
  realNode: TreeNode | null;     // 被操作的真实节点（用于后续写入 Master Doc）
  message: string;
}

// ============================================================
// 逆向映射与权限校验
// ============================================================

/**
 * 将视图操作逆向映射为 Master Doc 操作，并执行权限校验
 *
 * @param viewOp 用户提交的视图操作
 * @param user 当前用户
 * @param masterTree 完整树（用于查找真实节点）
 * @param mappings 视图映射表
 * @param getNode 获取真实节点的函数
 * @returns 操作验证结果
 */
export function mapAndValidateOperation(
  viewOp: ViewOperation,
  user: UserInfo,
  masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  switch (viewOp.type) {
    case "insert":
      return handleInsert(viewOp, user, masterTree, getNode);
    case "update":
      return handleUpdate(viewOp, user, masterTree, mappings, getNode);
    case "delete":
      return handleDelete(viewOp, user, masterTree, mappings, getNode);
    default:
      return {
        allowed: false,
        masterOp: null,
        realNode: null,
        message: `未知的操作类型: ${(viewOp as any).type}`,
      };
  }
}

// ============================================================
// 插入操作处理
// ============================================================

function handleInsert(
  viewOp: ViewOperation,
  user: UserInfo,
  _masterTree: FlatTreeNode,
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  const parentViewNodeId = viewOp.parentViewNodeId;
  if (!parentViewNodeId) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: "插入操作缺少 parentViewNodeId",
    };
  }

  // 父节点 ID 就是真实节点 ID（viewNodeId === realNodeId）
  const parentRealNodeId = parentViewNodeId;
  const parentNode = getNode(parentRealNodeId);

  if (!parentNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `父节点 ${parentRealNodeId} 不存在`,
    };
  }

  // 检查用户是否有权限在父节点下添加子节点
  if (!canEditNode(user, parentNode)) {
    return {
      allowed: false,
      masterOp: null,
      realNode: parentNode,
      message: `用户 ${user.userId} 无权在节点 "${parentNode.title}" 下添加子节点`,
    };
  }

  // 构建 Master Doc 操作
  const masterOp: MasterOperation = {
    type: "insert",
    parentRealNodeId,
    payload: {
      title: viewOp.payload.title || "新节点",
      content: viewOp.payload.content || "",
      visibility: viewOp.payload.visibility || "public",
      ownerGroup: viewOp.payload.ownerGroup || user.group,
      allowedRoles: viewOp.payload.allowedRoles || getDefaultAllowedRoles(user.role),
    },
  };

  return {
    allowed: true,
    masterOp,
    realNode: parentNode,
    message: "插入操作权限校验通过",
  };
}

// ============================================================
// 更新操作处理
// ============================================================

function handleUpdate(
  viewOp: ViewOperation,
  user: UserInfo,
  _masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  const viewNodeId = viewOp.viewNodeId;
  if (!viewNodeId) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: "更新操作缺少 viewNodeId",
    };
  }

  // 通过映射表找到真实节点 ID
  const realNodeId = mapViewToReal(viewNodeId, mappings);
  const realNode = getNode(realNodeId);

  if (!realNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `真实节点 ${realNodeId} 不存在`,
    };
  }

  // 权限校验：用户是否有编辑该节点的权限
  if (!canEditNode(user, realNode)) {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: `用户 ${user.userId} 无权修改节点 "${realNode.title}"`,
    };
  }

  // 构建 Master Doc 操作
  const masterOp: MasterOperation = {
    type: "update",
    realNodeId,
    payload: {
      title: viewOp.payload.title,
      content: viewOp.payload.content,
      visibility: viewOp.payload.visibility,
      ownerGroup: viewOp.payload.ownerGroup,
      allowedRoles: viewOp.payload.allowedRoles,
    },
  };

  return {
    allowed: true,
    masterOp,
    realNode,
    message: "更新操作权限校验通过",
  };
}

// ============================================================
// 删除操作处理
// ============================================================

function handleDelete(
  viewOp: ViewOperation,
  user: UserInfo,
  _masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  const viewNodeId = viewOp.viewNodeId;
  if (!viewNodeId) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: "删除操作缺少 viewNodeId",
    };
  }

  const realNodeId = mapViewToReal(viewNodeId, mappings);
  const realNode = getNode(realNodeId);

  if (!realNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `真实节点 ${realNodeId} 不存在`,
    };
  }

  // 不能删除根节点
  if (realNode.id === "root") {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: "不能删除根节点",
    };
  }

  // 权限校验
  if (!canEditNode(user, realNode)) {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: `用户 ${user.userId} 无权删除节点 "${realNode.title}"`,
    };
  }

  const masterOp: MasterOperation = {
    type: "delete",
    realNodeId,
    payload: {},
  };

  return {
    allowed: true,
    masterOp,
    realNode,
    message: "删除操作权限校验通过",
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据 viewNodeId 查找 realNodeId
 */
function mapViewToReal(viewNodeId: string, mappings: ViewMapping[]): string {
  const mapping = mappings.find((m) => m.viewNodeId === viewNodeId);
  return mapping ? mapping.realNodeId : viewNodeId;
}

/**
 * 根据用户角色获取默认 allowedRoles
 */
function getDefaultAllowedRoles(role: string): string[] {
  switch (role) {
    case "admin":
      return ["admin", "leader", "member", "guest"];
    case "leader":
      return ["admin", "leader", "member"];
    case "member":
      return ["admin", "member"];
    case "guest":
      return ["admin", "guest"];
    default:
      return ["admin", "member", "guest"];
  }
}
