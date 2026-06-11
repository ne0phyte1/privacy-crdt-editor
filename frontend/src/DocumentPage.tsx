import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import type { AuthUser, ViewNode, ViewOperation, UserView } from "./types";
import { useYjsCollab } from "./hooks/useYjsCollab";
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
  onToast: (text: string, type: "error" | "warning" | "success") => void;
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
  onToast,
}: DocumentPageProps) {
  const [title, setTitle] = useState("");
  const [nodeTitle, setNodeTitle] = useState("");
  
  // Yjs collaboration
  const { doc: yDoc, connected: yConnected, joined: yJoined, connStatus, error: yError } = useYjsCollab({
    token: user.token,
    nodeId: nodeId && nodeId !== "root" ? nodeId : null,
    userName: user.username,
  });
  
  const [saved, setSaved] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [treePanelOpen, setTreePanelOpen] = useState(false);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevContentRef = useRef("");

  // Tiptap 缂栬緫鍣紙Yjs 鍗忎綔妯″紡鎴栨櫘閫氭ā寮忥級
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        history: false, // Yjs handles history
      }),
      Placeholder.configure({
        placeholder: "寮€濮嬬紪鍐欐枃妗ｅ唴瀹光€?,
      }),
      ...(yDoc ? [Collaboration.configure({ document: yDoc })] : []),
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

  // 鍒濆鍖?鍚屾 node 鏁版嵁
  useEffect(() => {
    if (node) {
      setTitle(node.title);
      setNodeTitle(node.title);
      setSaved(true);

      // Only set content from REST if Yjs is not yet joined (first load)
      if (!yJoined && editor) {
        const nodeContent = node.content || "";
        if (nodeContent !== prevContentRef.current) {
          prevContentRef.current = nodeContent;
          editor.commands.setContent(nodeContent, { emitUpdate: false });
        }
      }
    } else {
      setTitle("");
      setNodeTitle("");
      setSaved(true);
      if (editor && !yJoined) {
        prevContentRef.current = "";
        editor.commands.setContent("", { emitUpdate: false });
      }
    }
  }, [node, nodeId, editor, yJoined]);

  // 鈽?褰?node 鍒濇鍔犺浇鏃讹紝棰勫～鍏?prevContentRef
  useEffect(() => {
    if (node) {
      prevContentRef.current = node.content || "";
    }
  }, [nodeId]);

  // 鑷姩淇濆瓨锛堥槻鎶?1.5 绉掞級
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

  // 鍒犻櫎鏂囨。
  const handleDelete = useCallback(async () => {
    if (!nodeId || nodeId === "root") return;
    const result = await onSave({ type: "delete", viewNodeId: nodeId, payload: {} });
    if (result?.status !== "accepted") {
      onToast(result?.message || "鍒犻櫎澶辫触", "error");
    } else {
      onBack();
    }
  }, [nodeId, onSave, onBack, onToast]);

  // 娓呯悊瀹氭椂鍣?
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // 瀛愭枃妗ｅ垪琛紙褰撳墠鑺傜偣鐨勫瓙鑺傜偣锛?
  const childDocuments = node?.children || [];

  return (
    <motion.div
      className="document-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* ===== 椤堕儴宸ュ叿鏍?===== */}
      <div className="dp-toolbar">
        <div className="dp-toolbar-left">
          <motion.button
            className="dp-btn dp-btn--icon"
            onClick={onBack}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="杩斿洖"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </motion.button>
          <span className="dp-breadcrumb">
            <button className="dp-breadcrumb-link" onClick={onBack}>鏂囨。</button>
            <span className="dp-breadcrumb-sep">/</span>
            <span className="dp-breadcrumb-current">{title || "鏈懡鍚嶆枃妗?}</span>
          </span>
        </div>
        <div className="dp-toolbar-right">
          <span className={`dp-save-status ${saved ? "saved" : "unsaved"}`}>
            {saved ? "宸蹭繚瀛? : "淇濆瓨涓€?}
          </span>

          {/* 鈽?鏍戠姸鍥惧紑鍏?鈥斺€?浠呭湪鏂囨。缂栬緫椤垫樉绀?*/}
          <motion.button
            className={`dp-btn dp-btn--tree ${treePanelOpen ? "active" : ""}`}
            onClick={() => setTreePanelOpen(!treePanelOpen)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="鏂囨。鏍?
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            鏂囨。鏍?
          </motion.button>

          <motion.button
            className="dp-btn"
            onClick={onRefresh}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="鍒锋柊"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </motion.button>
          {yDoc && (
            <span className={`dp-collab-status ${yJoined ? "connected" : connStatus === "connecting" ? "connecting" : "offline"}`} title={yJoined ? "鍗忎綔宸茶繛鎺? : connStatus === "connecting" ? "姝ｅ湪杩炴帴鍗忎綔鏈嶅姟..." : "绂荤嚎妯″紡 鈥?鏇存敼宸蹭繚瀛樻湰鍦帮紝鎭㈠杩炴帴鍚庤嚜鍔ㄥ悓姝?}>
              <span className="dp-collab-dot" />
              {yJoined ? "鍗忎綔" : connStatus === "connecting" ? "杩炴帴..." : connStatus === "disconnected" ? "绂荤嚎" : "绛夊緟"}
            </span>
          )}
          <motion.button
            className="dp-btn dp-btn--danger"
            onClick={() => setShowDeleteConfirm(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            title="鍒犻櫎鏂囨。"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </motion.button>
        </div>
      </div>

      {/* ===== 鍙紪杈戝唴瀹瑰尯 ===== */}
      <div className="dp-body">
        {/* 鏍囬 */}
        <div className="dp-title-row">
          <input
            className="dp-title-input"
            type="text"
            value={title}
            onChange={handleTitleChange}
            placeholder="杈撳叆鏂囨。鏍囬鈥?
            autoFocus
          />
        </div>

        {/* 灞炴€ф爮 */}
        <div className="dp-props">
          <div className="dp-prop">
            <span className="dp-prop-label">绾у埆</span>
            <span className={`dp-level-badge dp-level--${node?.level || 1}`}>
              {node?.level === 1 ? "馃寪 涓€绾峰叏鍩熷叕鍛? : node?.level === 2 ? "馃懃 浜岀骇路缁勫唴鍏憡" : "馃敀 涓夌骇路缁勯棿鏂囨。"}
            </span>
          </div>
          <div className="dp-prop">
            <span className="dp-prop-label">鍙鑼冨洿</span>
            <span className="dp-prop-value">
              {node?.target === "all" ? "馃寪 鎵€鏈変汉" : `馃懃 ${node?.target || "鈥?}`}
            </span>
          </div>
        </div>

        {/* 鈽?杞婚噺鍖栧瘜鏂囨湰缂栬緫鍣紙Tiptap锛?*/}
        <div className="dp-editor-wrapper">
          {/* 鏍煎紡宸ュ叿鏍忥紙鎮仠鏄剧ず锛?*/}
          {editor && (
            <div
              className={`dp-format-bar ${showFormatBar ? "visible" : ""}`}
              onMouseEnter={() => setShowFormatBar(true)}
              onMouseLeave={() => setShowFormatBar(false)}
            >
              <button
                className={`dp-fmt-btn ${editor.isActive("bold") ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleBold().run()}
                title="绮椾綋"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
                </svg>
              </button>
              <button
                className={`dp-fmt-btn ${editor.isActive("italic") ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title="鏂滀綋"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 4h-9M14 20H5M15 4L9 20"/>
                </svg>
              </button>
              <button
                className={`dp-fmt-btn ${editor.isActive("heading", { level: 2 }) ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                title="浜岀骇鏍囬"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h8M4 18V6M12 18V6M21 18h-4l4-6-4-6"/>
                </svg>
              </button>
              <button
                className={`dp-fmt-btn ${editor.isActive("heading", { level: 3 }) ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                title="涓夌骇鏍囬"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12h8M4 18V6M12 18V6M20 16l2-4-2-4M18 18h4"/>
                </svg>
              </button>
              <span className="dp-fmt-divider" />
              <button
                className={`dp-fmt-btn ${editor.isActive("bulletList") ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title="鏃犲簭鍒楄〃"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="18" r="1"/>
                </svg>
              </button>
              <button
                className={`dp-fmt-btn ${editor.isActive("orderedList") ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title="鏈夊簭鍒楄〃"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="10" fontSize="10" fontWeight="700" fill="currentColor">1.</text><text x="2" y="16" fontSize="10" fontWeight="700" fill="currentColor">2.</text><text x="2" y="22" fontSize="10" fontWeight="700" fill="currentColor">3.</text>
                </svg>
              </button>
              <span className="dp-fmt-divider" />
              <button
                className={`dp-fmt-btn ${editor.isActive("blockquote") ? "active" : ""}`}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                title="寮曠敤"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
                </svg>
              </button>
              <button
                className={`dp-fmt-btn`}
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                title="鍒嗗壊绾?
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="12" x2="21" y2="12"/>
                </svg>
              </button>
            </div>
          )}

          {/* 缂栬緫鍣ㄤ富浣?*/}
          <EditorContent
            editor={editor}
            className="dp-tiptap-editor"
            onFocus={() => setShowFormatBar(true)}
            onBlur={() => setShowFormatBar(false)}
          />
        </div>

        {/* 瀛愭枃妗ｅ垪琛?*/}
        {childDocuments.length > 0 && (
          <div className="dp-children-section">
            <h3 className="dp-children-title">瀛愭枃妗?/h3>
            <div className="dp-children-grid">
              {childDocuments.map((child) => (
                <motion.button
                  key={child.viewNodeId}
                  className="dp-child-card"
                  onClick={() => onNavigate(child.viewNodeId)}
                  whileHover={{ y: -2, boxShadow: "var(--shadow-md)" }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="dp-child-icon">
                    {child.level === 1 ? "馃寪" : child.level === 2 ? "馃懃" : "馃敀"}
                  </div>
                  <div className="dp-child-info">
                    <span className="dp-child-title">{child.title || "锛堟棤鏍囬锛?}</span>
                    <span className="dp-child-preview">
                      {child.content
                        ? child.content.replace(/<[^>]*>/g, "").slice(0, 40) + (child.content.length > 40 ? "鈥? : "")
                        : "绌烘枃妗?}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== 鈽?娴姩鏍戦潰鏉匡紙浠呮枃妗ｇ紪杈戦〉锛?===== */}
      <AnimatePresence>
        {treePanelOpen && (
          <TreePanel
            view={view}
            loading={loading}
            currentDocId={nodeId}
            onClose={() => setTreePanelOpen(false)}
            onNavigate={(nid) => {
              setTreePanelOpen(false);
              onNavigate(nid);
            }}
          />
        )}
      </AnimatePresence>

      {/* ===== 鍒犻櫎纭寮圭獥 ===== */}
      {showDeleteConfirm && (
        <motion.div
          className="dp-delete-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="dp-delete-dialog"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="dp-delete-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <p className="dp-delete-text">
              纭畾鍒犻櫎銆?strong>{title}</strong>銆嶅悧锛?
            </p>
            <p className="dp-delete-hint">姝ゆ搷浣滀笉鍙挙閿€锛屾墍鏈夊瓙鑺傜偣涔熷皢琚垹闄?/p>
            <div className="dp-delete-actions">
              <button className="dp-btn" onClick={() => setShowDeleteConfirm(false)}>
                鍙栨秷
              </button>
              <button className="dp-btn dp-btn--danger-solid" onClick={handleDelete}>
                纭鍒犻櫎
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
      );
    }
    
    // ===== 鈽?鍐呰仈娴姩鏍戦潰鏉匡紙鍘?TreePanel锛?=====
    function TreePanel({
      view,
      loading,
      currentDocId,
      onClose,
      onNavigate,
    }: {
      view: UserView | null;
      loading: boolean;
      currentDocId: string | null;
      onClose: () => void;
      onNavigate: (nodeId: string) => void;
    }) {
      const tree = view?.tree || null;
      const [searchQuery, setSearchQuery] = useState("");
    
      function renderNode(node: ViewNode, depth: number) {
        const isActive = node.viewNodeId === currentDocId;
        const hasChildren = node.children.length > 0;
    
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match = node.title.toLowerCase().includes(q);
          const childMatch = node.children.some((c) => matchesSearch(c, q));
          if (!match && !childMatch) return null;
        }
    
        return (
          <div key={node.viewNodeId} className="tp-node-wrapper">
            <button
              className={`tp-node ${isActive ? "tp-node--active" : ""}`}
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
              <span className="tp-node-title">{node.title || "锛堟棤鏍囬锛?}</span>
              <span className={`tp-node-vis tp-vis--level${node.level}`}>
                {node.level === 1 ? "鍏ㄥ煙" : node.level === 2 ? "缁勫叕鍛? : "缁勬枃妗?}
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
    
      function matchesSearch(node: ViewNode, query: string): boolean {
        if (node.title.toLowerCase().includes(query)) return true;
        return node.children.some((c) => matchesSearch(c, query));
      }
    
      function flattenNodes(node: ViewNode, list: ViewNode[] = []): ViewNode[] {
        list.push(node);
        for (const child of node.children) {
          flattenNodes(child, list);
        }
        return list;
      }
    
      const allNodes = tree ? flattenNodes(tree) : [];
    
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
              <h2 className="tp-title">鏂囨。鏍?/h2>
              <button className="tp-close-btn" onClick={onClose}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
    
            <div className="tp-stats">
              <span className="tp-stat"><strong>{allNodes.length}</strong> 鑺傜偣</span>
              <span className="tp-stat"><strong>{view?.stats.visibleNodes || 0}</strong> 鍙</span>
            </div>
    
            <div className="tp-search">
              <svg className="tp-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="tp-search-input"
                type="text"
                placeholder="鎼滅储鑺傜偣鈥?
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
    
            <div className="tp-tree-scroll">
              {loading ? (
                <div className="tp-loading">
                  <div className="tp-spinner" /><p>鍔犺浇涓€?/p>
                </div>
              ) : !tree ? (
                <div className="tp-empty">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.25">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                  </svg>
                  <p>鏆傛棤鏁版嵁</p>
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


