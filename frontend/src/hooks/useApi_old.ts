import { useState, useCallback, useEffect } from "react";
import axios from "axios";
import type {
  AuthUser,
  UserView,
  ViewOperation,
  OperationResult,
  LoginRequest,
  LoginResponse,
} from "../types";

const API_BASE = "http://localhost:3001/api";

// ----- 认证 Hooks -----
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem("auth_user");
    return stored ? JSON.parse(stored) : null;
  });

  const login = useCallback(async (credentials: LoginRequest): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await axios.post<LoginResponse>(`${API_BASE}/auth/login`, credentials);
      if (res.data.status === "ok" && res.data.token) {
        const authUser: AuthUser = {
          userId: res.data.user.userId,
          username: res.data.user.username,
          name: res.data.user.name,
          role: res.data.user.role,
          group: res.data.user.group,
          token: res.data.token,
        };
        localStorage.setItem("auth_user", JSON.stringify(authUser));
        setUser(authUser);
        return { success: true, message: res.data.message };
      }
      return { success: false, message: res.data.message };
    } catch (err: any) {
      const msg = err.response?.data?.message || "登录失败，请检查网络连接";
      return { success: false, message: msg };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_user");
    setUser(null);
  }, []);

  return { user, login, logout, isAuthenticated: !!user };
}

// ----- 视图 API -----
export function useView(user: AuthUser | null) {
  const [view, setView] = useState<UserView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchView = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<{ status: string; view: UserView }>(
        `${API_BASE}/view/${user.userId}`,
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      if (res.data.status === "ok" && res.data.view) {
        setView(res.data.view);
      } else {
        setError("获取视图失败");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "无法连接后端服务");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchView();
  }, [user, fetchView]);

  const executeOperation = useCallback(
    async (operation: ViewOperation): Promise<OperationResult> => {
      if (!user) return { status: "error", message: "未登录" };
      try {
        const res = await axios.post<OperationResult>(
          `${API_BASE}/operation`,
          { operation },
          { headers: { Authorization: `Bearer ${user.token}` } }
        );
        // 操作成功后刷新视图
        if (res.data.status === "accepted") {
          await fetchView();
        }
        return res.data;
      } catch (err: any) {
        return {
          status: "error",
          message: err.response?.data?.message || "操作执行失败",
        };
      }
    },
    [user, fetchView]
  );

  return { view, loading, error, fetchView, executeOperation };
}
