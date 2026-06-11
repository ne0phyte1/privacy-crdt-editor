import { UserInfo, canEditNode } from "./accessControl.js";
import { TreeNode, FlatTreeNode } from "../crdt/masterDoc.js";
import { ViewMapping } from "./viewBuilder.js";
import { ViewOperation } from "./inverseMapper.js";

// ============================================================
// Operation Validation Type Definitions
// ============================================================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestedAction?: string;
}

// ============================================================
// Field-Level Permission Control
// ============================================================

/**
 * Check if user has permission to edit a specific field
 */
export function canEditField(user: UserInfo, node: TreeNode, field: string): boolean {
  // Root node field protection
  if (node.id === "root") {
    const protectedFields = ["id", "target", "level"];
    if (protectedFields.includes(field)) {
      return user.role === "admin";
    }
  }

  // Admin has all field edit permissions (even on deleted nodes)
  if (user.role === "admin") return true;

  // Non-admin: deleted nodes cannot be edited
  if (node.deleted) return false;

  // Field sensitivity configuration
  const fieldSensitivity: Record<string, string[]> = {
    title: ["admin", "leader", "member"],
    content: ["admin", "leader", "member"],
    level: ["admin"],
    target: ["admin"],
  };

  const allowedRoles = fieldSensitivity[field] || ["admin"];
  return allowedRoles.includes(user.role);
}

/**
 * Validate field value legality
 */
export function validateFieldValue(
  field: string,
  value: any,
  node: TreeNode,
  user: UserInfo
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  switch (field) {
    case "title":
      if (!value || typeof value !== "string" || value.trim().length === 0) {
        result.isValid = false;
        result.errors.push("标题不能为空");
      } else if (value.length > 200) {
        result.warnings.push("标题过长（超过200个字符）");
      }
      break;

    case "content":
      if (typeof value !== "string") {
        result.isValid = false;
        result.errors.push("内容必须是字符串");
      } else if (value.length > 10000) {
        result.warnings.push("内容过长（超过10000个字符）");
      }
      break;

    case "level":
      if (![1, 2, 3].includes(value)) {
        result.isValid = false;
        result.errors.push("级别必须为 1、2 或 3");
      }
      // Only admin can change level
      if (user.role !== "admin") {
        result.isValid = false;
        result.errors.push("仅管理员可修改级别");
      }
      break;

    case "target":
      if (typeof value !== "string" || value.trim().length === 0) {
        result.isValid = false;
        result.errors.push("可见范围不能为空");
      }
      // Only admin can change target
      if (user.role !== "admin") {
        result.isValid = false;
        result.errors.push("仅管理员可修改可见范围");
      }
      break;
  }

  return result;
}

// ============================================================
// Operation-Level Permission Control
// ============================================================

/**
 * Validate operation permission
 */
export function validateOperationPermission(
  operation: ViewOperation,
  user: UserInfo,
  targetNode: TreeNode,
  parentNode: TreeNode | null
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  switch (operation.type) {
    case "insert":
      if (!parentNode) {
        result.isValid = false;
        result.errors.push("插入操作缺少父节点");
      } else if (!canEditNode(user, parentNode)) {
        result.isValid = false;
        result.errors.push(`No permission to insert child under "${parentNode.title}"`);
      }
      break;

    case "update":
      if (!canEditNode(user, targetNode)) {
        result.isValid = false;
        result.errors.push(`No permission to edit "${targetNode.title}"`);
      }
      break;

    case "delete":
      if (!canEditNode(user, targetNode)) {
        result.isValid = false;
        result.errors.push(`No permission to delete "${targetNode.title}"`);
      }
      break;

    default:
      result.isValid = false;
      result.errors.push("未知操作类型");
  }

  return result;
}

// ============================================================
// Batch Validation
// ============================================================

export interface BatchOperation {
  operation: ViewOperation;
  sequenceIndex: number;
}

export interface BatchValidationResult {
  isValid: boolean;
  results: Array<{
    index: number;
    allowed: boolean;
    message: string;
  }>;
  invalidOperations: number;
  validOperations: number;
  rollbackRequired: boolean;
}

/**
 * Validate a batch of operations
 */
