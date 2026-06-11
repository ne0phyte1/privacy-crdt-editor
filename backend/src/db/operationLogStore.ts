import memoryDB from "./database.js";

// ============================================================
// 操作日志数据访问层 — 内存实现
// ============================================================

export interface OperationLogInput {
  userId: string;
  action: string;
  target?: string;
  detail?: Record<string, any>;
  ipAddress?: string;
}

/**
 * 记录操作日志
 */
export function logOperation(input: OperationLogInput): void {
  try {
    const log = {
      id: memoryDB.nextLogId++,
      user_id: input.userId,
      action: input.action,
      target: input.target || "",
      detail: input.detail ? JSON.stringify(input.detail) : "",
      ip_address: input.ipAddress || "",
      created_at: new Date().toISOString(),
    };
    
    memoryDB.logs.push(log);
  } catch (err) {
    console.error("[Log] 记录操作日志失败:", err);
  }
}

/**
 * 获取操作日志列表（分页）
 */
export function getOperationLogs(
  page: number = 1,
  pageSize: number = 50,
  userId?: string
): { logs: any[]; total: number; page: number; pageSize: number } {
  const offset = (page - 1) * pageSize;
  
  // 过滤日志
  let filteredLogs = memoryDB.logs;
  if (userId) {
    filteredLogs = filteredLogs.filter(log => log.user_id === userId);
  }
  
  // 分页
  const total = filteredLogs.length;
  const logs = filteredLogs
    .sort((a, b) => b.id - a.id) // 按 ID 倒序（最新在前）
    .slice(offset, offset + pageSize);
  
  return { logs, total, page, pageSize };
}
