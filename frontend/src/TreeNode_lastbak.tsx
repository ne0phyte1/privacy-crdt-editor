import { useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ViewNode } from "./types";
import "./TreeNode.css";

interface TreeNodeProps {
  node: ViewNode;
  depth: number;
  selectedId?: string | null;
  onSelect: (node: ViewNode) => void;
  onDelete: (node: ViewNode) => void;
  expanded: boolean;
  onToggle: (nodeId: string) => void;
  animationDelay: number;
}

const TreeNodeComponent = memo(function TreeNodeComponent({
  node,
  depth,
  selectedId,
  onSelect,
  onDelete,
  expanded,
  onToggle,
  animationDelay,
}: TreeNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const handleSelect = useCallback(() => {
    onSelect(node);
  }, [node, onSelect]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(node.viewNodeId);
  }, [node.viewNodeId, onToggle]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(node);
  }, [node, onDelete]);

  const isSelected = selectedId === node.viewNodeId;

  // Level/Target label style
  const getLevelLabel = (): { label: string; className: string } => {
    switch (node.level) {
      case 1:
        return { label: node.target === "all" ? "Global" : L1:, className: "vis-public" };
      case 2:
        return { label: node.target, className: "vis-group" };
      case 3:
        return { label: node.target, className: "vis-private" };
    }
  };

  const visibilityLabel = getLevelLabel();

  return (
    <motion.div
      className="tree-node-wrapper"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.5,
        delay: animationDelay * 0.06,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <motion.div
        className={	ree-node  }
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={handleSelect}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        whileHover={{ x: 4 }}
        layout
      >
        {/* Expand/Collapse button */}
        <button
          className={	ree-node-toggle }
          onClick={handleToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <motion.svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path d="M4 2L8 6L4 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </motion.svg>
        </button>

        {/* Node icon */}
        <div className="tree-node-icon">
          {hasChildren ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
            </svg>
          )}
        </div>

        {/* Node title */}
        <span className="tree-node-title">{node.title || "(Untitled)"}</span>

        {/* Level/Target badge */}
        <span className={	ree-node-vis }>
          {visibilityLabel.label}
        </span>

        {/* Action buttons */}
        <div className="tree-node-actions">
          <button
            className="tree-node-action-btn"
            onClick={handleDelete}
            title="Delete node"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </motion.div>

      {/* Children list */}
      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            className="tree-node-children"
            key="children"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {node.children!.map((child: ViewNode, index: number) => (
              <TreeNodeComponent
                key={child.viewNodeId}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onDelete={onDelete}
                expanded={expanded}
                onToggle={onToggle}
                animationDelay={animationDelay + index}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

interface TreeNodeListProps {
  tree: ViewNode | null;
  selectedId?: string | null;
  onSelect: (node: ViewNode) => void;
  onDelete: (node: ViewNode) => void;
  expandedNodes: Set<string>;
  onToggleNode: (nodeId: string) => void;
}

export default function TreeNodeList({
  tree,
  selectedId,
  onSelect,
  onDelete,
  expandedNodes,
  onToggleNode,
}: TreeNodeListProps) {
  if (!tree) {
    return (
      <div className="tree-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        <p>No visible nodes</p>
      </div>
    );
  }

  return (
    <div className="tree-node-list">
      <TreeNodeComponent
        node={tree}
        depth={0}
        selectedId={selectedId}
        onSelect={onSelect}
        onDelete={onDelete}
        expanded={expandedNodes.has(tree.viewNodeId)}
        onToggle={onToggleNode}
        animationDelay={0}
      />
    </div>
  );
}
