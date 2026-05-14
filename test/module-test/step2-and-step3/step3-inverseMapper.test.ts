/**
 * 第3步单元测试 — 逆向映射与权限校验
 *
 * 测试范围:
 *   - Insert 操作: 权限校验（各角色在各类节点下插入）
 *   - Update 操作: 权限校验（越权拦截）
 *   - Delete 操作: 权限校验（root 保护、越权拦截）
 *   - 映射表: viewNodeId → realNodeId
 *   - 错误处理: 缺少必填字段、无效节点
 *   - 各角色边界情况（admin/leader/member/guest）
 */

import { describe, it, expect } from 'vitest';
import { MasterDoc, type FlatTreeNode } from '../../backend/src/crdt/masterDoc.js';
import type { TreeNode } from '../../backend/src/crdt/masterDoc.js';
import { buildUserView } from '../../backend/src/privacy/viewBuilder.js';
import {
  mapAndValidateOperation,
  type ViewOperation,
  type MasterOperation,
} from '../../backend/src/privacy/inverseMapper.js';
import type { UserInfo } from '../../backend/src/privacy/accessControl.js';

// ============================================================
// 辅助
// ============================================================
function getTestSetup() {
  const doc = new MasterDoc();
  doc.initSampleData();
  const masterTree = doc.getMasterTree();
  return { doc, masterTree };
}

// 预设用户
const adminUser: UserInfo = { userId: 'admin01', name: '管理员', role: 'admin', group: 'admin' };
const memberA1: UserInfo = { userId: 'memberA1', name: 'A组成员1', role: 'member', group: 'groupA' };
const memberB1: UserInfo = { userId: 'memberB1', name: 'B组成员1', role: 'member', group: 'groupB' };
const guest01: UserInfo = { userId: 'guest01', name: '访客', role: 'guest', group: 'guest' };

/** 在完整树中根据 title 查找节点 ID */
function findNodeIdByTitle(tree: FlatTreeNode, title: string): string | null {
  if (tree.title === title) return tree.id;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findNodeIdByTitle(child, title);
      if (found) return found;
    }
  }
  return null;
}

// ============================================================
// 测试套件
// ============================================================

