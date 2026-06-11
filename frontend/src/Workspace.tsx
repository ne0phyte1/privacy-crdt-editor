import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AuthUser, ViewNode, ViewOperation, UserView } from "./types";
import { useView, useAdminUsers, useAdminGroups } from "./hooks/useApi";
import { useYjsTree } from "./hooks/useYjsTree";
import "./Workspace.css";
import { ToastContainer, useToast } from "./Toast";

import DocumentPage from "./DocumentPage";
import TreeNodeList from "./TreeNode";

type Page = "tree" | "document" | "admin";

interface WorkspaceProps {
  user: AuthUser;
  onLogout: () => void;
}

export default function Workspace({ user, onLogout }: WorkspaceProps) {
  const { view, loading, error, fetchView, executeOperation } = useView(user);
  const yjsTree = useYjsTree({ token: user.token, userId: user.userId, userName: user.username, userGroup: user.group });
  const adminApi = useAdminUsers(user);
  const groupApi = useAdminGroups(user);
  const [currentPage, setCurrentPage] = useState<Page>("tree");
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") as "light" | "dark") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const { toasts, addToast, dismissToast } = useToast();

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
  }, [theme]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  const goTree = useCallback(() => {
    setCurrentPage("tree");
    setCurrentDocId(null);
  }, []);

  const goDocument = useCallback((nodeId: string) => {
    setCurrentDocId(nodeId);
    setCurrentPage("document");
  }, []);

  const findNode = useCallback((tree: ViewNode | null, nodeId: string): ViewNode | null => {
    if (!tree) return null;
    function search(n: ViewNode): ViewNode | null {
      if (n.viewNodeId === nodeId) return n;
      for (const c of n.children) { const f = search(c); if (f) return f; }
      return null;
    }
    return search(tree);
  }, []);

  const currentNode = view?.tree ? findNode(view.tree, currentDocId || "") : null;

  const handleSave = useCallback(async (op: ViewOperation) => {
    return await executeOperation(op);
  }, [executeOperation]);

  return (
    <div className="workspace">
      <motion.header className="workspace-header" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
        <div className="wh-left">
          <span className="wh-brand">
            <svg width="24" height="24" viewBox="0 0 100 100" fill="none">
              <defs><linearGradient id="whLogo" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#ec4899"/></linearGradient></defs>
              <rect width="100" height="100" rx="20" fill="url(#whLogo)"/>
              <text x="50" y="66" fontFamily="'Syne', serif" fontSize="46" fontWeight="700" fill="white" textAnchor="middle">闅?/text>
            </svg>
            <span className="wh-brand-text">闅愬ⅷ</span>
          </span>
          <nav className="wh-nav">
            <button className={`wh-nav-item ${currentPage === "tree" ? "active" : ""}`} onClick={goTree}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 9 3 15 9 21 3 21 21 3 21"/><line x1="3" y1="9" x2="3" y2="21"/><polyline points="9 3 9 21"/></svg>
              鏂囨。鏍?
            </button>
            {user.role === "admin" && (
              <button className={`wh-nav-item ${currentPage === "admin" ? "active" : ""}`} onClick={() => setCurrentPage("admin")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                鐢ㄦ埛绠＄悊
              </button>
            )}
          </nav>
        </div>
        <div className="wh-right">
          <motion.button className="wh-icon-btn" onClick={toggleTheme} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} title="鍒囨崲涓婚">
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </motion.button>
          <div className="wh-user" ref={userMenuRef}>
            <button className="wh-user-trigger" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <div className="wh-avatar">{user.username.charAt(0)}</div>
              <span className="wh-username">{user.username}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`wh-chevron ${userMenuOpen ? "open" : ""}`}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <AnimatePresence>
              {userMenuOpen && (
                <motion.div className="wh-user-menu" initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ duration: 0.15 }}>
                  <div className="wh-user-menu-header">
                    <div className="wh-user-menu-name">{user.username}</div>
                    <div className="wh-user-menu-tags"><span className="wh-tag">{user.role}</span><span className="wh-tag">{user.group}</span></div>
                  </div>
                  <div className="wh-user-menu-divider" />
                  <button className="wh-user-menu-item" onClick={onLogout}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    閫€鍑虹櫥褰?
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.header>
      <main className="workspace-main">
        <AnimatePresence mode="wait">
          {currentPage === "tree" && (
            <motion.div key="tree" className="wp-tree-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <FullTreePage view={view} loading={loading} error={error} user={user} groupApi={groupApi} onRefresh={fetchView} onSave={handleSave} goDocument={goDocument} onToast={addToast} yjsTree={yjsTree} />
            </motion.div>
          )}
          {currentPage === "document" && currentDocId && (
            <DocumentPage key={currentDocId} user={user} node={currentNode} nodeId={currentDocId} view={view} loading={loading} onSave={handleSave} onBack={goTree} onRefresh={fetchView} onNavigate={goDocument} onToast={addToast} />
          )}
          {currentPage === "admin" && user.role === "admin" && (
            <AdminUsersPage adminApi={adminApi} groupApi={groupApi} onToast={addToast} />
          )}
        </AnimatePresence>
      </main>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ---- FullTreePage (with group target selector) ----
