import { UserInfo, canEditNode, canCreateUnder } from "./accessControl.js";
import { TreeNode, FlatTreeNode } from "../crdt/masterDoc.js";
import { ViewMapping, ViewNode, UserView } from "./viewBuilder.js";
import { 
  ValidationResult, 
  validateFieldValue, 
  canEditField 
} from "./operationValidator.js";

// ============================================================
// View Operation Type Definitions
// ============================================================

export type ViewOperationType = "insert" | "update" | "delete";

/**
 * User-initiated view operation from frontend
 */
export interface ViewOperation {
  type: ViewOperationType;
  viewNodeId?: string;
  parentViewNodeId?: string;
  payload: {
    title?: string;
    content?: string;
    level?: 1 | 2 | 3;
    target?: string;
  };
}

/**
 * Converted Master Doc operation (after inverse mapping)
 */
export interface MasterOperation {
  type: ViewOperationType;
  realNodeId?: string;
  parentRealNodeId?: string;
  payload: {
    title?: string;
    content?: string;
    level?: 1 | 2 | 3;
    target?: string;
  };
}

/**
 * Operation result
 */
export interface OperationResult {
  allowed: boolean;
  masterOp: MasterOperation | null;
  realNode: TreeNode | null;
  message: string;
}

// ============================================================
// Inverse Mapping & Permission Validation
// ============================================================

/**
 * Map a view operation to a Master Doc operation with permission validation
 */
export function mapAndValidateOperation(
  viewOp: ViewOperation,
  user: UserInfo,
  masterTree: FlatTreeNode,
  mappings: ViewMapping[],
  getNode: (nodeId: string) => TreeNode | undefined
): OperationResult {
  // Basic operation validation
  if (!viewOp.type || !["insert", "update", "delete"].includes(viewOp.type)) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `Unknown operation type: ${(viewOp as any).type}`,
    };
  }

  // Dispatch by operation type
  switch (viewOp.type) {
    case "insert":
      return handleInsert(viewOp, user, masterTree, getNode);
    case "update":
      return handleUpdate(viewOp, user, masterTree, mappings, getNode);
    case "delete":
      return handleDelete(viewOp, user, masterTree, mappings, getNode);
    default:
      return { allowed: false, masterOp: null, realNode: null, message: "未知操作" };
  }
}

// ============================================================
// Insert Operation Handler (with NBAC creation rules)
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
      message: "插入操作缺少父节点ID",
    };
  }

  // parentViewNodeId is already a realNodeId (viewBuilder maps 1:1)
  const parentRealNodeId = parentViewNodeId;
  const parentNode = getNode(parentRealNodeId);

  if (!parentNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `Parent node ${parentRealNodeId} does not exist`,
    };
  }

  // Determine requested level and target from payload (defaults if not provided)
  const requestedLevel: 1 | 2 | 3 = viewOp.payload.level || 3;
  const requestedTarget = viewOp.payload.target;

  // Use canCreateUnder which combines RBAC + NBAC creation rules
  const createCheck = canCreateUnder(user, parentNode, requestedLevel, requestedTarget);

  if (!createCheck.allowed) {
    return {
      allowed: false,
      masterOp: null,
      realNode: parentNode,
      message: createCheck.message,
    };
  }

  // NBAC resolved the actual level and target
  const resolvedLevel = createCheck.level;
  const resolvedTarget = createCheck.target;

  // Build Master Doc operation with resolved attributes
  const masterOp: MasterOperation = {
    type: "insert",
    parentRealNodeId,
    payload: {
      title: viewOp.payload.title || "New Node",
      content: viewOp.payload.content || "",
      level: resolvedLevel,
      target: resolvedTarget,
    },
  };

  return {
    allowed: true,
    masterOp,
    realNode: parentNode,
    message: "插入操作验证通过",
  };
}

// ============================================================
// Update Operation Handler
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
      message: "更新操作缺少节点ID",
    };
  }

  const realNodeId = mapViewToReal(viewNodeId, mappings);
  const realNode = getNode(realNodeId);

  if (!realNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `Real node ${realNodeId} does not exist`,
    };
  }

  // Check edit permission
  if (!canEditNode(user, realNode)) {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: `User ${user.userId} has no permission to edit "${realNode.title}"`,
    };
  }

  // Field-level permission validation
  const payload = viewOp.payload;
  const fieldsToCheck: Array<"title" | "content" | "level" | "target"> = ["title", "content", "level", "target"];
  for (const field of fieldsToCheck) {
    const fieldValue = payload[field];
    if (fieldValue !== undefined) {
      if (!canEditField(user, realNode, field)) {
        return {
          allowed: false,
          masterOp: null,
          realNode,
          message: `User ${user.userId} has no permission to edit field "${field}"`,
        };
      }
      
      // Validate field value legality
      const fieldValidation = validateFieldValue(field, fieldValue, realNode, user);
      if (!fieldValidation.isValid) {
        return {
          allowed: false,
          masterOp: null,
          realNode,
          message: `Field "${field}" validation failed: ${fieldValidation.errors.join(", ")}`,
        };
      }
    }
  }

  // Build Master Doc operation
  const masterOp: MasterOperation = {
    type: "update",
    realNodeId,
    payload: {
      title: viewOp.payload.title,
      content: viewOp.payload.content,
      level: viewOp.payload.level,
      target: viewOp.payload.target,
    },
  };

  return {
    allowed: true,
    masterOp,
    realNode,
    message: "更新操作验证通过",
  };
}

// ============================================================
// Delete Operation Handler
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
      message: "删除操作缺少节点ID",
    };
  }

  const realNodeId = mapViewToReal(viewNodeId, mappings);
  const realNode = getNode(realNodeId);

  if (!realNode) {
    return {
      allowed: false,
      masterOp: null,
      realNode: null,
      message: `Real node ${realNodeId} does not exist`,
    };
  }

  // Cannot delete root
  if (realNode.id === "root") {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: "不可删除根节点",
    };
  }

  // Check permission
  if (!canEditNode(user, realNode)) {
    return {
      allowed: false,
      masterOp: null,
      realNode,
      message: `User ${user.userId} has no permission to delete "${realNode.title}"`,
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
    message: "删除操作验证通过",
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Find realNodeId from viewNodeId via mapping table
 */
function mapViewToReal(viewNodeId: string, mappings: ViewMapping[]): string {
  const mapping = mappings.find((m) => m.viewNodeId === viewNodeId);
  return mapping ? mapping.realNodeId : viewNodeId;
}
