import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AuthUser, ViewNode, ViewOperation, UserView } from "./types";
import { useView } from "./hooks/useApi";
import "./Workspace.css";

// ---- Sub-page components ----
import DocumentPage from "./DocumentPage";
import TreeNodeList from "./TreeNode";

type Page = "tree" | "document";

interface WorkspaceProps {
  user: AuthUser;
  onLogout: () => void;
}

export default function Workspace({ user, onLogout }: WorkspaceProps) {
  const { view, loading, error, fetchView, executeOperation } = useView(user);
  const [currentPage, setCurrentPage] = useState<Page>("tree");
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Theme
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") as "light" | "dark") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
  }, [theme]);

  // Close user menu on outside click
  useEffect(() => {
    function close(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  // Navigation
  const goTree = useCallback(() => {
    setCurrentPage("tree");
    setCurrentDocId(null);
  }, []);

  const goDocument = useCallback((nodeId: string) => {
    setCurrentDocId(nodeId);
    setCurrentPage("document");
  }, []);

  // Find node in tree
  const findNode = useCallback((tree: ViewNode | null, nodeId: string): ViewNode | null => {
    if (!tree) return null;
    function search(n: ViewNode): ViewNode | null {
      if (n.viewNodeId === nodeId) return n;
      for (const c of n.children) {
        const found = search(c);
        if (found) return found;
      }
      return null;
    }
    return search(tree);
  }, []);

  const currentNode = view?.tree ? findNode(view.tree, currentDocId || "") : null;

  // Quick save
  const handleSave = useCallback(async (op: ViewOperation) => {
    const result = await executeOperation(op);
    return result;
  }, [executeOperation]);

  return (
    <div className="workspace">
      {/* ========== Header ========== */}
      <motion.header
        className="workspace-header"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="wh-left">
          <span className="wh-brand">
            <svg width="24" height="24" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="whLogo" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="20" fill="url(#whLogo)" />
              <text x="50" y="66" fontFamily="'Syne', serif" fontSize="46" fontWeight="700" fill="white" textAnchor="middle">Yin</text>
            </svg>
            <span className="wh-brand-text">YinMo</span>
          </span>
        </div>

        <div className="wh-right">
          {/* Theme toggle */}
          <motion.button
            className="wh-icon-btn"
            onClick={toggleTheme}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </motion.button>

          {/* User menu */}
          <div className="wh-user-menu" ref={userMenuRef}>
            <motion.button
              className="wh-user-btn"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="wh-avatar">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="wh-user-name">{user.name}</span>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </motion.button>
            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  className="wh-dropdown"
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="wh-dropdown-info">
                    <span className="wh-di-role">{user.role}</span>
                    <span className="wh-di-group">{user.group}</span>
                  </div>
                  <button className="wh-dropdown-item" onClick={onLogout}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Logout
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.header>

      {/* ========== Main Content ========== */}
      {currentPage === "document" && currentNode ? (
        <DocumentPage
          user={user}
          node={currentNode}
          nodeId={currentDocId || ""}
          view={view}
          loading={loading}
          onSave={handleSave}
          onBack={goTree}
          onRefresh={fetchView}
          onNavigate={goDocument}
        />
      ) : (
        <TreeView
          user={user}
          view={view}
          loading={loading}
          error={error}
          onSelect={goDocument}
          onDelete={async (node) => {
            const result = await executeOperation({
              type: "delete",
              viewNodeId: node.viewNodeId,
              payload: {},
            });
            return result;
          }}
          onCreate={async (parentNodeId, title, level) => {
            const result = await executeOperation({
              type: "insert",
              parentViewNodeId: parentNodeId,
              payload: {
                title,
                level: level as 1 | 2 | 3,
              },
            });
            return result;
          }}
          onRefresh={fetchView}
        />
      )}
    </div>
  );
}

// ============================================================
// Tree View Panel
// ============================================================
interface TreeViewProps {
  user: AuthUser;
  view: UserView | null;
  loading: boolean;
  error: string | null;
  onSelect: (nodeId: string) => void;
  onDelete: (node: ViewNode) => Promise<any>;
  onCreate: (parentNodeId: string, title: string, level: number) => Promise<any>;
  onRefresh: () => void;
}

function TreeView({ user, view, loading, error, onSelect, onDelete, onCreate, onRefresh }: TreeViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["root"]));
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createParentId, setCreateParentId] = useState<string>("root");
  const [createTitle, setCreateTitle] = useState("");
  const [createLevel, setCreateLevel] = useState<1 | 2 | 3>(3);
  const [deleteTarget, setDeleteTarget] = useState<ViewNode | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Select node
  const handleSelectNode = useCallback((node: ViewNode) => {
    setSelectedId(node.viewNodeId);
    if (node.content || node.children.length > 0) {
      onSelect(node.viewNodeId);
    }
  }, [onSelect]);

  // Toggle expand
  const handleToggleNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Create node dialog
  const handleOpenCreate = useCallback((parentId: string) => {
    setCreateParentId(parentId);
    setCreateTitle("");
    setCreateLevel(3);
    setShowCreateDialog(true);
  }, []);

  const handleCancelCreate = useCallback(() => {
    setShowCreateDialog(false);
    setCreateTitle("");
  }, []);

  const handleCreateConfirm = useCallback(async () => {
    if (!createTitle.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const result = await onCreate(createParentId, createTitle.trim(), createLevel);
      if (result.status === "accepted") {
        setShowCreateDialog(false);
        setCreateTitle("");
        onRefresh();
      } else {
        alert(result.message || "Create failed");
      }
    } catch (e) {
      alert("Create failed");
    } finally {
      setIsSaving(false);
    }
  }, [createTitle, createLevel, createParentId, isSaving, onCreate, onRefresh]);

  // Delete confirmation
  const handleDeleteNode = useCallback((node: ViewNode) => {
    setDeleteTarget(node);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsSaving(true);
    try {
      const result = await onDelete(deleteTarget);
      if (result.status === "accepted") {
        setDeleteTarget(null);
        setSelectedId(null);
        onRefresh();
      } else {
        alert(result.message || "Delete failed");
      }
    } catch (e) {
      alert("Delete failed");
    } finally {
      setIsSaving(false);
    }
  }, [deleteTarget, onDelete, onRefresh]);

  // Level label helper
  const getLevelLabel = (level: number): string => {
    switch (level) {
      case 1: return "Level 1 - Global Announcement";
      case 2: return "Level 2 - Group Announcement";
      case 3: return "Level 3 - Group Document";
      default: return Level ;
    }
  };

  return (
    <div className="workspace-body">
      {/* Sidebar */}
      <div className="ws-sidebar">
        <div className="ws-sidebar-header">
          <h2 className="ws-sidebar-title">Document Tree</h2>
          <motion.button
            className="ws-icon-btn"
            onClick={() => handleOpenCreate("root")}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="New node"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </motion.button>
        </div>

        <div className="ws-sidebar-stats">
          {view && (
            <>
              <span className="ws-stat-item">
                <strong>{view.stats?.visibleNodes ?? 0}</strong> visible
              </span>
              <span className="ws-stat-item">
                <strong>{view.stats?.filteredNodes ?? 0}</strong> filtered
              </span>
            </>
          )}
        </div>

        <div className="ws-sidebar-tree">
          {loading ? (
            <div className="ws-loading">Loading...</div>
          ) : error ? (
            <div className="ws-error">
              <p>{error}</p>
              <button onClick={onRefresh}>Retry</button>
            </div>
          ) : (
            <TreeNodeList
              tree={view?.tree || null}
              selectedId={selectedId}
              onSelect={handleSelectNode}
              onDelete={handleDeleteNode}
              expandedNodes={expandedNodes}
              onToggleNode={handleToggleNode}
            />
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="ws-main">
        <div className="ws-welcome">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <h3>Select a document to edit</h3>
          <p>Logged in as <strong>{user.name}</strong> ({user.role} / {user.group})</p>
        </div>
      </div>

      {/* ===== Create Node Dialog ===== */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            className="ft-dialog-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancelCreate}
          >
            <motion.div
              className="ft-dialog"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="ft-dialog-title">New Node</h3>
              <div className="ft-dialog-field">
                <label className="ft-dialog-label">Title</label>
                <input
                  className="ft-dialog-input"
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Enter node title..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && createTitle.trim()) handleCreateConfirm();
                  }}
                />
              </div>
              <div className="ft-dialog-field">
                <label className="ft-dialog-label">Level</label>
                <select
                  className="ft-dialog-select"
                  value={createLevel}
                  onChange={(e) => setCreateLevel(Number(e.target.value) as 1 | 2 | 3)}
                >
                  <option value={1}>{getLevelLabel(1)}</option>
                  <option value={2}>{getLevelLabel(2)}</option>
                  <option value={3}>{getLevelLabel(3)}</option>
                </select>
              </div>
              <div className="ft-dialog-actions">
                <motion.button
                  className="ft-dialog-btn ft-dialog-btn--cancel"
                  onClick={handleCancelCreate}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  className={t-dialog-btn ft-dialog-btn--confirm }
                  onClick={handleCreateConfirm}
                  disabled={!createTitle.trim() || isSaving}
                  whileHover={createTitle.trim() ? { scale: 1.02 } : {}}
                  whileTap={createTitle.trim() ? { scale: 0.98 } : {}}
                >
                  {isSaving ? (
                    <span className="ft-dialog-spinner" />
                  ) : (
                    "Create"
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Delete Confirmation Dialog ===== */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="ft-dialog-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              className="ft-dialog ft-dialog--danger"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ft-dialog-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </div>
              <h3 className="ft-dialog-title">Confirm Delete</h3>
              <p className="ft-dialog-text">
                Are you sure you want to delete <strong>{deleteTarget.title}</strong>?
              </p>
              <p className="ft-dialog-hint">This operation cannot be undone. All child nodes will also be deleted.</p>
              <div className="ft-dialog-actions">
                <motion.button
                  className="ft-dialog-btn ft-dialog-btn--cancel"
                  onClick={() => setDeleteTarget(null)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  className="ft-dialog-btn ft-dialog-btn--danger"
                  onClick={handleDeleteConfirm}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Confirm Delete
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
