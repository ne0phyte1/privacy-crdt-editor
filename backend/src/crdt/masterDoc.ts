import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Node Type Definition (NEW MODEL: level + target)
// ============================================================
export interface TreeNode {
  id: string;
  parentId: string;
  title: string;
  content: string;
  level: 1 | 2 | 3;
  target: string;
  deleted: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Flat node structure (for API response) */
export interface FlatTreeNode extends TreeNode {
  children?: FlatTreeNode[];
}

// ============================================================
// MasterDoc - wraps the server-side single Master Y.Doc
// ============================================================


const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "master-doc.ydoc");
export class MasterDoc {
  public doc: Y.Doc;

  /** Y.Map<string, TreeNode> - keyed by nodeId */
  private nodes: Y.Map<TreeNode>;

  /** Y.Map<string, string[]> - parentId -> childId[] */
  private children: Y.Map<string[]>;

  constructor() {
    this.doc = new Y.Doc();
    this.nodes = this.doc.getMap<TreeNode>("nodes");
    this.children = this.doc.getMap<string[]>("children");
  }

  // ==========================================================
  // Persistence
  // ==========================================================

  /** Save current Y.Doc state to disk (binary update format) */
  saveToFile(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const update = Y.encodeStateAsUpdate(this.doc);
      fs.writeFileSync(DATA_FILE, Buffer.from(update));
    } catch (err) {
      console.error("[MasterDoc] Failed to save:", (err as Error).message);
    }
  }

  /** Load Y.Doc state from disk. Returns true on success. */
  loadFromFile(): boolean {
    try {
      if (!fs.existsSync(DATA_FILE)) return false;
      const buffer = fs.readFileSync(DATA_FILE);
      const update = new Uint8Array(buffer);
      Y.applyUpdate(this.doc, update);
      console.log("[MasterDoc] Loaded persisted data (" + buffer.length + " bytes)");
      return true;
    } catch (err) {
      console.error("[MasterDoc] Failed to load persisted data:", (err as Error).message);
      return false;
    }
  }

  // ==========================================================
  // Initialize / Reset Sample Data
  // ==========================================================
  initSampleData(): void {
    this.doc.transact(() => {
      this.nodes.clear();
      this.children.clear();

      const now = new Date().toISOString();

      const rootId = "root";
      this.nodes.set(rootId, {
        id: rootId,
        parentId: "",
        title: "全域公告",
        content: "这是项目全域公告的根节点。管理员可在此创建各级子节点。",
        level: 1,
        target: "all",
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: now,
        updatedAt: now,
      });
      this.children.set(rootId, []);

      const n1 = this._createNodeInternal(
        rootId,
        "全域公告示例",
        "各位同事：\n\n欢迎使用隐私协同编辑器。本公告面向公司全体成员，所有人都可以查看。\n\n请各位遵守公司信息安全规范，妥善保管自己的账号密码。",
        1,
        "all",
        "system",
        now
      );

      const n1b = this._createNodeInternal(
        rootId,
        "全域公告-项目看板",
        "## 当前进行中的项目\n\n- 隐私编辑器 V2.0 开发\n- 数据中台建设\n- 移动端适配\n\n以上项目状态对所有成员公开。",
        1,
        "all",
        "system",
        now
      );

      const n2 = this._createNodeInternal(
        rootId,
        "GroupA-组内公告",
        "A 组成员请注意：\n\n本周五下午 3 点进行代码评审会议，请各位提前准备好相关材料。\n\n本公告仅 A 组成员可见。",
        2,
        "groupA",
        "system",
        now
      );

      const n2b = this._createNodeInternal(
        rootId,
        "GroupB-组内公告",
        "B 组成员请注意：\n\n下周一开始进行新功能联调测试，请在周五前完成单元测试编写。\n\n本公告仅 B 组成员可见。",
        2,
        "groupB",
        "system",
        now
      );

      const n3 = this._createNodeInternal(
        rootId,
        "GroupA-组间文档",
        "## 需求背景\n\n本文档记录 A 组的核心需求，仅 A 组成员可以查看和编辑。\n\n### 功能列表\n1. 文档实时协同编辑\n2. 基于角色的权限控制\n3. 树状节点管理\n\n### 时间节点\n- 第一阶段：2026年6月完成核心功能\n- 第二阶段：2026年7月完成性能优化",
        3,
        "groupA",
        "system",
        now
      );

      const n3b = this._createNodeInternal(
        rootId,
        "GroupB-组间文档",
        "## 技术架构\n\n本文档为 B 组内部技术方案，仅 B 组成员可以查看和编辑。\n\n### 技术选型\n- 前端：React + TypeScript + Vite\n- 后端：Express + TypeScript\n- CRDT：Yjs\n- 编辑器：TipTap\n\n### 安全策略\n采用 RBAC + NBAC 双重访问控制，确保数据隔离。",
        3,
        "groupB",
        "system",
        now
      );

      const rootChildren = this.children.get(rootId) || [];
      rootChildren.push(n1, n1b, n2, n2b, n3, n3b);
      this.children.set(rootId, rootChildren);
    });
  }

  // ==========================================================
  // Basic CRUD
  // ==========================================================

  /**
   * Insert a new node under the specified parent
   * @returns new node id
   */
  insertNode(
    parentId: string,
    title: string,
    content: string,
    level: 1 | 2 | 3,
    target: string,
    userId: string
  ): string {
    const newId = uuidv4();
    const now = new Date().toISOString();

    this.doc.transact(() => {
      const node: TreeNode = {
        id: newId,
        parentId,
        title,
        content,
        level,
        target,
        deleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      this.nodes.set(newId, node);

      // Update parent''s children list
      const parentChildren = this.children.get(parentId) || [];
      parentChildren.push(newId);
      this.children.set(parentId, parentChildren);
    });

    return newId;
  }

  /**
   * Update an existing node (partial fields)
   */
  updateNode(
    nodeId: string,
    fields: Partial<Pick<TreeNode, "title" | "content" | "level" | "target">>,
    userId: string
  ): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.deleted) return false;

    const now = new Date().toISOString();
    this.doc.transact(() => {
      const updated: TreeNode = {
        ...node,
        title: fields.title ?? node.title,
        content: fields.content ?? node.content,
        level: fields.level ?? node.level,
        target: fields.target ?? node.target,
        updatedBy: userId,
        updatedAt: now,
      };
      this.nodes.set(nodeId, updated);
    });
    return true;
  }

  /**
   * Soft-delete a node and all its descendants
   */
  deleteNode(nodeId: string, userId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    // Already deleted — silently succeed (no-op)
    if (node.deleted) return true;

    const now = new Date().toISOString();
    this.doc.transact(() => {
      // Recursively delete descendants
      this._recursiveDelete(nodeId, userId, now);
    });
    return true;
  }

  // ==========================================================
  // Query Methods
  // ==========================================================

  /** Get a single node */
  getNode(nodeId: string): TreeNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** Get direct child IDs of a parent */
  getChildrenIds(parentId: string): string[] {
    return this.children.get(parentId) || [];
  }

  /** Get direct child nodes of a parent (non-recursive) */
  getDirectChildren(parentId: string): TreeNode[] {
    const ids = this.getChildrenIds(parentId);
    return ids.map((id) => this.nodes.get(id)).filter(Boolean) as TreeNode[];
  }

  /**
   * Return the complete tree (flat structure with children nesting)
   * Preserves deleted nodes.
   */
  getMasterTree(): FlatTreeNode {
    return this._buildTree("root");
  }

  /**
   * Return simplified JSON of the complete tree (for debug API)
   */
  getMasterTreeJSON(): object {
    return this._toJSON(this.getMasterTree());
  }

  /** Get the raw nodes Map */
  getAllNodes(): Y.Map<TreeNode> {
    return this.nodes;
  }

  /** Get the children relationship Map */
  getAllChildren(): Y.Map<string[]> {
    return this.children;
  }

  // ==========================================================
  // Internal Helper Methods
  // ==========================================================

  /**
   * Recursively build nested tree (includes deleted nodes)
   */
  private _buildTree(nodeId: string): FlatTreeNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return {
        id: nodeId,
        parentId: "",
        title: "(deleted)",
        content: "",
        level: 1,
        target: "all",
        deleted: true,
        createdBy: "",
        updatedBy: "",
        createdAt: "",
        updatedAt: "",
        children: [],
      };
    }

    const childIds = this.getChildrenIds(nodeId);
    const children = childIds
      .map((cid) => this._buildTree(cid))
      .filter((c) => c);

    return { ...node, children };
  }

  /**
   * Convert nested tree to plain JSON (Y.Map -> plain object)
   */
  private _toJSON(tree: FlatTreeNode): object {
    return {
      id: tree.id,
      title: tree.title,
      content: tree.content,
      level: tree.level,
      target: tree.target,
      deleted: tree.deleted,
      createdBy: tree.createdBy,
      updatedBy: tree.updatedBy,
      createdAt: tree.createdAt,
      updatedAt: tree.updatedAt,
      children: (tree.children || []).map((ch) => this._toJSON(ch)),
    };
  }

  /**
   * Internal node creation (within a transact, no standalone transaction)
   */
  private _createNodeInternal(
    parentId: string,
    title: string,
    content: string,
    level: 1 | 2 | 3,
    target: string,
    userId: string,
    now: string
  ): string {
    const newId = uuidv4();
    const node: TreeNode = {
      id: newId,
      parentId,
      title,
      content,
      level,
      target,
      deleted: false,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(newId, node);
    return newId;
  }

  /**
   * Recursively delete node and its descendants
   */
  private _recursiveDelete(
    nodeId: string,
    userId: string,
    now: string
  ): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.deleted) return;

    this.nodes.set(nodeId, {
      ...node,
      deleted: true,
      updatedBy: userId,
      updatedAt: now,
    });

    const childIds = this.getChildrenIds(nodeId);
    for (const cid of childIds) {
      this._recursiveDelete(cid, userId, now);
    }
  }
}

// ============================================================
// Singleton Export
// ============================================================
let masterDocInstance: MasterDoc | null = null;

export function getMasterDoc(): MasterDoc {
  if (!masterDocInstance) {
    masterDocInstance = new MasterDoc();
    const loaded = masterDocInstance.loadFromFile();
    if (!loaded) {
      masterDocInstance.initSampleData();
      console.log("[MasterDoc] Initialized with sample data");
      masterDocInstance.saveToFile();
    }
  }
  return masterDocInstance;
}
