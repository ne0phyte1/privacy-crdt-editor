/**
 * 第3步单元测试 — 正向视图变换（Master Doc → 用户专属视图）
 *
 * 测试范围:
 *   - buildViewNode 递归构建（基于 RBAC + ABAC 过滤）
 *   - buildUserView 完整视图构建（含元数据和统计）
 *   - buildViewTree 简化视图构建
 *   - findViewNode 在视图中查找节点
 *   - 各角色视图隔离验证（admin/leader/member/guest）
 *   - 统计信息正确性（totalNodes / visibleNodes / filteredNodes）
 *   - viewNodeId === realNodeId 映射
 *   - ViewNode 结构正确性
 */

import { describe, it, expect } from 'vitest';
import { MasterDoc, type FlatTreeNode } from '../../backend/src/crdt/masterDoc.js';
import {
  buildUserView,
  buildViewTree,
  findViewNode,
  type ViewNode,
  type UserView,
} from '../../backend/src/privacy/viewBuilder.js';
import type { UserInfo } from '../../backend/src/privacy/accessControl.js';

// ============================================================
// 辅助: 获取测试用的完整树
// ============================================================
function getTestMasterTree(): FlatTreeNode {
  const doc = new MasterDoc();
  doc.initSampleData();
  return doc.getMasterTree();
}

// 预设用户
const adminUser: UserInfo = { userId: 'admin01', name: '管理员', role: 'admin', group: 'admin' };
const leaderA: UserInfo = { userId: 'leaderA', name: 'A组组长', role: 'leader', group: 'groupA' };
const memberA1: UserInfo = { userId: 'memberA1', name: 'A组成员1', role: 'member', group: 'groupA' };
const memberB1: UserInfo = { userId: 'memberB1', name: 'B组成员1', role: 'member', group: 'groupB' };
const guest01: UserInfo = { userId: 'guest01', name: '访客', role: 'guest', group: 'guest' };

// ============================================================
// 辅助: 递归统计视图节点数
// ============================================================
function countViewNodes(node: ViewNode | null): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children) {
    count += countViewNodes(child);
  }
  return count;
}

/** 递归查找视图节点 */
function findViewNodeInTree(tree: ViewNode, viewNodeId: string): ViewNode | null {
  if (tree.viewNodeId === viewNodeId) return tree;
  for (const child of tree.children) {
    const found = findViewNodeInTree(child, viewNodeId);
    if (found) return found;
  }
  return null;
}

/** 检查视图中不应包含某标题的节点 */
function assertNoNodeWithTitle(tree: ViewNode, title: string): void {
  function check(node: ViewNode): void {
    expect(node.title).not.toBe(title);
    node.children.forEach(check);
  }
  check(tree);
}

// ============================================================
// 测试套件
// ============================================================