describe('inverseMapper — 逆向映射与权限校验 (第3步)', () => {
  // ==========================================================
  // 1. Insert 操作
  // ==========================================================
  describe('Insert 操作', () => {
    it('admin 在 root 下插入子节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: 'root',
          payload: { title: 'admin 新增节点' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 在 public 节点下插入子节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: publicNodeId,
          payload: { title: '成员添加的节点' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 在 A组任务（同组 group）下插入子节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const aTaskId = findNodeIdByTitle(masterTree, 'A组任务')!;
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: aTaskId,
          payload: { title: 'A组成员的新任务' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 在 B组任务（异组 group）下插入子节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const bTaskId = findNodeIdByTitle(masterTree, 'B组任务')!;
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: bTaskId,
          payload: { title: '越权插入' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('无权');
    });

    it('guest01 在任何节点下插入子节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: publicNodeId,
          payload: { title: '访客试图插入' },
        },
        guest01, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('缺少 parentViewNodeId 应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          payload: { title: '缺少父节点' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('parentViewNodeId');
    });

    it('父节点不存在应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: 'ghost-parent',
          payload: { title: '无父节点' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('不存在');
    });

    it('通过的操作应返回有效的 MasterOperation', () => {
      const { doc, masterTree } = getTestSetup();
      // admin 可以在 root 下插入；memberA1 也可以在 public 节点下插入
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: publicNodeId,
          payload: {
            title: '新节点',
            content: '内容',
            visibility: 'group',
            ownerGroup: 'groupA',
            allowedRoles: ['admin', 'member'],
          },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
      expect(result.masterOp).not.toBeNull();
      expect(result.masterOp!.type).toBe('insert');
      expect(result.masterOp!.payload.title).toBe('新节点');
      expect(result.masterOp!.parentRealNodeId).toBe(publicNodeId);
    });
  });

  // ==========================================================
  // 2. Update 操作
  // ==========================================================
  describe('Update 操作', () => {
    it('memberA1 更新 A组任务（同组 group）应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const aTaskId = findNodeIdByTitle(masterTree, 'A组任务')!;
      const view = buildUserView(masterTree, memberA1);

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: aTaskId,
          payload: { title: 'A组任务-已更新' },
        },
        memberA1, masterTree, view.mapping,
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
      expect(result.masterOp!.realNodeId).toBe(aTaskId);
    });

    it('memberA1 更新 B组任务（异组 group）应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const bTaskId = findNodeIdByTitle(masterTree, 'B组任务')!;

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: bTaskId,
          payload: { title: '越权修改 B组任务' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('无权');
    });

    it('memberA1 更新 public 节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: publicNodeId,
          payload: { title: '公开介绍-已更新' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('guest01 更新任何节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: publicNodeId,
          payload: { title: '访客越权修改' },
        },
        guest01, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('admin 更新任意节点应被允许（含 private 节点）', () => {
      const { doc, masterTree } = getTestSetup();
      const adminNoteId = findNodeIdByTitle(masterTree, '管理员备注')!;

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: adminNoteId,
          payload: { title: '管理员备注-新版' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('admin 更新 root 节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: 'root',
          payload: { title: '项目文档-更新版' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 更新 root 节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: 'root',
          payload: { title: '试图修改 root' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('缺少 viewNodeId 应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'update',
          payload: { title: '缺少 ID' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('viewNodeId');
    });

    it('目标节点不存在应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: 'ghost-node-id',
          payload: { title: '更新不存在的' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('不存在');
    });
  });

  // ==========================================================
  // 3. Delete 操作
  // ==========================================================
  describe('Delete 操作', () => {
    it('admin 删除子节点应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;

      const result = mapAndValidateOperation(
        {
          type: 'delete',
          viewNodeId: publicNodeId,
          payload: {},
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 删除 A组任务（同组）应被允许', () => {
      const { doc, masterTree } = getTestSetup();
      const aTaskId = findNodeIdByTitle(masterTree, 'A组任务')!;

      const result = mapAndValidateOperation(
        {
          type: 'delete',
          viewNodeId: aTaskId,
          payload: {},
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
    });

    it('memberA1 删除 B组任务（异组）应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const bTaskId = findNodeIdByTitle(masterTree, 'B组任务')!;

      const result = mapAndValidateOperation(
        {
          type: 'delete',
          viewNodeId: bTaskId,
          payload: {},
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('任何用户删除 root 节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const users: UserInfo[] = [adminUser, memberA1, memberB1, guest01];

      for (const user of users) {
        const result = mapAndValidateOperation(
          { type: 'delete', viewNodeId: 'root', payload: {} },
          user, masterTree, [],
          (id) => doc.getNode(id),
        );
        expect(result.allowed).toBe(false);
        expect(result.message).toContain('根节点');
      }
    });

    it('guest01 删除任意节点应被拒绝', () => {
      const { doc, masterTree } = getTestSetup();
      const publicNodeId = findNodeIdByTitle(masterTree, '公开介绍')!;

      const result = mapAndValidateOperation(
        {
          type: 'delete',
          viewNodeId: publicNodeId,
          payload: {},
        },
        guest01, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('缺少 viewNodeId 应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'delete',
          payload: {},
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('viewNodeId');
    });
  });

  // ==========================================================
  // 4. 映射表
  // ==========================================================
  describe('映射表 (viewNodeId → realNodeId)', () => {
    it('viewNodeId 应正确映射到 realNodeId', () => {
      const { doc, masterTree } = getTestSetup();
      const view = buildUserView(masterTree, memberA1);

      // 从视图映射表中查找 root 的映射
      const rootMapping = view.mapping.find((m) => m.viewNodeId === 'root');
      expect(rootMapping).toBeDefined();
      expect(rootMapping!.realNodeId).toBe('root');
    });

    it('无效的 viewNodeId 应导致映射失败', () => {
      const { doc, masterTree } = getTestSetup();
      // 使用不存在的 viewNodeId
      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: 'invalid-view-node',
          payload: { title: '无效' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
    });

    it('映射表中所有 entry 的 viewNodeId 应等于 realNodeId', () => {
      const { doc, masterTree } = getTestSetup();
      const users: UserInfo[] = [adminUser, memberA1, guest01];
      for (const user of users) {
        const view = buildUserView(masterTree, user);
        for (const m of view.mapping) {
          expect(m.viewNodeId).toBe(m.realNodeId);
        }
      }
    });
  });

  // ==========================================================
  // 5. 未知操作类型
  // ==========================================================
  describe('边界情况', () => {
    it('未知操作类型应返回错误', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'rename' as any,
          viewNodeId: 'root',
          payload: {},
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('未知');
    });

    it('拒绝的消息应包含用户 ID 以便审计', () => {
      const { doc, masterTree } = getTestSetup();
      const bTaskId = findNodeIdByTitle(masterTree, 'B组任务')!;

      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: bTaskId,
          payload: { title: '越权' },
        },
        memberA1, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('memberA1');
    });

    it('通过的消息应标记为 allowed', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'insert',
          parentViewNodeId: 'root',
          payload: { title: '正常插入' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.allowed).toBe(true);
      expect(result.message).toContain('通过');
    });

    it('realNode 应指向被操作的真实节点（非 null）', () => {
      const { doc, masterTree } = getTestSetup();
      const result = mapAndValidateOperation(
        {
          type: 'update',
          viewNodeId: 'root',
          payload: { title: '更新 root' },
        },
        adminUser, masterTree, [],
        (id) => doc.getNode(id),
      );
      expect(result.realNode).not.toBeNull();
      expect(result.realNode!.id).toBe('root');
    });
  });
});
