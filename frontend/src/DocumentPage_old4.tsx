import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { AuthUser, ViewNode, ViewOperation, UserView } from "./types";
import "./DocumentPage.css";

interface DocumentPageProps {
  user: AuthUser;
  node: ViewNode | null;
  nodeId: string;
  view: UserView | null;
  loading: boolean;
  onSave: (op: ViewOperation) => Promise<any>;
  onBack: () => void;
  onRefresh: () => void;
  onNavigate: (nodeId: string) => void;
}

export default function DocumentPage({
  user,
  node,
  nodeId,
  view,
  loading,
  onSave,
  onBack,
  onRefresh,
  onNavigate,
}: DocumentPageProps) {
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [treePanelOpen, setTreePanelOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevContentRef = useRef("");

  // Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({
        placeholder: "Start writing document content...",
      }),
    ],
    content: "",
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      if (html !== prevContentRef.current) {
        prevContentRef.current = html;
        scheduleSave(title, html);
      }
    },
  });

  // Initialize: sync node data to editor
  useEffect(() => {
    if (node) {
      setTitle(node.title);
      setSaved(true);

      const nodeContent = node.content || "";
      if (editor && nodeContent !== prevContentRef.current) {
        prevContentRef.current = nodeContent;
        editor.commands.setContent(nodeContent, { emitUpdate: false });
      }
    } else {
      setTitle("");
      setSaved(true);
      if (editor) {
        prevContentRef.current = "";
        editor.commands.setContent("", { emitUpdate: false });
      }
    }
  }, [node, nodeId, editor]);

  useEffect(() => {
    if (node) {
      prevContentRef.current = node.content || "";
    }
  }, [nodeId]);

  // Auto-save (debounce 1.5s)
  const scheduleSave = useCallback(
    (newTitle: string, newContent: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaved(false);
      saveTimerRef.current = setTimeout(async () => {
        if (!nodeId || nodeId === "root") return;
        const op: ViewOperation = {
          type: "update",
          viewNodeId: nodeId,
          payload: { title: newTitle, content: newContent },
        };
        await onSave(op);
        setSaved(true);
      }, 1500);
    },
    [nodeId, onSave]
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setTitle(v);
      const html = editor ? editor.getHTML() : "";
      scheduleSave(v, html);
    },
    [editor, scheduleSave]
  );

  // Delete
  const handleDelete = useCallback(async () => {
    if (!nodeId || nodeId === "root") return;
    const op: ViewOperation = {
      type: "delete",
      viewNodeId: nodeId,
      payload: {},
    };
    const result = await onSave(op);
    if (result.status === "accepted") {
      onBack();
    } else {
      alert(result.message || "Delete failed");
    }
    setShowDeleteConfirm(false);
  }, [nodeId, onSave, onBack]);

  // Level label
  const getLevelLabel = (level: number): string => {
    switch (level) {
      case 1: return "Global";
      case 2: return "Group";
      case 3: return "Private";
      default: return L;
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="doc-loading">
        <div className="tp-spinner" />
        <p>Loading document...</p>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="doc-error">
        <p>Document not found or no access permission</p>
        <button onClick={onBack}>Back to tree</button>
      </div>
    );
  }

  return (
    <div className="document-page">
      {/* Header bar */}
      <div className="dp-header">
        <button className="dp-back-btn" onClick={onBack} title="Back to document tree">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div className="dp-header-info">
          <span className={dp-level-badge dp-level--}>
            {getLevelLabel(node.level)}
          </span>
          <span className="dp-target-badge">Target: {node.target}</span>
        </div>

        <div className="dp-header-actions">
          <span className={dp-save-status }>
            {saved ? "Saved" : "Unsaved..."}
          </span>
          <button className="dp-tree-btn" onClick={() => setTreePanelOpen(true)} title="Document tree">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </button>
          <button className="dp-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="Delete document">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Title input */}
      <div className="dp-title-area">
        <input
          className="dp-title-input"
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled document"
        />
      </div>

      {/* Editor */}
      <div className="dp-editor-area">
        <EditorContent editor={editor} className="dp-editor-content" />
      </div>

      {/* Delete confirm dialog */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div
            className="ft-dialog-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              className="ft-dialog ft-dialog--danger"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
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
                Delete <strong>{node.title}</strong>?
              </p>
              <p className="ft-dialog-hint">This cannot be undone. All child nodes will also be deleted.</p>
              <div className="ft-dialog-actions">
                <motion.button
                  className="ft-dialog-btn ft-dialog-btn--cancel"
                  onClick={() => setShowDeleteConfirm(false)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  className="ft-dialog-btn ft-dialog-btn--danger"
                  onClick={handleDelete}
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

      {/* Tree panel overlay */}
      <AnimatePresence>
        {treePanelOpen && (
          <TreePanel
            tree={view?.tree || null}
            currentNodeId={nodeId}
            loading={loading}
            onNavigate={onNavigate}
            onClose={() => setTreePanelOpen(false)}
            view={view}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================
// Tree Panel (sidebar overlay)
// ============================================================
interface TreePanelProps {
  tree: ViewNode | null;
  currentNodeId: string;
  loading: boolean;
  onNavigate: (nodeId: string) => void;
  onClose: () => void;
  view: UserView | null;
}

function TreePanel({ tree, currentNodeId, loading, onNavigate, onClose, view }: TreePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");

  function renderNode(node: ViewNode, depth: number): React.ReactNode {
    const isActive = node.viewNodeId === currentNodeId;
    const hasChildren = node.children && node.children.length > 0;
    const matchesSearch = !searchQuery || node.title.toLowerCase().includes(searchQuery.toLowerCase()) || node.children.some(c => matchesAny(c, searchQuery.toLowerCase()));

    if (searchQuery && !matchesSearch) return null;

    return (
      <div key={node.viewNodeId} className="tp-node-wrapper">
        <button
          className={	p-node }
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => {
            onNavigate(node.viewNodeId);
            onClose();
          }}
        >
          <span className="tp-node-icon">
            {hasChildren ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            )}
          </span>
          <span className="tp-node-title">{node.title || "(Untitled)"}</span>
          <span className={	p-node-vis tp-vis--l}>
            L{node.level}
          </span>
        </button>
        {hasChildren && (
          <div className="tp-node-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function matchesAny(node: ViewNode, query: string): boolean {
    if (node.title.toLowerCase().includes(query)) return true;
    return node.children.some((c) => matchesAny(c, query));
  }

  return (
    <motion.div
      className="tree-panel-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="tree-panel"
        initial={{ x: 340, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 340, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tp-header">
          <h2 className="tp-title">Document Tree</h2>
          <button className="tp-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="tp-stats">
          <span className="tp-stat"><strong>{view?.stats?.totalNodes || 0}</strong> total</span>
          <span className="tp-stat"><strong>{view?.stats?.visibleNodes || 0}</strong> visible</span>
        </div>

        <div className="tp-search">
          <svg className="tp-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="tp-search-input"
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="tp-tree-scroll">
          {loading ? (
            <div className="tp-loading">
              <div className="tp-spinner" /><p>Loading...</p>
            </div>
          ) : !tree ? (
            <div className="tp-empty">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.25">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
              <p>No data</p>
            </div>
          ) : (
            <div className="tp-tree">
              {tree.children.map((child) => renderNode(child, 0))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
