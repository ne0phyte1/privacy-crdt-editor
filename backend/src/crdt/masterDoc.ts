import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// 节点类型定义
// ============================================================
export interface TreeNode {
  id: string;
  parentId: string;
  title: string;
  content: string;
  visibility: "public" | "group" | "private";
  ownerGroup: string;
  allowedRoles: string[];
  deleted: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 扁平节点结构（用于 API 返回） */
export interface FlatTreeNode extends TreeNode {
  children?: FlatTreeNode[];
}

// ============================================================
// MasterDoc — 封装服务端唯一的 Master Y.Doc
// ============================================================
export class MasterDoc {
  public doc: Y.Doc;

  /** Y.Map<string, TreeNode> — 以 nodeId 为 key */
  private nodes: Y.Map<TreeNode>;

  /** Y.Map<string, string[]> — parentId → childId[] */
  private children: Y.Map<string[]>;

  constructor() {
    this.doc = new Y.Doc();
    this.nodes = this.doc.getMap<TreeNode>("nodes");
    this.children = this.doc.getMap<string[]>("children");
  }

  // ==========================================================
  // 初始化 / 重置示例数据
  // ==========================================================
  initSampleData(): void {
    this.doc.transact(() => {
      // 清空
      this.nodes.clear();
      this.children.clear();

      const now = new Date().toISOString();

      // root
      const rootId = "root";
      this.nodes.set(rootId, {
        id: rootId,
        parentId: "",
        title: "项目文档",
        content: "这是项目的根节点",
        visibility: "public",
        ownerGroup: "all",
        allowedRoles: ["admin", "member", "guest"],
        deleted: false,
        createdBy: "system",
        updatedBy: "system",
        createdAt: now,
        updatedAt: now,
      });
      this.children.set(rootId, []);

      // 公开介绍
      const n1 = this._createNodeInternal(
        rootId,
        "公开介绍",
        "这是所有人都能看到的公开内容。",
        "public",
        "all",
        ["admin", "member", "guest"],
        "system",
        now
      );

      // A 组任务
      const n2 = this._createNodeInternal(
        rootId,
        "A组任务",
        "只有 A 组角色可以查看和编辑",
        "group",
        "groupA",
        ["admin", "member"],
        "system",
        now
      );

      // B 组任务
      const n3 = this._createNodeInternal(
        rootId,
        "B组任务",
        "只有 B 组角色可以查看和编辑",
        "group",
        "groupB",
        ["admin", "member"],
        "system",
        now
      );

      // 管理员备注
      const n4 = this._createNodeInternal(
        rootId,
        "管理员备注",
        "仅管理员可见的敏感信息",
        "private",
        "admin",
        ["admin"],
        "system",
        now
      );

      // 给 root 添加子节点
      const rootChildren = this.children.get(rootId) || [];
      rootChildren.push(n1, n2, n3, n4);
      this.children.set(rootId, rootChildren);
    });
  }

  // ==========================================================
  // 基础 CRUD
  // ==========================================================

  /**
   * 在指定父节点下插入一个新节点
   * @returns 新节点 id
   */
  insertNode(
    parentId: string,
    title: string,
    content: string,
    visibility: "public" | "group" | "private",
    ownerGroup: string,
    allowedRoles: string[],
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
        visibility,
        ownerGroup,
        allowedRoles,
        deleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      this.nodes.set(newId, node);

      // 更新 parent 的 children 列表
      const parentChildren = this.children.get(parentId) || [];
      parentChildren.push(newId);
      this.children.set(parentId, parentChildren);
    });

    return newId;
  }

  /**
   * 更新节点字段（只更新传入的字段）
   */
  updateNode(
    nodeId: string,
    fields: Partial<Omit<TreeNode, "id" | "createdAt" | "createdBy">>,
    userId: string
  ): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.deleted) return false;

    const now = new Date().toISOString();
    this.doc.transact(() => {
      this.nodes.set(nodeId, {
        ...node,
        ...fields,
        id: nodeId, // 防止被覆盖
        updatedBy: userId,
        updatedAt: now,
      });
    });
    return true;
  }

  /**
   * 逻辑删除节点及其所有子孙节点
   */
  deleteNode(nodeId: string, userId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node || node.deleted) return false;

    const now = new Date().toISOString();
    this.doc.transact(() => {
      // 递归删除子孙
      this._recursiveDelete(nodeId, userId, now);
    });
    return true;
  }

  // ==========================================================
  // 查询方法
  // ==========================================================

  /** 获取单个节点 */
  getNode(nodeId: string): TreeNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** 获取某个父节点下的直接子节点 id 列表 */
  getChildrenIds(parentId: string): string[] {
    return this.children.get(parentId) || [];
  }

  /** 获取某个父节点下的直接子节点列表（非递归） */
  getDirectChildren(parentId: string): TreeNode[] {
    const ids = this.getChildrenIds(parentId);
    return ids.map((id) => this.nodes.get(id)).filter(Boolean) as TreeNode[];
  }

  /**
   * 返回完整树（扁平结构带 children 嵌套）
   * 不清除 deleted 节点，保留原始数据
   */
  getMasterTree(): FlatTreeNode {
    return this._buildTree("root");
  }

  /**
   * 返回完整树的简化 JSON（用于 debug API）
   */
  getMasterTreeJSON(): object {
    return this._toJSON(this.getMasterTree());
  }

  /** 获取所有节点的原始 Map */
  getAllNodes(): Y.Map<TreeNode> {
    return this.nodes;
  }

  /** 获取 children 关系 Map */
  getAllChildren(): Y.Map<string[]> {
    return this.children;
  }

  // ==========================================================
  // 内部辅助方法
  // ==========================================================

  /**
   * 递归构建嵌套树（包含 deleted 节点）
   */
  private _buildTree(nodeId: string): FlatTreeNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return {
        id: nodeId,
        parentId: "",
        title: "(deleted)",
        content: "",
        visibility: "public",
        ownerGroup: "all",
        allowedRoles: [],
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
   * 将嵌套树转为纯 JSON（Y.Map 转普通对象）
   */
  private _toJSON(tree: FlatTreeNode): object {
    return {
      id: tree.id,
      title: tree.title,
      content: tree.content,
      visibility: tree.visibility,
      ownerGroup: tree.ownerGroup,
      allowedRoles: tree.allowedRoles,
      deleted: tree.deleted,
      createdBy: tree.createdBy,
      updatedBy: tree.updatedBy,
      createdAt: tree.createdAt,
      updatedAt: tree.updatedAt,
      children: (tree.children || []).map((ch) => this._toJSON(ch)),
    };
  }

  /**
   * 内部创建节点（不开启独立事务，供 transact 内调用）
   */
  private _createNodeInternal(
    parentId: string,
    title: string,
    content: string,
    visibility: "public" | "group" | "private",
    ownerGroup: string,
    allowedRoles: string[],
    userId: string,
    now: string
  ): string {
    const newId = uuidv4();
    const node: TreeNode = {
      id: newId,
      parentId,
      title,
      content,
      visibility,
      ownerGroup,
      allowedRoles,
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
   * 递归删除节点及其子孙节点
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
// 单例导出
// ============================================================
let masterDocInstance: MasterDoc | null = null;

export function getMasterDoc(): MasterDoc {
  if (!masterDocInstance) {
    masterDocInstance = new MasterDoc();
    masterDocInstance.initSampleData();
  }
  return masterDocInstance;
}
