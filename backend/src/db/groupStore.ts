import memoryDB from "./database.js";

// ============================================================
// 分组数据访问层 — 内存 CRUD 操作
// ============================================================

export interface GroupRecord {
  group_name: string;
  description: string;
  created_at: string;
}

/**
 * 获取所有分组列表
 */
export function getAllGroups(): GroupRecord[] {
  return Array.from(memoryDB.groups.values());
}

/**
 * 获取所有分组名称列表
 */
export function getAllGroupNames(): string[] {
  return Array.from(memoryDB.groups.keys());
}

/**
 * 创建新分组
 */
export function createGroup(groupName: string, description?: string): GroupRecord | null {
  if (memoryDB.groups.has(groupName)) return null;

  const group: GroupRecord = {
    group_name: groupName,
    description: description || "",
    created_at: new Date().toISOString(),
  };
  memoryDB.groups.set(groupName, group);
  return group;
}

/**
 * 删除分组
 */
export function deleteGroup(groupName: string): boolean {
  // 仅 admin 和 guest 分组不可删除
  if (groupName === "admin" || groupName === "guest") {
    return false;
  }
  return memoryDB.groups.delete(groupName);
}

/**
 * 检查分组是否存在
 */
export function groupExists(groupName: string): boolean {
  return memoryDB.groups.has(groupName);
}

// ============================================================
// 默认内置分组
// ============================================================
export function seedDefaultGroups(): void {
  const builtin: Array<{ name: string; desc: string }> = [
    { name: "admin", desc: "管理组" },
    { name: "default", desc: "默认组" },
    { name: "groupA", desc: "A组" },
    { name: "groupB", desc: "B组" },
    { name: "guest", desc: "访客组" },
  ];
  for (const b of builtin) {
    if (!memoryDB.groups.has(b.name)) {
      memoryDB.groups.set(b.name, {
        group_name: b.name,
        description: b.desc,
        created_at: new Date().toISOString(),
      });
    }
  }
  console.log(`[DB] 已初始化 ${memoryDB.groups.size} 个分组`);
}
