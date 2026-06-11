import { useEffect, useRef, useCallback, useState } from "react";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { IndexeddbPersistence } from "y-indexeddb";

// ============================================================
// Offline-First Yjs Collaboration Hook
// - IndexedDB persistence for offline edits
// - Automatic reconnection with state sync
// - Awareness (online status, user cursors)
// ============================================================

function getWsBase(): string {
  if (typeof window === "undefined") return "ws://localhost:3001/ws";
  const envWsBase =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_WS_BASE;
  if (envWsBase) return envWsBase;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "joined";

interface UseYjsCollabOptions {
  token: string;
  nodeId: string | null;
  userName: string;
}

interface UseYjsCollabResult {
  doc: Y.Doc | null;
  awareness: awarenessProtocol.Awareness | null;
  connected: boolean;
  joined: boolean;
  connStatus: ConnectionStatus;
  error: string | null;
}

export function useYjsCollab({
  token,
  nodeId,
  userName,
}: UseYjsCollabOptions): UseYjsCollabResult {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<awarenessProtocol.Awareness | null>(null);
  const awarenessRef = useRef<awarenessProtocol.Awareness | null>(null);
  const currentRoomRef = useRef<string | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);

  // Cleanup IndexedDB provider
  const destroyIdb = useCallback(() => {
    if (idbRef.current) {
      try {
        idbRef.current.destroy();
      } catch {}
      idbRef.current = null;
    }
  }, []);

  // WebSocket connection lifecycle
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempt = 0;
    const maxBackoff = 10000;

    function connect() {
      setConnStatus("connecting");
      try {
        ws = new WebSocket(`${getWsBase()}?token=${encodeURIComponent(token)}`);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt = 0;
        setConnStatus("connected");
        setError(null);
        // Rejoin current room if any
        if (currentRoomRef.current) {
          joinRoom(ws, currentRoomRef.current);
        }
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "joined") {
              setConnStatus("joined");
              currentRoomRef.current = msg.nodeId;
            } else if (msg.type === "error") {
              setError(msg.message);
            } else if (msg.type === "pong") {
              // Keep-alive acknowledged
            }
            return;
          }

          // Binary Yjs message
          const data = new Uint8Array(event.data);
          const decoder = decoding.createDecoder(data);
          const messageType = decoding.readVarUint(decoder);

          const localDoc = docRef.current;
          const localAwareness = awarenessRef.current;
          if (!localDoc || !localAwareness) return;

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
          } else if (messageType === 1) {
            awarenessProtocol.applyAwarenessUpdate(
              localAwareness,
              decoding.readVarUint8Array(decoder),
              ws as any
            );
          }
        } catch (err) {
          console.error("[YJS Client] Parse error:", err);
        }
      };

      ws.onclose = () => {
        setConnStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    function scheduleReconnect() {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxBackoff);
      reconnectAttempt++;
      console.log(`[YJS Client] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
      reconnectTimer = setTimeout(connect, delay);
    }

    connect();

    // Ping every 25 seconds to keep WebSocket alive
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "ping" }));
        } catch {}
      }
    }, 25000);

    return () => {
      clearTimeout(reconnectTimer);
      clearInterval(pingInterval);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [token]);

  // Room join/leave on nodeId change
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Leave old room
    if (currentRoomRef.current && currentRoomRef.current !== nodeId) {
      ws.send(JSON.stringify({ type: "leave" }));
      currentRoomRef.current = null;
      setConnStatus("connected");
      destroyIdb();
    }

    // Join new room
    if (nodeId && nodeId !== currentRoomRef.current) {
      const newDoc = new Y.Doc();
      const newAwareness = new awarenessProtocol.Awareness(newDoc);
      newAwareness.setLocalState({
        user: {
          name: userName,
          color: getUserColor(userName),
        },
      });

      // --- Offline persistence with IndexedDB ---
      const dbName = `yjs-doc-${nodeId}`;
      const idb = new IndexeddbPersistence(dbName, newDoc);
      idbRef.current = idb;

      idb.on("synced", () => {
        console.log(`[YJS] IndexedDB synced for doc ${nodeId}`);
      });

      docRef.current = newDoc;
      setDoc(newDoc);
      awarenessRef.current = newAwareness;
      setAwareness(newAwareness);

      // Send outgoing updates to server
      newDoc.on("update", (update: Uint8Array, origin: any) => {
        if (origin === ws || ws.readyState !== WebSocket.OPEN) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarUint8Array(encoder, update);
        try { ws.send(encoding.toUint8Array(encoder)); } catch {}
      });

      // Send awareness changes to server
      newAwareness.on("update", ({ added, updated, removed }: any, origin: any) => {
        if (origin === ws || ws.readyState !== WebSocket.OPEN) return;
        const changed = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 1);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(newAwareness, changed)
        );
        try { ws.send(encoding.toUint8Array(encoder)); } catch {}
      });

      joinRoom(ws, nodeId);
    }

    return () => {
      destroyIdb();
    };
  }, [nodeId, userName]);

  return {
    doc,
    awareness,
    connected: connStatus === "connected" || connStatus === "joined",
    joined: connStatus === "joined",
    connStatus,
    error,
  };
}

function joinRoom(ws: WebSocket, nodeId: string): void {
  ws.send(JSON.stringify({ type: "join", nodeId }));
}

// Simple color generator based on username hash
function getUserColor(name: string): string {
  const colors = [
    "#f44336", "#e91e63", "#9c27b0", "#673ab7",
    "#3f51b5", "#2196f3", "#009688", "#4caf50",
    "#ff9800", "#ff5722", "#795548", "#607d8b",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
