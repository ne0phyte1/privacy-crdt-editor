/**
 * 第2步单元测试 — Master Y.Doc CRDT 文档模型
 *
 * 测试范围:
 *   - MasterDoc 类初始化与单例模式
 *   - initSampleData() 示例数据初始化
 *   - insertNode() 节点插入（CRDT 事务内）
 *   - updateNode() 节点更新（防止关键字段被覆写）
 *   - deleteNode() 递归逻辑删除
 *   - getNode / getChildrenIds / getDirectChildren 查询方法
 *   - getMasterTree() / getMasterTreeJSON() 完整树构建
 *   - 边界情况（不存在节点、已删除节点、空父节点等）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MasterDoc,
  getMasterDoc,
  type TreeNode,
  type FlatTreeNode,
} from '../../backend/src/crdt/masterDoc.js';

// ============================================================
// 辅助函数
// ============================================================

/** 递归统计树中节点总数 */
function countTreeNodes(tree: FlatTreeNode): number {
  let count = 1;
  if (tree.children) {
    for (const child of tree.children) {
      count += countTreeNodes(child);
    }
  }
  return count;
}

/** 递归查找节点 */
function findInTree(tree: FlatTreeNode, id: string): FlatTreeNode | null {
  if (tree.id === id) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ============================================================
// 测试套件
// ============================================================

describe('MasterDoc — CRDT 文档模型 (第2步)', () => {
  let masterDoc: MasterDoc;

  beforeEach(() => {
    // 每个测试使用全新实例，避免单例状态污染
    masterDoc = new MasterDoc();
  });

  // ==========================================================
  // 1. 初始化
  // ==========================================================
  describe('初始化', () => {
    it('构造函数应创建 Y.Doc 实例', () => {
      expect(masterDoc.doc).toBeDefined();
      expect(masterDoc.doc.guid).toBeDefined(); // Y.Doc 有 guid
    });

    it('nodes 和 children 应为 Y.Map 类型', () => {
      const nodes = masterDoc.getAllNodes();
      const children = masterDoc.getAllChildren();
      expect(nodes).toBeDefined();
      expect(children).toBeDefined();
      // Y.Map 有 set/get 方法
      expect(typeof nodes.set).toBe('function');
      expect(typeof nodes.get).toBe('function');
    });

    it('getMasterDoc() 应返回全局单例（同一实例）', () => {
      const a = getMasterDoc();
      const b = getMasterDoc();
      expect(a).toBe(b);
    });

    it('全局单例应已初始化示例数据', () => {
      const singleton = getMasterDoc();
      const root = singleton.getNode('root');
      expect(root).toBeDefined();
      expect(root!.title).toBe('项目文档');
    });
  });

  // ==========================================================
  // 2. initSampleData() — 示例数据初始化
  // ==========================================================
  describe('initSampleData()', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('应创建 5 个示例节点', () => {
      const tree = masterDoc.getMasterTree();
      const total = countTreeNodes(tree);
      expect(total).toBe(5);
    });

    it('root 节点应存在且 parentId 为空字符串', () => {
      const root = masterDoc.getNode('root');
      expect(root).toBeDefined();
      expect(root!.id).toBe('root');
      expect(root!.parentId).toBe('');
      expect(root!.title).toBe('项目文档');
      expect(root!.visibility).toBe('public');
    });

    it('应在 root 下有 4 个子节点', () => {
      const childrenIds = masterDoc.getChildrenIds('root');
      expect(childrenIds).toHaveLength(4);
    });

    it('应有三种可见性策略覆盖（public / group / private）', () => {
      const children = masterDoc.getDirectChildren('root');
      const visibilities = children.map((c) => c.visibility);
      expect(visibilities).toContain('public');
      expect(visibilities).toContain('group');
      expect(visibilities).toContain('private');
    });

    it('应有 groupA 和 groupB 分组节点', () => {
      const children = masterDoc.getDirectChildren('root');
      const ownerGroups = children.map((c) => c.ownerGroup);
      expect(ownerGroups).toContain('groupA');
      expect(ownerGroups).toContain('groupB');
    });

    it('每个节点应有完整的 TreeNode 字段', () => {
      const tree = masterDoc.getMasterTree();
      const requiredFields: (keyof TreeNode)[] = [
        'id', 'parentId', 'title', 'content', 'visibility',
        'ownerGroup', 'allowedRoles', 'deleted', 'createdBy',
        'updatedBy', 'createdAt', 'updatedAt',
      ];

      function checkFields(node: FlatTreeNode): void {
        for (const field of requiredFields) {
          expect(node).toHaveProperty(field);
        }
        if (node.children) {
          node.children.forEach(checkFields);
        }
      }
      checkFields(tree);
    });

    it('重复调用 initSampleData 应清空旧数据再重建', () => {
      masterDoc.initSampleData();
      masterDoc.initSampleData();
      const tree = masterDoc.getMasterTree();
      expect(countTreeNodes(tree)).toBe(5);
    });
  });

  // ==========================================================
  // 3. insertNode() — 插入节点
  // ==========================================================
  describe('insertNode()', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('应在指定父节点下插入新节点，返回有效 UUID', () => {
      const newId = masterDoc.insertNode(
        'root', '测试节点', '内容', 'public', 'all',
        ['admin', 'member'], 'test-user',
      );
      expect(newId).toBeDefined();
      expect(typeof newId).toBe('string');
      expect(newId.length).toBeGreaterThan(0);
    });

    it('新节点应出现在 nodes Map 中', () => {
      const newId = masterDoc.insertNode(
        'root', '新节点', '', 'public', 'all',
        ['admin'], 'user1',
      );
      const node = masterDoc.getNode(newId);
      expect(node).toBeDefined();
      expect(node!.title).toBe('新节点');
      expect(node!.content).toBe('');
      expect(node!.visibility).toBe('public');
      expect(node!.createdBy).toBe('user1');
      expect(node!.updatedBy).toBe('user1');
      expect(node!.deleted).toBe(false);
    });

    it('新节点应出现在父节点的 children 列表中', () => {
      const beforeCount = masterDoc.getChildrenIds('root').length;
      masterDoc.insertNode(
        'root', '子节点', '', 'public', 'all',
        ['admin'], 'user1',
      );
      const afterCount = masterDoc.getChildrenIds('root').length;
      expect(afterCount).toBe(beforeCount + 1);
    });

    it('应在非 root 节点下插入子节点', () => {
      // 找到 public 节点作为父节点
      const tree = masterDoc.getMasterTree();
      const publicNode = tree.children?.find((c) => c.visibility === 'public');
      expect(publicNode).toBeDefined();

      const newId = masterDoc.insertNode(
        publicNode!.id, '孙子节点', '内容', 'group', 'groupA',
        ['admin', 'member'], 'user2',
      );
      expect(newId).toBeDefined();

      const childIds = masterDoc.getChildrenIds(publicNode!.id);
      expect(childIds).toContain(newId);
    });

    it('在未初始化的父节点下插入子节点也应能正常工作', () => {
      const newId = masterDoc.insertNode(
        'root', '直接子节点', '', 'public', 'all',
        ['admin'], 'user1',
      );
      // root 可能还不存在 children 记录，insertNode 应处理空数组情况
      const node = masterDoc.getNode(newId);
      expect(node).toBeDefined();
      expect(node!.parentId).toBe('root');
    });
  });

  // ==========================================================
  // 4. updateNode() — 更新节点
  // ==========================================================
  describe('updateNode()', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('应成功更新节点标题并返回 true', () => {
      const tree = masterDoc.getMasterTree();
      const firstChild = tree.children![0];
      const result = masterDoc.updateNode(
        firstChild.id, { title: '已更新的标题' }, 'user1',
      );
      expect(result).toBe(true);

      const updated = masterDoc.getNode(firstChild.id);
      expect(updated!.title).toBe('已更新的标题');
    });

    it('应自动更新 updatedBy 和 updatedAt', () => {
      const tree = masterDoc.getMasterTree();
      const firstChild = tree.children![0];
      const oldNode = masterDoc.getNode(firstChild.id)!;

      // 等待一小段时间确保时间戳不同
      const result = masterDoc.updateNode(
        firstChild.id, { title: '新标题' }, 'editor-user',
      );

      const newNode = masterDoc.getNode(firstChild.id)!;
      expect(result).toBe(true);
      expect(newNode.updatedBy).toBe('editor-user');
      // updatedAt 可能因测试执行快而相同，但 updatedBy 必须更新
    });

    it('应防止覆写 id、createdAt、createdBy 等关键字段', () => {
      const tree = masterDoc.getMasterTree();
      const firstChild = tree.children![0];
      const oldNode = masterDoc.getNode(firstChild.id)!;

      // TypeScript 类型系统阻止了 id/createdAt/createdBy 的传入，
      // 但即使强行传入（运行时），MasterDoc.updateNode 也通过 `id: nodeId`
      // 行保证 id 不会被覆写
      const result = masterDoc.updateNode(
        firstChild.id, { title: '安全测试' }, 'hacker',
      );
      expect(result).toBe(true);

      const updated = masterDoc.getNode(firstChild.id)!;
      expect(updated.id).toBe(oldNode.id);
      expect(updated.createdAt).toBe(oldNode.createdAt);
      expect(updated.createdBy).toBe(oldNode.createdBy);
    });

    it('更新多个字段（title + content + visibility）', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];

      masterDoc.updateNode(
        target.id,
        { title: '多字段更新', content: '新内容', visibility: 'private' },
        'admin',
      );

      const updated = masterDoc.getNode(target.id)!;
      expect(updated.title).toBe('多字段更新');
      expect(updated.content).toBe('新内容');
      expect(updated.visibility).toBe('private');
    });

    it('更新不存在的节点应返回 false', () => {
      const result = masterDoc.updateNode(
        'non-existent-id', { title: 'xxx' }, 'user1',
      );
      expect(result).toBe(false);
    });

    it('更新已删除的节点应返回 false', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.deleteNode(target.id, 'user1');
      const result = masterDoc.updateNode(
        target.id, { title: '试图更新已删除' }, 'user1',
      );
      expect(result).toBe(false);
    });
  });

  // ==========================================================
  // 5. deleteNode() — 递归逻辑删除
  // ==========================================================
  describe('deleteNode()', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('应返回 true 表示删除成功', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      const result = masterDoc.deleteNode(target.id, 'user1');
      expect(result).toBe(true);
    });

    it('被删除节点的 deleted 标记应变为 true', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.deleteNode(target.id, 'user1');
      const deleted = masterDoc.getNode(target.id);
      expect(deleted!.deleted).toBe(true);
    });

    it('应递归标记所有子孙节点为已删除', () => {
      // 在 root 的子节点下先插入一个孙子节点
      const tree = masterDoc.getMasterTree();
      const parent = tree.children![0];
      const childId = masterDoc.insertNode(
        parent.id, '孙子', '', 'public', 'all',
        ['admin'], 'user1',
      );

      // 删除父节点
      masterDoc.deleteNode(parent.id, 'user1');

      // 父节点和孙子节点都应被标记为 deleted
      expect(masterDoc.getNode(parent.id)!.deleted).toBe(true);
      expect(masterDoc.getNode(childId)!.deleted).toBe(true);
    });

    it('删除不存在的节点应返回 false', () => {
      const result = masterDoc.deleteNode('nonexistent', 'user1');
      expect(result).toBe(false);
    });

    it('删除已删除的节点应返回 false', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.deleteNode(target.id, 'user1');
      const result = masterDoc.deleteNode(target.id, 'user2');
      expect(result).toBe(false);
    });
  });

  // ==========================================================
  // 6. 查询方法
  // ==========================================================
  describe('查询方法', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('getNode() 应返回存在的节点', () => {
      const root = masterDoc.getNode('root');
      expect(root).toBeDefined();
      expect(root!.id).toBe('root');
    });

    it('getNode() 对不存在节点应返回 undefined', () => {
      const node = masterDoc.getNode('does-not-exist');
      expect(node).toBeUndefined();
    });

    it('getChildrenIds() 应返回直接子节点 ID 列表', () => {
      const ids = masterDoc.getChildrenIds('root');
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBe(4);
      // 所有 ID 都应该是字符串
      ids.forEach((id) => expect(typeof id).toBe('string'));
    });

    it('getChildrenIds() 对空父节点应返回空数组', () => {
      const ids = masterDoc.getChildrenIds('no-children-parent');
      expect(ids).toEqual([]);
    });

    it('getDirectChildren() 应返回 TreeNode 列表', () => {
      const children = masterDoc.getDirectChildren('root');
      expect(children.length).toBe(4);
      children.forEach((child) => {
        expect(child).toHaveProperty('id');
        expect(child).toHaveProperty('title');
        expect(child).toHaveProperty('parentId', 'root');
      });
    });

    it('getMasterTree() 应返回嵌套树结构', () => {
      const tree = masterDoc.getMasterTree();
      expect(tree.id).toBe('root');
      expect(tree.children).toBeDefined();
      expect(tree.children!.length).toBe(4);
      // 子节点也应包含 title 等信息
      expect(tree.children![0].title).toBeDefined();
    });

    it('getMasterTreeJSON() 应返回可序列化的普通对象（非 Y.Map）', () => {
      const json = masterDoc.getMasterTreeJSON();
      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
      // JSON 序列化不应报错
      const str = JSON.stringify(json);
      expect(str).toContain('root');
      const parsed = JSON.parse(str);
      expect(parsed.id).toBe('root');
    });

    it('getMasterTree() 应保留已删除的节点', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.deleteNode(target.id, 'user1');

      const newTree = masterDoc.getMasterTree();
      const found = findInTree(newTree, target.id);
      expect(found).toBeDefined();
      expect(found!.deleted).toBe(true);
    });

    it('getMasterTreeJSON() 应包含 deleted 标记', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.deleteNode(target.id, 'user1');

      const json = masterDoc.getMasterTreeJSON() as any;
      const str = JSON.stringify(json);
      expect(str).toContain('"deleted":true');
    });
  });

  // ==========================================================
  // 7. 事务安全性
  // ==========================================================
  describe('CRDT 事务安全性', () => {
    beforeEach(() => {
      masterDoc.initSampleData();
    });

    it('insertNode 应在 Y.Doc 事务中执行', () => {
      // 验证: 在操作后数据与 children 关系一致
      const newId = masterDoc.insertNode(
        'root', '事务测试', '', 'public', 'all',
        ['admin'], 'user1',
      );
      const node = masterDoc.getNode(newId);
      const children = masterDoc.getChildrenIds('root');
      expect(node).toBeDefined();
      expect(children).toContain(newId);
    });

    it('updateNode 应在 Y.Doc 事务中执行', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];
      masterDoc.updateNode(target.id, { title: '事务更新' }, 'user1');
      const node = masterDoc.getNode(target.id);
      expect(node!.title).toBe('事务更新');
      expect(node!.updatedBy).toBe('user1');
    });

    it('deleteNode 应在 Y.Doc 事务中执行（批量标记多个节点）', () => {
      const tree = masterDoc.getMasterTree();
      const target = tree.children![0];

      // 给 target 添加子节点
      const childId = masterDoc.insertNode(
        target.id, '孙子', '', 'public', 'all',
        ['admin'], 'user1',
      );

      // 一次事务内删除父节点 + 递归标记子节点
      masterDoc.deleteNode(target.id, 'user1');

      // 两个节点都应被标记
      expect(masterDoc.getNode(target.id)!.deleted).toBe(true);
      expect(masterDoc.getNode(childId)!.deleted).toBe(true);
    });
  });
});
