import { useState, useCallback, useEffect } from "react";
import axios from "axios";
import type {
  AuthUser,
  UserView,
  ViewOperation,
  OperationResult,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UserPublicInfo,
  UsersListResponse,
  UpdateUserRequest,
  GroupInfo,
  GroupListResponse,
} from "../types";

// 生产环境通过 nginx 反向代理走相对路径；开发环境回退到 localhost
const API_BASE: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) ||
  "/api";

// ----- Auth Hooks -----
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem("auth_user");
    return stored ? JSON.parse(stored) : null;
  });

  const login = useCallback(async (credentials: LoginRequest): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await axios.post<LoginResponse>(API_BASE + "/auth/login", credentials);
      if (res.data.status === "ok" && res.data.token) {
        const authUser: AuthUser = {
          userId: res.data.user.userId,
          username: res.data.user.username,
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
      const msg = err.response?.data?.message || "Login failed, check network connection";
      return { success: false, message: msg };
    }
  }, []);

  const register = useCallback(async (data: RegisterRequest): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await axios.post<RegisterResponse>(API_BASE + "/auth/register", data);
      if (res.data.status === "ok" && res.data.token) {
        const authUser: AuthUser = {
          userId: res.data.user.userId,
          username: res.data.user.username,
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
      const msg = err.response?.data?.message || "Registration failed, check network connection";
      return { success: false, message: msg };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_user");
    setUser(null);
  }, []);

  return { user, login, register, logout, isAuthenticated: !!user };
}

// ----- View API -----
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
        API_BASE + "/view/" + user.userId,
        { headers: { Authorization: "Bearer " + user.token } }
      );
      if (res.data.status === "ok" && res.data.view) {
        setView(res.data.view);
      } else {
        setError("Failed to get view");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Cannot connect to backend");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchView();
  }, [user, fetchView]);

  const executeOperation = useCallback(
    async (operation: ViewOperation): Promise<OperationResult> => {
      if (!user) return { status: "error", message: "Not logged in" };
      try {
        const res = await axios.post<OperationResult>(
          API_BASE + "/operation",
          { operation },
          { headers: { Authorization: "Bearer " + user.token } }
        );
        if (res.data.status === "accepted") {
          await fetchView();
        }
        return res.data;
      } catch (err: any) {
        return {
          status: "error",
          message: err.response?.data?.message || "Operation failed",
        };
      }
    },
    [user, fetchView]
  );

  return { view, loading, error, fetchView, executeOperation };
}

// ----- Admin: User Management -----
export function useAdminUsers(user: AuthUser | null) {
  const [users, setUsers] = useState<UserPublicInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!user || user.role !== "admin") return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<UsersListResponse>(API_BASE + "/users", {
        headers: { Authorization: "Bearer " + user.token },
      });
      if (res.data.status === "ok") {
        setUsers(res.data.users);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const updateUser = useCallback(async (userId: string, data: UpdateUserRequest): Promise<boolean> => {
    if (!user) return false;
    try {
      await axios.put(API_BASE + "/users/" + userId, data, {
        headers: { Authorization: "Bearer " + user.token },
      });
      await fetchUsers();
      return true;
    } catch (err: any) {
      return false;
    }
  }, [user, fetchUsers]);

  const deleteUser = useCallback(async (userId: string): Promise<boolean> => {
    if (!user) return false;
    try {
      await axios.delete(API_BASE + "/users/" + userId, {
        headers: { Authorization: "Bearer " + user.token },
      });
      await fetchUsers();
      return true;
    } catch (err: any) {
      return false;
    }
  }, [user, fetchUsers]);

  useEffect(() => {
    if (user && user.role === "admin") fetchUsers();
  }, [user, fetchUsers]);

  return { users, loading, error, fetchUsers, updateUser, deleteUser };
}

// ----- Admin: Group Management -----
export function useAdminGroups(user: AuthUser | null) {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!user || user.role !== "admin") return;
    setLoading(true);
    try {
      const res = await axios.get<GroupListResponse>(API_BASE + "/groups", {
        headers: { Authorization: "Bearer " + user.token },
      });
      if (res.data.status === "ok") {
        setGroups(res.data.groups);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [user]);

  const createGroup = useCallback(async (groupName: string, description?: string): Promise<boolean> => {
    if (!user) return false;
    try {
      await axios.post(API_BASE + "/groups",
        { groupName, description },
        { headers: { Authorization: "Bearer " + user.token } }
      );
      await fetchGroups();
      return true;
    } catch {
      return false;
    }
  }, [user, fetchGroups]);

  const deleteGroup = useCallback(async (groupName: string): Promise<boolean> => {
    if (!user) return false;
    try {
      await axios.delete(API_BASE + "/groups/" + groupName, {
        headers: { Authorization: "Bearer " + user.token },
      });
      await fetchGroups();
      return true;
    } catch {
      return false;
    }
  }, [user, fetchGroups]);

  useEffect(() => {
    if (user && user.role === "admin") fetchGroups();
  }, [user, fetchGroups]);

  return { groups, loading, fetchGroups, createGroup, deleteGroup };
}
