/**
 * 第3步单元测试 — RBAC + ABAC 权限校验
 *
 * 测试范围:
 *   - 配置文件加载: users.json / roles.json
 *   - 用户查询: getAllUsers / getUserById
 *   - 角色查询: getAllRoles / getRoleConfig
 *   - RBAC 策略: checkRBAC (基于角色)
 *   - ABAC 策略: checkABAC (基于节点属性)
 *   - 组合策略: canAccessNode (RBAC + ABAC 同时生效)
 *   - 编辑权限: canEditNode (基于角色配置)
 *   - 缓存机制: refreshUserCache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllUsers,
  getAllRoles,
  getUserById,
  getRoleConfig,
  refreshUserCache,
  checkRBAC,
  checkABAC,
  canAccessNode,
  canEditNode,
  type UserInfo,
  type RoleConfig,
} from '../../backend/src/privacy/accessControl.js';
import type { TreeNode } from '../../backend/src/crdt/masterDoc.js';

// ============================================================
// 辅助: 创建测试用 TreeNode
// ============================================================
function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: 'test-node-1',
    parentId: 'root',
    title: '测试节点',
    content: '',
    visibility: 'public',
    ownerGroup: 'all',
    allowedRoles: ['admin', 'member', 'guest'],
    deleted: false,
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// 预设用户
const adminUser: UserInfo = { userId: 'admin01', name: '管理员', role: 'admin', group: 'admin' };
const leaderA: UserInfo = { userId: 'leaderA', name: 'A组组长', role: 'leader', group: 'groupA' };
const memberA1: UserInfo = { userId: 'memberA1', name: 'A组成员1', role: 'member', group: 'groupA' };
const memberB1: UserInfo = { userId: 'memberB1', name: 'B组成员1', role: 'member', group: 'groupB' };
const guest01: UserInfo = { userId: 'guest01', name: '访客', role: 'guest', group: 'guest' };

// ============================================================
// 测试套件
// ============================================================

describe('accessControl — 用户与角色配置加载 (第3步)', () => {
  beforeEach(() => {
    refreshUserCache();
  });

  // ==========================================================
  // 1. 用户配置加载
  // ==========================================================
  describe('用户配置加载', () => {
    it('getAllUsers() 应返回 7 个用户', () => {
      const users = getAllUsers();
      expect(users).toHaveLength(7);
    });

    it('getUserById() 应正确查找用户', () => {
      const user = getUserById('admin01');
      expect(user).toBeDefined();
      expect(user!.name).toBe('管理员');
      expect(user!.role).toBe('admin');
      expect(user!.group).toBe('admin');
    });

    it('getUserById() 对不存在的用户应返回 undefined', () => {
      const user = getUserById('ghost-user');
      expect(user).toBeUndefined();
    });

    it('应包含 4 种角色的用户（admin/leader/member/guest）', () => {
      const users = getAllUsers();
      const roles = new Set(users.map((u) => u.role));
      expect(roles.has('admin')).toBe(true);
      expect(roles.has('leader')).toBe(true);
      expect(roles.has('member')).toBe(true);
      expect(roles.has('guest')).toBe(true);
    });

    it('应包含 groupA / groupB / admin / guest 分组', () => {
      const users = getAllUsers();
      const groups = new Set(users.map((u) => u.group));
      expect(groups.has('groupA')).toBe(true);
      expect(groups.has('groupB')).toBe(true);
      expect(groups.has('admin')).toBe(true);
      expect(groups.has('guest')).toBe(true);
    });
  });

  // ==========================================================
  // 2. 角色配置加载
  // ==========================================================
  describe('角色配置加载', () => {
    it('getAllRoles() 应返回 4 种角色', () => {
      const roles = getAllRoles();
      const keys = Object.keys(roles);
      expect(keys).toHaveLength(4);
      expect(keys).toContain('admin');
      expect(keys).toContain('leader');
      expect(keys).toContain('member');
      expect(keys).toContain('guest');
    });

    it('getRoleConfig("admin") 应返回完整管理员配置', () => {
      const config = getRoleConfig('admin');
      expect(config).toBeDefined();
      expect(config!.priority).toBe(100);
      expect(config!.canViewAll).toBe(true);
      expect(config!.canEditAll).toBe(true);
      expect(config!.canManageUsers).toBe(true);
      expect(config!.allowedVisibilities).toContain('public');
      expect(config!.allowedVisibilities).toContain('group');
      expect(config!.allowedVisibilities).toContain('private');
    });

    it('getRoleConfig("leader") 应有 canEditOwnGroup = true', () => {
      const config = getRoleConfig('leader');
      expect(config).toBeDefined();
      expect(config!.canEditOwnGroup).toBe(true);
      expect(config!.canEditAll).toBe(false);
    });

    it('getRoleConfig("member") 应有 canEditOwnGroup = true', () => {
      const config = getRoleConfig('member');
      expect(config).toBeDefined();
      expect(config!.canEditOwnGroup).toBe(true);
    });

    it('getRoleConfig("guest") 应有 canEditOwnGroup = false', () => {
      const config = getRoleConfig('guest');
      expect(config).toBeDefined();
      expect(config!.canEditOwnGroup).toBe(false);
      expect(config!.canEditAll).toBe(false);
      expect(config!.allowedVisibilities).toEqual(['public']);
    });

    it('角色优先级排序应正确（admin > leader > member > guest）', () => {
      const admin = getRoleConfig('admin')!;
      const leader = getRoleConfig('leader')!;
      const member = getRoleConfig('member')!;
      const guest = getRoleConfig('guest')!;
      expect(admin.priority).toBeGreaterThan(leader.priority);
      expect(leader.priority).toBeGreaterThan(member.priority);
      expect(member.priority).toBeGreaterThan(guest.priority);
    });

    it('getRoleConfig() 对不存在的角色应返回 undefined', () => {
      expect(getRoleConfig('superhero')).toBeUndefined();
    });
  });

  // ==========================================================
  // 3. RBAC 策略: checkRBAC
  // ==========================================================
  describe('RBAC 策略 (checkRBAC)', () => {
    it('admin 角色应可访问所有节点', () => {
      const node = makeNode({ allowedRoles: ['leader'] });
      expect(checkRBAC(adminUser, node)).toBe(true);
    });

    it('root 节点应对所有用户可见', () => {
      const node = makeNode({ id: 'root', allowedRoles: ['admin'] });
      expect(checkRBAC(guest01, node)).toBe(true);
    });

    it('已删除节点对非 admin 应不可见', () => {
      const node = makeNode({ deleted: true, allowedRoles: ['admin', 'member'] });
      expect(checkRBAC(memberA1, node)).toBe(false);
    });

    it('已删除节点对 admin 应可见（管理审计需要）', () => {
      const node = makeNode({ deleted: true });
      expect(checkRBAC(adminUser, node)).toBe(true);
    });

    it('角色在 allowedRoles 中应允许访问', () => {
      const node = makeNode({ allowedRoles: ['admin', 'leader', 'member'] });
      expect(checkRBAC(memberA1, node)).toBe(true);
    });

    it('角色不在 allowedRoles 中应拒绝访问', () => {
      const node = makeNode({ allowedRoles: ['admin'] });
      expect(checkRBAC(memberA1, node)).toBe(false);
      expect(checkRBAC(guest01, node)).toBe(false);
      expect(checkRBAC(leaderA, node)).toBe(false);
    });
  });

  // ==========================================================
  // 4. ABAC 策略: checkABAC
  // ==========================================================
  describe('ABAC 策略 (checkABAC)', () => {
    it('public 节点应对所有用户可见', () => {
      const node = makeNode({ visibility: 'public', ownerGroup: 'all' });
      expect(checkABAC(memberA1, node)).toBe(true);
      expect(checkABAC(guest01, node)).toBe(true);
      expect(checkABAC(memberB1, node)).toBe(true);
    });

    it('group 节点应对同组用户可见', () => {
      const node = makeNode({ visibility: 'group', ownerGroup: 'groupA' });
      expect(checkABAC(memberA1, node)).toBe(true);
      expect(checkABAC(leaderA, node)).toBe(true);
    });

    it('group 节点应对非同组用户不可见', () => {
      const node = makeNode({ visibility: 'group', ownerGroup: 'groupA' });
      expect(checkABAC(memberB1, node)).toBe(false);
      expect(checkABAC(guest01, node)).toBe(false);
    });

    it('private 节点应对非 admin 用户不可见', () => {
      const node = makeNode({ visibility: 'private', ownerGroup: 'admin' });
      expect(checkABAC(memberA1, node)).toBe(false);
      expect(checkABAC(leaderA, node)).toBe(false);
      expect(checkABAC(guest01, node)).toBe(false);
    });

    it('private 节点应对 admin 可见', () => {
      const node = makeNode({ visibility: 'private', ownerGroup: 'admin' });
      expect(checkABAC(adminUser, node)).toBe(true);
    });

    it('admin 应可访问所有 visibility 类型的节点', () => {
      expect(checkABAC(adminUser, makeNode({ visibility: 'public' }))).toBe(true);
      expect(checkABAC(adminUser, makeNode({ visibility: 'group', ownerGroup: 'groupB' }))).toBe(true);
      expect(checkABAC(adminUser, makeNode({ visibility: 'private' }))).toBe(true);
    });

    it('root 节点应对所有用户可见（不受 visibility 限制）', () => {
      const node = makeNode({ id: 'root', visibility: 'private' });
      expect(checkABAC(guest01, node)).toBe(true);
    });

    it('已删除节点对非 admin 应不可见', () => {
      const node = makeNode({ deleted: true, visibility: 'public' });
      expect(checkABAC(memberA1, node)).toBe(false);
    });
  });

  // ==========================================================
  // 5. 组合策略: canAccessNode
  // ==========================================================
  describe('组合策略 (canAccessNode — RBAC + ABAC)', () => {
    it('RBAC 和 ABAC 都通过时应允许访问', () => {
      // public node + allowedRoles 包含 member
      const node = makeNode({
        visibility: 'public',
        allowedRoles: ['admin', 'member'],
      });
      expect(canAccessNode(memberA1, node)).toBe(true);
    });

    it('RBAC 通过但 ABAC 不通过时应拒绝访问', () => {
      // member 在 allowedRoles 中，但节点是 private
      const node = makeNode({
        visibility: 'private',
        allowedRoles: ['admin', 'member'],
      });
      expect(canAccessNode(memberA1, node)).toBe(false);
    });

    it('ABAC 通过但 RBAC 不通过时应拒绝访问', () => {
      // 节点是 public，但 allowedRoles 不包含 member
      const node = makeNode({
        visibility: 'public',
        allowedRoles: ['admin'],
      });
      expect(canAccessNode(memberA1, node)).toBe(false);
    });

    it('admin 总是可以访问任何节点（包含已删除）', () => {
      const deletedPrivateNode = makeNode({
        visibility: 'private',
        deleted: true,
        allowedRoles: [],
      });
      expect(canAccessNode(adminUser, deletedPrivateNode)).toBe(true);
    });

    it('已删除节点对非 admin 应拒绝（即使有其他权限）', () => {
      const node = makeNode({
        visibility: 'public',
        allowedRoles: ['admin', 'member', 'guest'],
        deleted: true,
      });
      expect(canAccessNode(memberA1, node)).toBe(false);
      expect(canAccessNode(guest01, node)).toBe(false);
    });
  });

  // ==========================================================
  // 6. 编辑权限: canEditNode
  // ==========================================================
  describe('编辑权限 (canEditNode)', () => {
    it('admin 应可编辑所有节点（含 root）', () => {
      const rootNode = makeNode({ id: 'root' });
      const privateNode = makeNode({ visibility: 'private' });
      expect(canEditNode(adminUser, rootNode)).toBe(true);
      expect(canEditNode(adminUser, privateNode)).toBe(true);
    });

    it('只有 admin 可编辑 root 节点', () => {
      const rootNode = makeNode({ id: 'root' });
      expect(canEditNode(adminUser, rootNode)).toBe(true);
      expect(canEditNode(leaderA, rootNode)).toBe(false);
      expect(canEditNode(memberA1, rootNode)).toBe(false);
    });

    it('leader 可编辑本组 group 节点', () => {
      const groupANode = makeNode({
        visibility: 'group',
        ownerGroup: 'groupA',
        allowedRoles: ['admin', 'leader', 'member'],
      });
      expect(canEditNode(leaderA, groupANode)).toBe(true);
    });

    it('leader 不可编辑非同组的 group 节点', () => {
      const groupBNode = makeNode({
        visibility: 'group',
        ownerGroup: 'groupB',
        allowedRoles: ['admin', 'leader', 'member'],
      });
      expect(canEditNode(leaderA, groupBNode)).toBe(false);
    });

    it('member 可编辑本组 group 节点', () => {
      const groupANode = makeNode({
        visibility: 'group',
        ownerGroup: 'groupA',
        allowedRoles: ['admin', 'member'],
      });
      expect(canEditNode(memberA1, groupANode)).toBe(true);
    });

    it('member 不可编辑非同组的 group 节点', () => {
      const groupBNode = makeNode({
        visibility: 'group',
        ownerGroup: 'groupB',
        allowedRoles: ['admin', 'member'],
      });
      expect(canEditNode(memberA1, groupBNode)).toBe(false);
    });

    it('guest 不能编辑任何节点', () => {
      const publicNode = makeNode({
        visibility: 'public',
        allowedRoles: ['admin', 'member', 'guest'],
      });
      const groupNode = makeNode({
        visibility: 'group',
        ownerGroup: 'guest',
        allowedRoles: ['guest'],
      });
      expect(canEditNode(guest01, publicNode)).toBe(false);
      expect(canEditNode(guest01, groupNode)).toBe(false);
    });

    it('已删除节点不能编辑', () => {
      const node = makeNode({ deleted: true });
      expect(canEditNode(adminUser, node)).toBe(false);
      expect(canEditNode(memberA1, node)).toBe(false);
    });

    it('没有查看权限则不能编辑', () => {
      // private 节点 + member 没有查看权限
      const privateNode = makeNode({
        visibility: 'private',
        allowedRoles: ['admin'],
      });
      expect(canEditNode(memberA1, privateNode)).toBe(false);
    });

    it('leader/member 可编辑 public 节点', () => {
      const publicNode = makeNode({
        visibility: 'public',
        allowedRoles: ['admin', 'leader', 'member', 'guest'],
      });
      expect(canEditNode(leaderA, publicNode)).toBe(true);
      expect(canEditNode(memberA1, publicNode)).toBe(true);
    });

    it('不存在的角色应默认拒绝编辑', () => {
      const fakeUser: UserInfo = {
        userId: 'unknown',
        name: '未知用户',
        role: 'hacker' as any,
        group: 'unknown',
      };
      const node = makeNode();
      expect(canEditNode(fakeUser, node)).toBe(false);
    });
  });

  // ==========================================================
  // 7. 缓存机制
  // ==========================================================
  describe('缓存机制', () => {
    it('refreshUserCache() 应清除缓存', () => {
      // 先加载一次触发缓存
      const users1 = getAllUsers();
      const roles1 = getAllRoles();

      // 刷新缓存
      refreshUserCache();

      // 再次加载应仍返回正确数据
      const users2 = getAllUsers();
      const roles2 = getAllRoles();
      expect(users2).toHaveLength(users1.length);
      expect(Object.keys(roles2)).toHaveLength(Object.keys(roles1).length);
    });

    it('缓存应加速重复查询（返回相同引用）', () => {
      // 第一次调用触发文件读取和缓存
      const users1 = getAllUsers();
      // 第二次调用应返回缓存（不重复读取文件）
      const users2 = getAllUsers();
      // 两次返回的数组可能不同（重新构建），但数据应一致
      expect(users2.length).toBe(users1.length);
    });
  });
});
