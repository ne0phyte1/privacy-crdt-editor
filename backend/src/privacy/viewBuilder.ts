import { TreeNode, FlatTreeNode } from "../crdt/masterDoc.js";
import { UserInfo, canAccessNode } from "./accessControl.js";

// ============================================================
// 视图节点类型
// ============================================================

/**
 * 视图节点 — 用户在前端看到的树节点
 * 包含 viewNodeId → realNodeId 映射所需的全部信息
 */
export interface ViewNode {
  viewNodeId: string;          // 视图节点 ID（与 realNodeId 相同，用于简化映射）
  realNodeId: string;          // 对应 Master Doc 中的真实节点 ID
  title: string;
  content: string;
  visibility: "public" | "group" | "private";
  ownerGroup: string;
  children: ViewNode[];
}

/**
 * 映射表条目 — 用于逆向映射
 */
export interface ViewMapping {
  viewNodeId: string;
  realNodeId: string;
}

/**
 * 用户视图结果
 */
export interface UserView {
  userId: string;
  userName: string;
  role: string;
  group: string;
  tree: ViewNode | null;
  mapping: ViewMapping[];
  filteredCount: number;       // 被过滤的节点数（调试用）
  totalNodeCount: number;      // 完整树节点数
  visibleNodeCount: number;    // 可见节点数
}

// ============================================================
// 视图构建器
// ============================================================

/**
 * 构建用户专属视图树
 * 递归遍历 Master Doc 的完整树，根据用户权限过滤不可见节点
 *
 * @param masterTree 完整树（来自 MasterDoc.getMasterTree()）
 * @param user 当前用户信息
 * @returns ViewNode 视图树（只包含用户有权限看到的节点）
 */
export function buildViewTree(
  masterTree: FlatTreeNode,
  user: UserInfo
): ViewNode | null {
  const mapping: ViewMapping[] = [];
  let filteredCount = 0;
  let totalNodeCount = 0;

  // 递归构建
  const result = buildViewNode(masterTree, user, mapping, () => {
    totalNodeCount++;
  }, () => {
    filteredCount++;
  });

  if (!result) return null;

  return result;
}

/**
 * 构建用户完整视图（含元数据）
 */
export function buildUserView(
  masterTree: FlatTreeNode,
  user: UserInfo
): UserView {
  const mapping: ViewMapping[] = [];
  let filteredCount = 0;
  let totalNodeCount = 0;

  const tree = buildViewNode(masterTree, user, mapping, () => {
    totalNodeCount++;
  }, () => {
    filteredCount++;
  });

  // 统计可见节点数
  let visibleNodeCount = 0;
  function countVisible(node: ViewNode | null): void {
    if (!node) return;
    visibleNodeCount++;
    for (const child of node.children) {
      countVisible(child);
    }
  }
  countVisible(tree);

  return {
    userId: user.userId,
    userName: user.name,
    role: user.role,
    group: user.group,
    tree,
    mapping,
    filteredCount,
    totalNodeCount,
    visibleNodeCount,
  };
}

// ============================================================
// 内部递归辅助函数
// ============================================================

/**
 * 递归构建视图节点
 */
function buildViewNode(
  node: FlatTreeNode,
  user: UserInfo,
  mapping: ViewMapping[],
  countTotal: () => void,
  countFiltered: () => void
): ViewNode | null {
  countTotal();

  // 检查当前节点是否对用户可见
  // 将 FlatTreeNode 转换为 TreeNode（忽略 children 字段）
  const nodeForCheck: TreeNode = {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    content: node.content,
    visibility: node.visibility,
    ownerGroup: node.ownerGroup,
    allowedRoles: node.allowedRoles,
    deleted: node.deleted,
    createdBy: node.createdBy,
    updatedBy: node.updatedBy,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };

  if (!canAccessNode(user, nodeForCheck)) {
    countFiltered();
    return null;
  }

  // 递归处理子节点
  const visibleChildren: ViewNode[] = [];
  if (node.children) {
    for (const child of node.children) {
      const viewChild = buildViewNode(child, user, mapping, countTotal, countFiltered);
      if (viewChild) {
        visibleChildren.push(viewChild);
      }
    }
  }

  // 创建视图节点（viewNodeId = realNodeId，简化映射）
  const viewNode: ViewNode = {
    viewNodeId: node.id,
    realNodeId: node.id,
    title: node.title,
    content: node.deleted ? "(该节点已被删除)" : node.content,
    visibility: node.visibility,
    ownerGroup: node.ownerGroup,
    children: visibleChildren,
  };

  // 添加到映射表
  mapping.push({
    viewNodeId: node.id,
    realNodeId: node.id,
  });

  return viewNode;
}

/**
 * 根据 viewNodeId 从 UserView 中查找对应的 ViewNode
 */
export function findViewNode(
  view: UserView,
  viewNodeId: string
): ViewNode | null {
  if (!view.tree) return null;

  function search(node: ViewNode): ViewNode | null {
    if (node.viewNodeId === viewNodeId) return node;
    for (const child of node.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  }

  return search(view.tree);
}
