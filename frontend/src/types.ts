/* ============================================================
   YinMo - Privacy Collaborative Editor - TypeScript Types
   ============================================================ */

export interface ViewNode {
  viewNodeId: string;
  realNodeId: string;
  title: string;
  content: string;
  level: 1 | 2 | 3;
  target: string;
  children: ViewNode[];
}

export interface ViewStats {
  totalNodes: number;
  visibleNodes: number;
  filteredNodes: number;
}

export interface UserView {
  userId: string;
  userName: string;
  role: string;
  group: string;
  tree: ViewNode | null;
  stats: ViewStats;
}

export interface ViewResponse {
  status: string;
  view: UserView;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  status: string;
  message: string;
  token: string;
  user: {
    userId: string;
    username: string;
    role: string;
    group: string;
  };
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface RegisterResponse {
  status: string;
  message: string;
  token: string;
  user: {
    userId: string;
    username: string;
    role: string;
    group: string;
  };
}

export interface AuthUser {
  userId: string;
  username: string;
  role: string;
  group: string;
  token: string;
}

// 用户管理（admin）
export interface UserPublicInfo {
  userId: string;
  username: string;
  role: string;
  group: string;
  createdAt: string;
}

export interface UsersListResponse {
  status: string;
  users: UserPublicInfo[];
}

export interface UpdateUserRequest {
  role?: string;
  groupName?: string;
  password?: string;
}

// 分组管理（admin）
export interface GroupInfo {
  group_name: string;
  description: string;
  created_at: string;
}

export interface GroupListResponse {
  status: string;
  groups: GroupInfo[];
}

export type ViewOperationType = "insert" | "update" | "delete";

export interface ViewOperation {
  type: ViewOperationType;
  viewNodeId?: string;
  parentViewNodeId?: string;
  payload: {
    title?: string;
    content?: string;
    level?: 1 | 2 | 3;
    target?: string;
  };
}

export interface OperationResult {
  status: string;
  message: string;
  realNodeId?: string;
}

export type ThemeMode = "light" | "dark";

export interface EditorState {
  selectedNode: ViewNode | null;
  isCreating: boolean;
  isEditing: boolean;
  parentNodeId: string | null;
}
