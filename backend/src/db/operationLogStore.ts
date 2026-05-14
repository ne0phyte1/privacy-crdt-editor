import { getDatabase } from "../db/database.js";

// ============================================================
// 操作日志数据访问层
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
    const db = getDatabase();
    const stmt = db.prepare(
      `INSERT INTO operation_logs (user_id, action, target, detail, ip_address)
       VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(
      input.userId,
      input.action,
      input.target || null,
      input.detail ? JSON.stringify(input.detail) : null,
      input.ipAddress || null
    );
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
  const db = getDatabase();
  const offset = (page - 1) * pageSize;

  let countSql = "SELECT COUNT(*) as count FROM operation_logs";
  let querySql = "SELECT * FROM operation_logs";
  const params: any[] = [];

  if (userId) {
    const where = " WHERE user_id = ?";
    countSql += where;
    querySql += where;
    params.push(userId);
  }

  querySql += " ORDER BY id DESC LIMIT ? OFFSET ?";

  const total = (db.prepare(countSql).get(...params) as { count: number }).count;
  const logs = db.prepare(querySql).all(...params, pageSize, offset) as any[];

  return { logs, total, page, pageSize };
}