function FullTreePage({
  view, loading, error, user, groupApi, onRefresh, onSave, goDocument, onToast, yjsTree,
}: {
  view: UserView | null; loading: boolean; error: string | null; user: AuthUser;
  groupApi: ReturnType<typeof useAdminGroups>;
  onRefresh: () => void; onSave: (op: ViewOperation) => Promise<any>;
  yjsTree: ReturnType<typeof useYjsTree>;
  goDocument: (nodeId: string) => void; onToast: (text: string, type: "error" | "warning" | "success") => void;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["root"]));
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createParentId, setCreateParentId] = useState<string>("root");
  const [createTitle, setCreateTitle] = useState("");
  const [createLevel, setCreateLevel] = useState<1 | 2 | 3>(3);
  const [createTarget, setCreateTarget] = useState("all");
  const [allowedLevels, setAllowedLevels] = useState<Set<1 | 2 | 3>>(new Set([1, 2, 3]));
  const [deleteTarget, setDeleteTarget] = useState<ViewNode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = user.role === "admin";
  const groupNames = groupApi.groups.map((g) => g.group_name);

  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => { const next = new Set(prev); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next; });
  }, []);
  const handleSelectNode = useCallback((node: ViewNode) => { goDocument(node.viewNodeId); }, [goDocument]);
  const handleDeleteNode = useCallback((node: ViewNode) => { setDeleteTarget(node); }, []);

  
  // Client-side NBAC validation (mirrors backend resolveNBACChild)
  const validateNBAC = (parentNode: ViewNode | null, requestedLevel: 1 | 2 | 3, requestedTarget: string): { valid: boolean; level: 1 | 2 | 3; target: string; message: string } => {
    if (!parentNode) return { valid: false, level: requestedLevel, target: "", message: "Parent not found" };

    // Level creation rules
    if (parentNode.level === 2 && requestedLevel === 1) return { valid: false, level: requestedLevel, target: "", message: "Cannot create L1 under L2" };
    if (parentNode.level === 3 && requestedLevel !== 3) return { valid: false, level: requestedLevel, target: "", message: "Cannot create L" + requestedLevel + " under L3" };

    // Role checks
    if (requestedLevel === 1 && user.role !== "admin") return { valid: false, level: requestedLevel, target: "", message: "Only admin can create L1" };
    if (requestedLevel === 2 && user.role === "member") return { valid: false, level: requestedLevel, target: "", message: "Members can only create L3" };
    if (requestedLevel === 2 && user.role === "guest") return { valid: false, level: requestedLevel, target: "", message: "Guests cannot create" };
    if (requestedLevel === 3 && user.role === "guest") return { valid: false, level: requestedLevel, target: "", message: "Guests cannot create" };

    // Target resolution
    let resolvedTarget: string;
    if (parentNode.level === 1 && parentNode.target === "all") {
      if (requestedLevel === 1) {
        resolvedTarget = requestedTarget || "all";
      } else {
        resolvedTarget = user.group;
      }
    } else {
      resolvedTarget = parentNode.target;
    }

    return { valid: true, level: requestedLevel, target: resolvedTarget, message: "OK" };
  };

  // Find a node in the view tree
  const findViewNode = (tree: ViewNode | null, nodeId: string): ViewNode | null => {
    if (!tree) return null;
    if (tree.viewNodeId === nodeId) return tree;
    for (const child of tree.children) {
      const found = findViewNode(child, nodeId);
      if (found) return found;
    }
    return null;
  };
