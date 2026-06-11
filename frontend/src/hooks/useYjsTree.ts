import { useEffect, useRef, useCallback, useState } from "react";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { IndexeddbPersistence } from "y-indexeddb";
// Using browser-native crypto.randomUUID()
import type { TreeNode } from "../types";

// ============================================================
// Yjs Tree Operations Hook
// Maintains an always-on Yjs connection for tree-level CRDT ops.
// Used for offline-capable create/delete/rename of tree nodes.
// Falls back to the caller when Yjs is not available.
// ============================================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "joined";

interface UseYjsTreeOptions {`n  token: string;`n  userId: string;`n  userName: string;`n  userGroup: string;`n}

interface UseYjsTreeResult {
  /** Whether the Yjs tree connection is active */
  treeConnected: boolean;
  connStatus: ConnectionStatus;
  /** Create a child node via Yjs CRDT. Returns the new nodeId. Null means fall back to REST. */
  createNode: (
    parentId: string,
    title: string,
    level: 1 | 2 | 3,
    target: string
  ) => string | null;
  /** Delete a node via Yjs CRDT */
  deleteNode: (nodeId: string) => boolean;
  /** Update node title via Yjs CRDT */
  updateNodeTitle: (nodeId: string, title: string) => boolean;
}

export function useYjsTree({`n  token,`n  userId,`n  userName,`n  userGroup,`n}: UseYjsTreeOptions): UseYjsTreeResult {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const pendingRef = useRef<Array<() => void>>([]);
  const readyRef = useRef(false);

  // Connect WebSocket to root room for tree operations
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempt = 0;
    const maxBackoff = 10000;

    function connect() {
      setConnStatus("connecting");
      const wsBase = getWsBase();
      try {
        ws = new WebSocket(`${wsBase}?token=${encodeURIComponent(token)}`);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      // Create local Y.Doc with IndexedDB persistence
      const doc = new Y.Doc();
      docRef.current = doc;

      const idb = new IndexeddbPersistence("yjs-tree-root", doc);
      idbRef.current = idb;

      idb.on("synced", () => {
        console.log("[YJS Tree] IndexedDB synced");
      });

      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnStatus("connected");
        // Join root room
        ws.send(JSON.stringify({ type: "join", nodeId: "root" }));
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "joined") {
              setConnStatus("joined");
              readyRef.current = true;
              // Flush pending operations
              const pending = pendingRef.current;
              pendingRef.current = [];
              for (const fn of pending) fn();
            } else if (msg.type === "tree-rejected") {
              console.warn(`[YJS Tree] Operation rejected: ${msg.operation} on "${msg.nodeId}" — ${msg.reason}`);
              // The backend will have reverted the node; our local Y.Doc will get the revert in next sync
            } else if (msg.type === "error") {
              console.error("[YJS Tree] Server error:", msg.message);
            }
            return;
          }

          // Binary Yjs protocol messages
          const data = new Uint8Array(event.data);
          const decoder = decoding.createDecoder(data);
          const messageType = decoding.readVarUint(decoder);
          const localDoc = docRef.current;
          if (!localDoc) return;

          if (messageType === 0) {
            const syncType = decoding.readVarUint(decoder);
            if (syncType === 0) {
              syncProtocol.readSyncStep1(decoder, localDoc, ws as any);
              const encoder = encoding.createEncoder();
              encoding.writeVarUint(encoder, 0);
              syncProtocol.writeSyncStep2(encoder, localDoc);
              if (ws.readyState === ws.OPEN) ws.send(encoding.toUint8Array(encoder));
            } else if (syncType === 1) {
              syncProtocol.readSyncStep2(decoder, localDoc, ws as any);
            } else if (syncType === 2) {
              const update = decoding.readVarUint8Array(decoder);
              Y.applyUpdate(localDoc, update, ws as any);
            }
          }
        } catch (err) {
          console.error("[YJS Tree] Parse error:", err);
        }
      };

      ws.onclose = () => {
        setConnStatus("disconnected");
        readyRef.current = false;
        scheduleReconnect();
      };

      ws.onerror = () => ws.close();
    }

    function scheduleReconnect() {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxBackoff);
      reconnectAttempt++;
      reconnectTimer = setTimeout(connect, delay);
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (idbRef.current) { try { idbRef.current.destroy(); } catch {} }
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [token]);

  // Create a child node via Yjs CRDT
  const createNode = useCallback((
    parentId: string,
    title: string,
    level: 1 | 2 | 3,
    target: string
  ): string | null => {
    const doc = docRef.current;
    if (!doc) return null;

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    const node: any = {
      id: newId,
      parentId,
      title,
      content: "",
      level,
      target,
      deleted: false,
      createdBy: userId,
      updatedBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    const doCreate = () => {
      const sharedNodes = doc.getMap("sharedNodes");
      const sharedChildren = doc.getMap("sharedChildren");

      doc.transact(() => {
        // Add node to sharedNodes
        sharedNodes.set(newId, node);

        // Add to parent''s children list
        const siblings = sharedChildren.get(parentId) || [];
        if (!siblings.includes(newId)) {
          sharedChildren.set(parentId, [...siblings, newId]);
        }

        // Ensure new node has empty children list
        if (!sharedChildren.has(newId)) {
          sharedChildren.set(newId, []);
        }
      });

      // Send update to server
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const update = Y.encodeStateAsUpdate(doc);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint8Array(encoder, update);
        try { ws.send(encoding.toUint8Array(encoder)); } catch {}
      }
    };

    if (readyRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      doCreate();
    } else {
      // Queue for when connection is ready
      pendingRef.current.push(doCreate);
      // Rejoin if needed
      if (wsRef.current?.readyState === WebSocket.OPEN && !readyRef.current) {
        wsRef.current.send(JSON.stringify({ type: "join", nodeId: "root" }));
      }
    }

    return newId;
  }, [userName]);

  // Delete a node via Yjs CRDT
  const deleteNode = useCallback((nodeId: string): boolean => {
    const doc = docRef.current;
    if (!doc) return false;

    const doDelete = () => {
      const sharedNodes = doc.getMap("sharedNodes");
      const sharedChildren = doc.getMap("sharedChildren");
      const existing = sharedNodes.get(nodeId);

      if (!existing || existing.deleted) return;

      doc.transact(() => {
        // Mark as deleted
        sharedNodes.set(nodeId, {
          ...existing,
          deleted: true,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        });
      });

      // Send update to server
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const update = Y.encodeStateAsUpdate(doc);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint8Array(encoder, update);
        try { ws.send(encoding.toUint8Array(encoder)); } catch {}
      }
    };

    if (readyRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      doDelete();
    } else {
      pendingRef.current.push(doDelete);
    }

    return true;
  }, [userName]);

  // Update node title via Yjs CRDT
  const updateNodeTitle = useCallback((nodeId: string, title: string): boolean => {
    const doc = docRef.current;
    if (!doc) return false;

    const doUpdate = () => {
      const sharedNodes = doc.getMap("sharedNodes");
      const existing = sharedNodes.get(nodeId);
      if (!existing || existing.deleted) return;

      doc.transact(() => {
        sharedNodes.set(nodeId, {
          ...existing,
          title,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        });
      });
    };

    if (readyRef.current) {
      doUpdate();
    } else {
      pendingRef.current.push(doUpdate);
    }

    return true;
  }, [userName]);

  return {
    treeConnected: connStatus === "joined",
    connStatus,
    createNode,
    deleteNode,
    updateNodeTitle,
  };
}

function getWsBase(): string {
  if (typeof window === "undefined") return "ws://localhost:3001/ws";
  const envWsBase =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_WS_BASE;
  if (envWsBase) return envWsBase;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}