describe('viewBuilder — 正向视图变换 (第3步)', () => {
  let masterTree: FlatTreeNode;

  // 在所有测试前准备一次完整树
  beforeAll(() => {
    masterTree = getTestMasterTree();
  });

  // ==========================================================
  // 1. 视图隔离 — admin
  // ==========================================================
  describe('admin 视图', () => {
    it('admin 应可见全部 5 个节点', () => {
      const view = buildUserView(masterTree, adminUser);
      expect(view.visibleNodeCount).toBe(5);
      expect(view.filteredCount).toBe(0);
      expect(view.tree).not.toBeNull();
    });

    it('admin 视图中应包含所有 visibility 类型节点', () => {
      const tree = buildViewTree(masterTree, adminUser)!;
      const visibilities = new Set<string>();
      function collect(node: ViewNode): void {
        visibilities.add(node.visibility);
        node.children.forEach(collect);
      }
      collect(tree);
      expect(visibilities.has('public')).toBe(true);
      expect(visibilities.has('group')).toBe(true);
      expect(visibilities.has('private')).toBe(true);
    });

    it('admin 可见 "管理员备注" (private 节点)', () => {
      const tree = buildViewTree(masterTree, adminUser)!;
      const hasAdminNote = findViewNodeInTree(tree, '') !== null
        || JSON.stringify(tree).includes('管理员备注');
      // 宽松检查：tree JSON 中应包含此标题
      expect(JSON.stringify(tree)).toContain('管理员备注');
    });
  });

  // ==========================================================
  // 2. 视图隔离 — leaderA
  // ==========================================================
  describe('leaderA 视图', () => {
    it('leaderA 应可见 3 个节点（root + public + groupA）', () => {
      const view = buildUserView(masterTree, leaderA);
      expect(view.visibleNodeCount).toBe(3);
      expect(view.filteredCount).toBe(2);
    });

    it('leaderA 可见 "公开介绍" (public 节点)', () => {
      const tree = buildViewTree(masterTree, leaderA)!;
      expect(JSON.stringify(tree)).toContain('公开介绍');
    });

    it('leaderA 可见 "A组任务" (同组 group 节点)', () => {
      const tree = buildViewTree(masterTree, leaderA)!;
      expect(JSON.stringify(tree)).toContain('A组任务');
    });

    it('leaderA 不应可见 "B组任务" (异组 group 节点)', () => {
      const tree = buildViewTree(masterTree, leaderA)!;
      assertNoNodeWithTitle(tree, 'B组任务');
    });

    it('leaderA 不应可见 "管理员备注" (private 节点)', () => {
      const tree = buildViewTree(masterTree, leaderA)!;
      assertNoNodeWithTitle(tree, '管理员备注');
    });
  });

  // ==========================================================
  // 3. 视图隔离 — memberA1
  // ==========================================================
  describe('memberA1 视图', () => {
    it('memberA1 应可见 3 个节点（root + public + groupA）', () => {
      const view = buildUserView(masterTree, memberA1);
      expect(view.visibleNodeCount).toBe(3);
      expect(view.filteredCount).toBe(2);
    });

    it('memberA1 可见 "公开介绍" 和 "A组任务"', () => {
      const tree = buildViewTree(masterTree, memberA1)!;
      const json = JSON.stringify(tree);
      expect(json).toContain('公开介绍');
      expect(json).toContain('A组任务');
    });

    it('memberA1 不应可见 "B组任务" 和 "管理员备注"', () => {
      const tree = buildViewTree(masterTree, memberA1)!;
      assertNoNodeWithTitle(tree, 'B组任务');
      assertNoNodeWithTitle(tree, '管理员备注');
    });
  });

  // ==========================================================
  // 4. 视图隔离 — memberB1
  // ==========================================================
  describe('memberB1 视图', () => {
    it('memberB1 应可见 3 个节点（root + public + groupB）', () => {
      const view = buildUserView(masterTree, memberB1);
      expect(view.visibleNodeCount).toBe(3);
      expect(view.filteredCount).toBe(2);
    });

    it('memberB1 可见 "B组任务" (同组 group 节点)', () => {
      const tree = buildViewTree(masterTree, memberB1)!;
      expect(JSON.stringify(tree)).toContain('B组任务');
    });

    it('memberB1 不应可见 "A组任务" 和 "管理员备注"', () => {
      const tree = buildViewTree(masterTree, memberB1)!;
      assertNoNodeWithTitle(tree, 'A组任务');
      assertNoNodeWithTitle(tree, '管理员备注');
    });
  });

  // ==========================================================
  // 5. 视图隔离 — guest01
  // ==========================================================
  describe('guest01 视图', () => {
    it('guest01 应可见 2 个节点（root + public）', () => {
      const view = buildUserView(masterTree, guest01);
      expect(view.visibleNodeCount).toBe(2);
      expect(view.filteredCount).toBe(3);
    });

    it('guest01 可见 "项目文档" 和 "公开介绍"', () => {
      const tree = buildViewTree(masterTree, guest01)!;
      expect(tree.title).toBe('项目文档');
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].title).toBe('公开介绍');
    });

    it('guest01 不应可见任何 group 或 private 节点', () => {
      const tree = buildViewTree(masterTree, guest01)!;
      assertNoNodeWithTitle(tree, 'A组任务');
      assertNoNodeWithTitle(tree, 'B组任务');
      assertNoNodeWithTitle(tree, '管理员备注');
    });
  });

  // ==========================================================
  // 6. buildUserView 元数据与统计
  // ==========================================================
  describe('buildUserView 元数据与统计', () => {
    it('应包含用户基本信息', () => {
      const view = buildUserView(masterTree, memberA1);
      expect(view.userId).toBe('memberA1');
      expect(view.userName).toBe('A组成员1');
      expect(view.role).toBe('member');
      expect(view.group).toBe('groupA');
    });

    it('totalNodeCount 应为 5', () => {
      const view = buildUserView(masterTree, adminUser);
      expect(view.totalNodeCount).toBe(5);
    });

    it('visibleNodeCount + filteredCount 应等于 totalNodeCount', () => {
      const users: UserInfo[] = [adminUser, leaderA, memberA1, memberB1, guest01];
      for (const user of users) {
        const view = buildUserView(masterTree, user);
        expect(view.visibleNodeCount + view.filteredCount).toBe(view.totalNodeCount);
      }
    });

    it('mapping 表应包含所有可见节点的 viewNodeId → realNodeId 映射', () => {
      const view = buildUserView(masterTree, memberA1);
      expect(view.mapping.length).toBe(view.visibleNodeCount);

      // 每个映射条目应包含 viewNodeId 和 realNodeId
      for (const m of view.mapping) {
        expect(m).toHaveProperty('viewNodeId');
        expect(m).toHaveProperty('realNodeId');
        expect(m.viewNodeId).toBe(m.realNodeId); // 简化映射设计
      }
    });
  });

  // ==========================================================
  // 7. findViewNode
  // ==========================================================
  describe('findViewNode', () => {
    it('应能找到视图中存在的节点', () => {
      const view = buildUserView(masterTree, adminUser);
      // root 节点始终存在
      const found = findViewNode(view, 'root');
      expect(found).not.toBeNull();
      expect(found!.viewNodeId).toBe('root');
      expect(found!.title).toBe('项目文档');
    });

    it('找不到不存在的节点应返回 null', () => {
      const view = buildUserView(masterTree, memberA1);
      const found = findViewNode(view, 'non-existent-id');
      expect(found).toBeNull();
    });

    it('view.tree 为 null 时应返回 null', () => {
      const emptyView: UserView = {
        userId: 'test',
        userName: 'test',
        role: 'guest',
        group: 'test',
        tree: null,
        mapping: [],
        filteredCount: 5,
        totalNodeCount: 5,
        visibleNodeCount: 0,
      };
      expect(findViewNode(emptyView, 'root')).toBeNull();
    });
  });

  // ==========================================================
  // 8. ViewNode 结构验证
  // ==========================================================
  describe('ViewNode 结构', () => {
    it('viewNodeId 应等于 realNodeId', () => {
      const view = buildUserView(masterTree, adminUser);
      for (const m of view.mapping) {
        expect(m.viewNodeId).toBe(m.realNodeId);
      }
    });

    it('每个 ViewNode 应包含必要字段', () => {
      const tree = buildViewTree(masterTree, adminUser)!;
      function checkNode(node: ViewNode): void {
        expect(node).toHaveProperty('viewNodeId');
        expect(node).toHaveProperty('realNodeId');
        expect(node).toHaveProperty('title');
        expect(node).toHaveProperty('content');
        expect(node).toHaveProperty('visibility');
        expect(node).toHaveProperty('ownerGroup');
        expect(node).toHaveProperty('children');
        expect(Array.isArray(node.children)).toBe(true);
        node.children.forEach(checkNode);
      }
      checkNode(tree);
    });

    it('children 应为嵌套 ViewNode 数组（非空数组或空数组）', () => {
      const tree = buildViewTree(masterTree, adminUser)!;
      expect(Array.isArray(tree.children)).toBe(true);
      // root 有 4 个可见子节点
      expect(tree.children.length).toBe(4);
    });

    it('已过滤节点不应出现在视图树中', () => {
      // 在 guest 视图里，应该只看到 1 个直接子节点（公开介绍）
      const tree = buildViewTree(masterTree, guest01)!;
      expect(tree.children).toHaveLength(1);
    });
  });
});