const handleCreateConfirm = useCallback(async () => {
    if (!createTitle.trim()) return;
    if (isAdmin && createLevel !== 1 && !createTarget) { onToast("璇烽€夋嫨鐩爣鍒嗙粍", "error"); return; }
    setIsSaving(true);

    // Resolve target for non-admin
    const effectiveTarget = isAdmin && createLevel !== 1 ? createTarget : user.group;

    // Client-side NBAC validation
    const parentNode = findViewNode(view?.tree || null, createParentId);
    const nbac = validateNBAC(parentNode, createLevel, effectiveTarget);
    if (!nbac.valid) {
      setIsSaving(false);
      onToast(nbac.message, "error");
      return;
    }

    // Try Yjs tree ops first (offline-capable)
    if (yjsTree.treeConnected) {
      const newId = yjsTree.createNode(createParentId, createTitle.trim(), nbac.level, nbac.target);
      if (newId) {
        setIsSaving(false);
        setShowCreateDialog(false);
        setCreateTitle("");
        // Refresh view to get proper viewNodeId mapping
        setTimeout(() => onRefresh(), 300);
        goDocument(newId);
        onToast("鑺傜偣宸插垱寤? + (yjsTree.connStatus === "joined" ? "" : " (绂荤嚎锛岀綉缁滄仮澶嶅悗鍚屾)"), "success");
        return;
      }
    }

    // Fallback to REST
    const op: ViewOperation = {
      type: "insert",
      parentViewNodeId: createParentId,
      payload: { title: createTitle.trim(), content: "", level: nbac.level, target: nbac.target },
    };
    const result = await onSave(op);
    setIsSaving(false);
    if (result.status === "accepted" && result.realNodeId) { setShowCreateDialog(false); setCreateTitle(""); goDocument(result.realNodeId); }
    else if (result.status === "rejected" || result.status === "error") { onToast(result.message || "鍒涘缓澶辫触", "error"); }
  }, [createTitle, createLevel, createTarget, createParentId, isAdmin, user.group, user.role, onSave, goDocument, onToast, yjsTree, view, onRefresh]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;

    // Try Yjs tree ops first
    if (yjsTree.treeConnected) {
      const ok = yjsTree.deleteNode(deleteTarget.viewNodeId);
      if (ok) {
        setDeleteTarget(null);
        setTimeout(() => onRefresh(), 300);
        onToast("鑺傜偣宸插垹闄? + (yjsTree.connStatus === "joined" ? "" : " (绂荤嚎锛岀綉缁滄仮澶嶅悗鍚屾)"), "success");
        return;
      }
    }

    // Fallback to REST
    const op: ViewOperation = { type: "delete", viewNodeId: deleteTarget.viewNodeId, payload: {} };
    const result = await onSave(op);
    if (result.status !== "accepted") { onToast(result.message || "鍒犻櫎澶辫触", "error"); }
    setDeleteTarget(null);
  }, [deleteTarget, onSave, onToast, yjsTree, onRefresh]);

  const handleOpenCreate = useCallback((parentId: string) => {
    setCreateParentId(parentId); setCreateTitle("");
    const searchTree = (tree: ViewNode | null, targetId: string): ViewNode | null => {
      if (!tree) return null; if (tree.viewNodeId === targetId) return tree;
      for (const child of tree.children) { const found = searchTree(child, targetId); if (found) return found; }
      return null;
    };
    const parentNode = searchTree(view?.tree || null, parentId);
    const parentLevel = parentNode?.level || 1;
    let allowed: Set<1 | 2 | 3>; let defaultLevel: 1 | 2 | 3;
    if (parentLevel === 1) { allowed = new Set([1, 2, 3]); defaultLevel = 3; }
    else if (parentLevel === 2) { allowed = new Set([2, 3]); defaultLevel = 3; }
    else { allowed = new Set([3]); defaultLevel = 3; }
    setAllowedLevels(allowed); setCreateLevel(defaultLevel);
    setCreateTarget("all");
    setShowCreateDialog(true);
  }, [view]);

  const handleCancelCreate = useCallback(() => { setShowCreateDialog(false); setCreateTitle(""); }, []);

  return (
    <div className="full-tree-layout">
      <div className="full-tree-sidebar">
        <div className="full-tree-toolbar">
          <motion.button className="ft-btn ft-btn--primary" onClick={() => setShowCreateDialog(true)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} title="鏂板缓鑺傜偣">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </motion.button>
          <motion.button className="ft-btn" onClick={onRefresh} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} title="鍒锋柊">
            <motion.svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" animate={{ rotate: loading ? 360 : 0 }} transition={{ duration: 1, repeat: loading ? Infinity : 0, ease: "linear" }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></motion.svg>
          </motion.button>
          <div className="ft-divider" />
          {view?.stats && (<div className="ft-stats"><span className="ft-stat">{view.stats.visibleNodes}</span><span className="ft-stat-label">鍙</span></div>)}
        </div>
        <div className="full-tree-scroll">
          {loading && !view ? (<div className="ft-loading"><div className="ft-spinner" /><p>鍔犺浇涓€?/p></div>)
          : error ? (<div className="ft-error"><p>{error}</p></div>)
          : (<TreeNodeList tree={view?.tree || null} onSelect={handleSelectNode} onDelete={handleDeleteNode} onCreate={handleOpenCreate} expandedNodes={expandedNodes} onToggleNode={handleToggleNode} />)}
        </div>
      </div>
      {/* Create Dialog */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div className="ft-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={handleCancelCreate}>
            <motion.div className="ft-dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()}>
              <h3 className="ft-dialog-title">鏂板缓鑺傜偣</h3>
              <div className="ft-dialog-field"><label className="ft-dialog-label">鏍囬</label><input className="ft-dialog-input" type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="杈撳叆鑺傜偣鏍囬鈥? autoFocus onKeyDown={(e) => { if (e.key === "Enter" && createTitle.trim()) handleCreateConfirm(); }} /></div>
              <div className="ft-dialog-field"><label className="ft-dialog-label">鑺傜偣绾у埆</label>
                <div className="ft-dialog-level-group">
                  {allowedLevels.has(1) && (<label className={"ft-dialog-level-btn" + (createLevel === 1 ? " ft-dialog-level-btn--active" : "")}><input type="radio" name="level" value={1} checked={createLevel === 1} onChange={() => setCreateLevel(1)} /><span className="ft-level-icon">馃寪</span><span className="ft-level-text">涓€绾峰叏鍩熷叕鍛?/span></label>)}
                  {allowedLevels.has(2) && (<label className={"ft-dialog-level-btn" + (createLevel === 2 ? " ft-dialog-level-btn--active" : "")}><input type="radio" name="level" value={2} checked={createLevel === 2} onChange={() => setCreateLevel(2)} /><span className="ft-level-icon">馃懃</span><span className="ft-level-text">浜岀骇路缁勫唴鍏憡</span></label>)}
                  {allowedLevels.has(3) && (<label className={"ft-dialog-level-btn" + (createLevel === 3 ? " ft-dialog-level-btn--active" : "")}><input type="radio" name="level" value={3} checked={createLevel === 3} onChange={() => setCreateLevel(3)} /><span className="ft-level-icon">馃敀</span><span className="ft-level-text">涓夌骇路缁勯棿鏂囨。</span></label>)}
                </div>
              </div>
              {isAdmin && createLevel !== 1 && (
                <div className="ft-dialog-field">
                  <label className="ft-dialog-label">鐩爣鍒嗙粍</label>
                  <select className="admin-select" value={createTarget} onChange={(e) => setCreateTarget(e.target.value)} style={{width:"100%",padding:"10px 12px"}}>
                    {groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              )}
              <div className="ft-dialog-actions">
                <motion.button className="ft-dialog-btn ft-dialog-btn--cancel" onClick={handleCancelCreate} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>鍙栨秷</motion.button>
                <motion.button className={`ft-dialog-btn ft-dialog-btn--confirm ${!createTitle.trim() || isSaving ? "disabled" : ""}`} onClick={handleCreateConfirm} disabled={!createTitle.trim() || isSaving} whileHover={createTitle.trim() ? { scale: 1.02 } : {}} whileTap={createTitle.trim() ? { scale: 0.98 } : {}}>{isSaving ? (<span className="ft-dialog-spinner" />) : ("鍒涘缓")}</motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Delete Dialog */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div className="ft-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeleteTarget(null)}>
            <motion.div className="ft-dialog ft-dialog--danger" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()}>
              <div className="ft-dialog-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
              <h3 className="ft-dialog-title">纭鍒犻櫎</h3>
              <p className="ft-dialog-text">纭畾鍒犻櫎銆?strong>{deleteTarget.title}</strong>銆嶅悧锛?/p>
              <p className="ft-dialog-hint">姝ゆ搷浣滀笉鍙挙閿€锛屾墍鏈夊瓙鑺傜偣涔熷皢琚垹闄?/p>
              <div className="ft-dialog-actions">
                <motion.button className="ft-dialog-btn ft-dialog-btn--cancel" onClick={() => setDeleteTarget(null)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>鍙栨秷</motion.button>
                <motion.button className="ft-dialog-btn ft-dialog-btn--danger" onClick={handleDeleteConfirm} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>纭鍒犻櫎</motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Admin Users Page (unchanged) ----
function AdminUsersPage({
  adminApi, groupApi, onToast,
}: {
  adminApi: ReturnType<typeof useAdminUsers>;
  groupApi: ReturnType<typeof useAdminGroups>;
  onToast: (text: string, type: "error" | "warning" | "success") => void;
}) {
  const { users, loading, fetchUsers, updateUser, deleteUser } = adminApi;
  const { groups, createGroup, deleteGroup } = groupApi;
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editRole, setEditRole] = useState("guest");
  const [editGroup, setEditGroup] = useState("default");
  const [isSaving, setIsSaving] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const ROLES = ["guest", "member", "leader", "admin"];
  const BUILTIN_GROUPS = new Set(["guest", "admin"]);
  const groupNames = groups.map((g) => g.group_name);

  const roleLabel = (r: string) => ({ guest: "璁垮", member: "鎴愬憳", leader: "缁勯暱", admin: "绠＄悊鍛? } as Record<string, string>)[r] || r;
  const groupLabel = (g: string) => { const found = groups.find((gr) => gr.group_name === g); return found?.description || g; };

  const startEdit = useCallback((userId: string, role: string, group: string) => { setEditingUser(userId); setEditRole(role); setEditGroup(group); }, []);
  const cancelEdit = useCallback(() => { setEditingUser(null); }, []);

  const handleUpdateUser = useCallback(async (userId: string) => {
    setIsSaving(true);
    const ok = await updateUser(userId, { role: editRole, groupName: editGroup });
    setIsSaving(false);
    if (ok) { setEditingUser(null); onToast("鐢ㄦ埛淇℃伅宸叉洿鏂?, "success"); fetchUsers(); }
    else { onToast("鏇存柊澶辫触", "error"); }
  }, [editRole, editGroup, updateUser, fetchUsers, onToast]);

  const handleDeleteUser = useCallback(async (userId: string, username: string) => {
    if (!window.confirm(`纭畾鍒犻櫎鐢ㄦ埛銆?{username}銆嶅悧锛焋)) return;
    const ok = await deleteUser(userId);
    if (ok) onToast("鐢ㄦ埛宸插垹闄?, "success");
    else onToast("鍒犻櫎澶辫触", "error");
  }, [deleteUser, onToast]);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    setCreating(true);
    const ok = await createGroup(newGroupName.trim(), newGroupDesc.trim());
    setCreating(false);
    if (ok) { setNewGroupName(""); setNewGroupDesc(""); onToast(`鍒嗙粍銆?{newGroupName.trim()}銆嶅凡鍒涘缓`, "success"); fetchUsers(); }
    else onToast("鍒涘缓澶辫触锛堝彲鑳藉凡瀛樺湪鍚屽悕鍒嗙粍锛?, "error");
  }, [newGroupName, newGroupDesc, createGroup, fetchUsers, onToast]);

  const handleDeleteGroup = useCallback(async (groupName: string) => {
    if (!window.confirm(`纭畾鍒犻櫎鍒嗙粍銆?{groupName}銆嶅悧锛熺粍鍐呮垚鍛樺皢闄嶇骇涓鸿瀹€俙)) return;
    const ok = await deleteGroup(groupName);
    if (ok) { onToast(`鍒嗙粍銆?{groupName}銆嶅凡鍒犻櫎`, "success"); fetchUsers(); }
    else onToast("鍒犻櫎澶辫触锛坅dmin/guest 鍒嗙粍涓嶅彲鍒犻櫎锛?, "error");
  }, [deleteGroup, fetchUsers, onToast]);

  return (
    <motion.div className="admin-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="admin-page-header">
        <h2 className="admin-page-title">鐢ㄦ埛绠＄悊</h2>
        <motion.button className="admin-btn admin-btn--ghost" onClick={fetchUsers} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 鍒锋柊
        </motion.button>
      </div>
      <div className="admin-section">
        <h3 className="admin-section-title">鍒嗙粍绠＄悊</h3>
        <div className="admin-group-create">
          <input className="admin-input" type="text" placeholder="鏂板垎缁勫悕绉扳€? value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }} />
          <input className="admin-input admin-input--desc" type="text" placeholder="鎻忚堪锛堝彲閫夛級" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }} />
          <motion.button className="admin-btn admin-btn--primary" onClick={handleCreateGroup} disabled={!newGroupName.trim() || creating} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>{creating ? "鈥? : "鍒涘缓鍒嗙粍"}</motion.button>
        </div>
        <div className="admin-group-chips">
          {groups.map((g) => (
            <span key={g.group_name} className={`admin-group-chip ${BUILTIN_GROUPS.has(g.group_name) ? "admin-group-chip--builtin" : ""}`}>
              {g.group_name}{g.description && <span className="admin-group-chip-desc">{g.description}</span>}
              {!BUILTIN_GROUPS.has(g.group_name) && (
                <button className="admin-group-chip-del" onClick={() => handleDeleteGroup(g.group_name)} title="鍒犻櫎鍒嗙粍">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="ft-loading"><div className="ft-spinner" /><p>鍔犺浇鐢ㄦ埛鍒楄〃鈥?/p></div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>鐢ㄦ埛鍚?/th><th>瑙掕壊</th><th>鍒嗙粍</th><th>娉ㄥ唽鏃堕棿</th><th>鎿嶄綔</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className={editingUser === u.userId ? "admin-row--editing" : ""}>
                  <td className="admin-cell-mono">{u.username}</td>
                  <td>
                    {editingUser === u.userId ? (
                      <select className="admin-select" value={editRole} onChange={(e) => setEditRole(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)} ({r})</option>)}</select>
                    ) : (<span className={`admin-badge admin-badge--${u.role}`}>{roleLabel(u.role)}</span>)}
                  </td>
                  <td>
                    {editingUser === u.userId ? (
                      <select className="admin-select" value={editGroup} onChange={(e) => setEditGroup(e.target.value)}>{groupNames.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}</select>
                    ) : (<span className="admin-group-tag">{groupLabel(u.group)}</span>)}
                  </td>
                  <td className="admin-cell-time">{new Date(u.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td>
                    <div className="admin-cell-actions">
                      {editingUser === u.userId ? (<>
                        <motion.button className="admin-action-btn admin-action-btn--save" onClick={() => handleUpdateUser(u.userId)} disabled={isSaving} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>{isSaving ? "鈥? : "淇濆瓨"}</motion.button>
                        <motion.button className="admin-action-btn admin-action-btn--cancel" onClick={cancelEdit} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>鍙栨秷</motion.button>
                      </>) : (<>
                        <motion.button className="admin-action-btn admin-action-btn--edit" onClick={() => startEdit(u.userId, u.role, u.group)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </motion.button>
                        {u.role !== "admin" && (
                          <motion.button className="admin-action-btn admin-action-btn--delete" onClick={() => handleDeleteUser(u.userId, u.username)} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </motion.button>
                        )}
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}





