import { TreeNode, FlatTreeNode } from "../crdt/masterDoc.js";
import { UserInfo, canAccessNode } from "./accessControl.js";

// ============================================================
// View Node Types
// ============================================================

/**
 * View Node - what the user sees on the frontend
 * Contains viewNodeId -> realNodeId mapping info
 */
export interface ViewNode {
  viewNodeId: string;
  realNodeId: string;
  title: string;
  content: string;
  level: 1 | 2 | 3;
  target: string;
  children: ViewNode[];
}

/**
 * Mapping table entry - for inverse mapping
 */
export interface ViewMapping {
  viewNodeId: string;
  realNodeId: string;
}

/**
 * User view result
 */
export interface UserView {
  userId: string;
  userName: string;
  role: string;
  group: string;
  tree: ViewNode | null;
  mapping: ViewMapping[];
  filteredCount: number;
  totalNodeCount: number;
  visibleNodeCount: number;
}

// ============================================================
// View Builder
// ============================================================

/**
 * Build a user-specific view tree
 * Recursively traverses the master tree, filtering out invisible nodes
 */
export function buildViewTree(
  masterTree: FlatTreeNode,
  user: UserInfo
): ViewNode | null {
  const mapping: ViewMapping[] = [];
  let filteredCount = 0;
  let totalNodeCount = 0;

  const result = buildViewNode(masterTree, user, mapping, () => {
    totalNodeCount++;
  }, () => {
    filteredCount++;
  });

  if (!result) return null;

  return result;
}

/**
 * Build complete user view (with metadata)
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

  // Count visible nodes
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
    userName: user.username,
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
// Internal Recursive Helper
// ============================================================

/**
 * Recursively build a view node
 */
function buildViewNode(
  node: FlatTreeNode,
  user: UserInfo,
  mapping: ViewMapping[],
  countTotal: () => void,
  countFiltered: () => void
): ViewNode | null {
  countTotal();

  // Convert FlatTreeNode to TreeNode for access check
  const nodeForCheck: TreeNode = {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    content: node.content,
    level: node.level,
    target: node.target,
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

  // Recursively process children
  const visibleChildren: ViewNode[] = [];
  if (node.children) {
    for (const child of node.children) {
      const viewChild = buildViewNode(child, user, mapping, countTotal, countFiltered);
      if (viewChild) {
        visibleChildren.push(viewChild);
      }
    }
  }

  // Create view node (viewNodeId = realNodeId, simplified mapping)
  const viewNode: ViewNode = {
    viewNodeId: node.id,
    realNodeId: node.id,
    title: node.title,
    content: node.deleted ? "(This node has been deleted)" : node.content,
    level: node.level,
    target: node.target,
    children: visibleChildren,
  };

  // Add to mapping table
  mapping.push({
    viewNodeId: node.id,
    realNodeId: node.id,
  });

  return viewNode;
}

/**
 * Find a ViewNode by viewNodeId from a UserView
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