export function validateBatchOperations(
  operations: BatchOperation[],
  user: UserInfo,
  masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): BatchValidationResult {
  const result: BatchValidationResult = {
    isValid: true,
    results: [],
    invalidOperations: 0,
    validOperations: 0,
    rollbackRequired: false,
  };

  const deletedNodes = new Set<string>();

  operations.forEach((batchOp, index) => {
    const op = batchOp.operation;

    if (op.type === "insert") {
      const parentRealNodeId = op.parentViewNodeId || "root";
      const parentNode = getNode(parentRealNodeId);

      if (deletedNodes.has(parentRealNodeId)) {
        result.results.push({ index, allowed: false, message: `Parent node has been deleted in a previous batch operation` });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      if (!parentNode && parentRealNodeId !== "root") {
        result.results.push({ index, allowed: false, message: `Parent node ${parentRealNodeId} does not exist` });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      if (parentNode && !canEditNode(user, parentNode)) {
        result.results.push({ index, allowed: false, message: `No permission to insert child under "${parentNode.title}"` });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      result.results.push({ index, allowed: true, message: "OK" });
      result.validOperations++;
      return;
    }

    // Update / Delete: need realNode
    const realNodeId = mapViewToReal(op.viewNodeId || "", mappings);
    const realNode = getNode(realNodeId);

    if (!realNode) {
      result.results.push({ index, allowed: false, message: `Node ${realNodeId} does not exist` });
      result.invalidOperations++;
      result.isValid = false;
      return;
    }

    if (deletedNodes.has(realNodeId)) {
      result.results.push({ index, allowed: false, message: "Node has been deleted in a previous batch operation" });
      result.invalidOperations++;
      result.isValid = false;
      return;
    }

    if (op.type === "update") {
      if (!canEditNode(user, realNode)) {
        result.results.push({ index, allowed: false, message: `No permission to edit "${realNode.title}"` });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      result.results.push({ index, allowed: true, message: "OK" });
      result.validOperations++;
      return;
    }

    if (op.type === "delete") {
      if (realNode.id === "root") {
        result.results.push({ index, allowed: false, message: "Cannot delete root node" });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      if (!canEditNode(user, realNode)) {
        result.results.push({ index, allowed: false, message: `No permission to delete "${realNode.title}"` });
        result.invalidOperations++;
        result.isValid = false;
        return;
      }

      // Mark as deleted for subsequent batch checks
      deletedNodes.add(realNodeId);

      result.results.push({ index, allowed: true, message: "OK" });
      result.validOperations++;
      return;
    }
  });

  if (result.invalidOperations > 0) {
    result.rollbackRequired = true;
  }

  return result;
}

// ============================================================
// Recursive Operation Validation
// ============================================================

/**
 * Validate recursive delete operation permissions
 * Checks the target node and all its descendants
 */
export function validateRecursiveDelete(
  nodeId: string,
  user: UserInfo,
  masterTree: FlatTreeNode,
  getNode: (nodeId: string) => TreeNode | undefined
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const node = getNode(nodeId);
  if (!node) {
    result.isValid = false;
    result.errors.push(`Node ${nodeId} does not exist`);
    return result;
  }

  if (node.id === "root") {
    result.isValid = false;
    result.errors.push("不可递归删除根节点");
    return result;
  }

  // Check target node permission
  if (!canEditNode(user, node)) {
    result.isValid = false;
    result.errors.push(`No permission to delete "${node.title}"`);
    return result;
  }

  // Recursively check all descendants
  const children = (masterTree.children || []).filter((n: FlatTreeNode) => n.parentId === nodeId);
  for (const child of children) {
    const childNode = getNode(child.id);
    if (childNode && !canEditNode(user, childNode)) {
      result.isValid = false;
      result.errors.push(`No permission to delete child node "${childNode.title}"`);
    }

    // Recursively check deeper descendants
    const deeperResult = validateRecursiveDelete(child.id, user, masterTree, getNode);
    if (!deeperResult.isValid) {
      result.isValid = false;
      result.errors.push(...deeperResult.errors);
    }
  }

  return result;
}

// ============================================================
// Move Operation Validation
// ============================================================

/**
 * Validate drag-and-drop move operation permissions
 * Essentially a combined delete + insert operation
 */
export function validateMoveOperation(
  nodeId: string,
  newParentId: string,
  user: UserInfo,
  masterTree: FlatTreeNode,
  getNode: (nodeId: string) => TreeNode | undefined
): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  const node = getNode(nodeId);
  const newParent = getNode(newParentId);

  if (!node) {
    result.isValid = false;
    result.errors.push(`Source node ${nodeId} does not exist`);
    return result;
  }

  if (!newParent) {
    result.isValid = false;
    result.errors.push(`Target parent node ${newParentId} does not exist`);
    return result;
  }

  // Cannot move into own descendant (prevents cycles)
  if (isDescendant(nodeId, newParentId, masterTree)) {
    result.isValid = false;
    result.errors.push("不可将节点移动到其子孙节点下");
    return result;
  }

  // Check delete permission on source node
  if (!canEditNode(user, node)) {
    result.isValid = false;
    result.errors.push(`No permission to move "${node.title}"`);
    return result;
  }

  // Check insert permission on target parent
  if (!canEditNode(user, newParent)) {
    result.isValid = false;
    result.errors.push(`No permission to insert child under "${newParent.title}"`);
    return result;
  }

  return result;
}

/**
 * Check if node is a descendant of target
 */
function isDescendant(nodeId: string, targetId: string, masterTree: FlatTreeNode): boolean {
  function findNode(tree: FlatTreeNode, id: string): FlatTreeNode | null {
    if (tree.id === id) return tree;
    if (tree.children) {
      for (const child of tree.children) {
        const found = findNode(child, id);
        if (found) return found;
      }
    }
    return null;
  }

  let current = findNode(masterTree, nodeId);
  while (current && current.parentId) {
    if (current.parentId === targetId) return true;
    current = findNode(masterTree, current.parentId);
  }
  return false;
}

// ============================================================
// Helper Functions
// ============================================================

function mapViewToReal(viewNodeId: string, mappings: ViewMapping[]): string {
  const mapping = mappings.find((m) => m.viewNodeId === viewNodeId);
  return mapping ? mapping.realNodeId : viewNodeId;
}
