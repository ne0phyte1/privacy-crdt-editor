import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "ws";
import type { UserInfo } from "../privacy/accessControl.js";
import { canAccessNode, canEditNode, canCreateUnder, getUserById } from "../privacy/accessControl.js";
import type { TreeNode } from "./masterDoc.js";
import { getMasterDoc } from "./masterDoc.js";

// ============================================================
// Yjs Collaboration Server
// One Y.Doc per document node. Clients sync via WebSocket.
// Rooms persist to disk for server restart resilience.
// Content auto-syncs back to MasterDoc for REST endpoint consistency.
// Tree mutations (create/delete nodes) also flow through Yjs rooms.
// ============================================================

interface DocRoom {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  nodeId: string;
  saveTimer: ReturnType<typeof setInterval> | null;
  dirty: boolean;
  /** Shared tree maps mirroring MasterDoc structure */
  sharedNodes: Y.Map<TreeNode>;
  sharedChildren: Y.Map<string[]>;
  /** Track pending tree mutations per client for validation */
  pendingMutations: Map<WebSocket, Set<string>>;
}

const rooms = new Map<string, DocRoom>();
const clientUserMap = new Map<WebSocket, { user: UserInfo; nodeId: string | null }>();

// ============================================================
// Room Persistence (Disk)
// ============================================================

const ROOMS_DATA_DIR = path.resolve(process.cwd(), "data", "rooms");

function ensureRoomsDir(): void {
  if (!fs.existsSync(ROOMS_DATA_DIR)) {
    fs.mkdirSync(ROOMS_DATA_DIR, { recursive: true });
  }
}

function getRoomFilePath(nodeId: string): string {
  const safe = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(ROOMS_DATA_DIR, `${safe}.ydoc`);
}

function saveRoom(room: DocRoom): void {
  try {
    ensureRoomsDir();
    const update = Y.encodeStateAsUpdate(room.doc);
    fs.writeFileSync(getRoomFilePath(room.nodeId), Buffer.from(update));
    room.dirty = false;
  } catch (err) {
    console.error(`[YJS] Failed to save room ${room.nodeId}:`, (err as Error).message);
  }
}

function loadRoom(room: DocRoom): boolean {
  try {
    const filePath = getRoomFilePath(room.nodeId);
    if (!fs.existsSync(filePath)) return false;
    const buffer = fs.readFileSync(filePath);
    const update = new Uint8Array(buffer);
    Y.applyUpdate(room.doc, update);
    console.log(`[YJS] Loaded persisted room for node ${room.nodeId} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`[YJS] Failed to load room ${room.nodeId}:`, (err as Error).message);
    return false;
  }
}

function markDirty(room: DocRoom): void {
  room.dirty = true;
}

function syncRoomContentToMaster(room: DocRoom): void {
  try {
    const ytext = room.doc.getText("content");
    const content = ytext.toString();
    const master = getMasterDoc();
    const node = master.getNode(room.nodeId);
    if (node && node.content !== content) {
      master.updateNode(room.nodeId, { content }, "system");
      master.saveToFile();
    }
  } catch (err) {
    console.error(`[YJS] Failed to sync room to master ${room.nodeId}:`, (err as Error).message);
  }
}

// ============================================================
// Tree Structure Sync: MasterDoc <-> Room Y.Doc
// ============================================================

/** Populate room''s sharedNodes/sharedChildren from MasterDoc on room creation */
function populateTreeFromMaster(room: DocRoom): void {
  const master = getMasterDoc();
  const masterNodes = master.getAllNodes();
  const masterChildren = master.getAllChildren();

  room.doc.transact(() => {
    // Copy all nodes
    masterNodes.forEach((node, key) => {
      room.sharedNodes.set(key, { ...node });
    });
    // Copy all children arrays
    masterChildren.forEach((children, key) => {
      room.sharedChildren.set(key, [...children]);
    });
  });
  console.log(`[YJS] Populated tree in room ${room.nodeId}: ${masterNodes.size} nodes`);
}

/** Push room tree changes to MasterDoc (after validation) */
function applyTreeMutationToMaster(
  room: DocRoom,
  nodeId: string,
  node: TreeNode | undefined,
  userId: string
): { accepted: boolean; message: string } {
  const master = getMasterDoc();
  const existingMaster = master.getNode(nodeId);

  if (!node) {
    // Node was deleted (removed from Y.Map, or marked deleted=true)
    if (existingMaster && !existingMaster.deleted) {
      master.deleteNode(nodeId, userId);
      master.saveToFile();
      return { accepted: true, message: "deleted" };
    }
    return { accepted: true, message: "already-deleted" };
  }

  if (!existingMaster) {
    // New node creation
    const parentNode = master.getNode(node.parentId);
    if (!parentNode) {
      return { accepted: false, message: "Parent node not found" };
    }

    // Find user info for permission check
    const user = findUserForValidation(room, userId);
    if (!user) {
      return { accepted: false, message: "User not found" };
    }

    const permission = canCreateUnder(user, parentNode, node.level, node.target);
    if (!permission.allowed) {
      return { accepted: false, message: permission.message };
    }

    master.createNode(
      node.parentId,
      node.title,
      node.content,
      permission.level,
      permission.target,
      userId
    );
    master.saveToFile();
    return { accepted: true, message: "created" };
  }

  // Update existing node (title/content changes)
  const user = findUserForValidation(room, userId);
  if (!user) {
    return { accepted: false, message: "User not found" };
  }

  if (!canEditNode(user, existingMaster)) {
    return { accepted: false, message: "Permission denied for edit" };
  }

  const updates: Partial<TreeNode> = {};
  if (node.title !== existingMaster.title) updates.title = node.title;
  if (node.content !== existingMaster.content) updates.content = node.content;

  if (Object.keys(updates).length > 0) {
    master.updateNode(nodeId, updates, userId);
    master.saveToFile();
    return { accepted: true, message: "updated" };
  }

  return { accepted: true, message: "no-change" };
}

function findUserForValidation(room: DocRoom, userId: string): UserInfo | undefined {
  // First check connected clients
  for (const [ws, entry] of clientUserMap) {
    if (entry.user.userId === userId) return entry.user;
  }
  // Fallback to database lookup (for offline-created nodes)
  return getUserById(userId);
}

// ============================================================
// Tree Mutation Observer
// ============================================================

function setupTreeObserver(room: DocRoom): void {
  let observing = false;

  room.sharedNodes.observe((event: Y.YMapEvent<TreeNode>) => {
    if (observing) return; // Prevent feedback loop from our own writes
    observing = true;


    for (const [key, change] of event.changes.keys) {
      const node = room.sharedNodes.get(key);

      if (change.action === "delete" || (node && node.deleted)) {
        // Delete operation
        const result = applyTreeMutationToMaster(room, key, node || undefined, (node?.createdBy || node?.updatedBy || "system"));
        if (result.accepted) {
          console.log(`[YJS] Tree delete "${key}": ${result.message} (by ${node?.createdBy || node?.updatedBy || "unknown"})`);
          // Also update children map
          if (node?.parentId) {
            const siblings = room.sharedChildren.get(node.parentId) || [];
            const filtered = siblings.filter((id) => id !== key);
            room.sharedChildren.set(node.parentId, filtered);
          }
        } else {
          // Reject: restore the node
          const master = getMasterDoc();
          const masterNode = master.getNode(key);
          if (masterNode) {
            room.sharedNodes.set(key, { ...masterNode });
          }
          console.log(`[YJS] Tree delete REJECTED "${key}": ${result.message}`);
          notifyTreeRejection(room, (node?.createdBy || ""), key, "delete", result.message);
        }
      } else if (change.action === "add" && node) {
        // Create or update
        const master = getMasterDoc();
        const existing = master.getNode(key);

        if (!existing) {
          // New node creation
          const result = applyTreeMutationToMaster(room, key, node, (node?.createdBy || node?.updatedBy || "system"));
          if (result.accepted) {
            // Ensure children map entry
            if (!room.sharedChildren.has(key)) {
              room.sharedChildren.set(key, []);
            }
            // Add to parent''s children list
            const siblings = room.sharedChildren.get(node.parentId) || [];
            if (!siblings.includes(key)) {
              room.sharedChildren.set(node.parentId, [...siblings, key]);
            }
            console.log(`[YJS] Tree create "${key}": ${result.message} (by ${node?.createdBy || node?.updatedBy || "unknown"})`);
          } else {
            // Reject: remove the node from sharedNodes
            room.sharedNodes.delete(key);
            console.log(`[YJS] Tree create REJECTED "${key}": ${result.message}`);
            notifyTreeRejection(room, (node?.createdBy || ""), key, "create", result.message);
          }
        } else {
          // Update
          const result = applyTreeMutationToMaster(room, key, node, (node?.createdBy || node?.updatedBy || "system"));
          if (!result.accepted) {
            // Revert
            room.sharedNodes.set(key, { ...existing });
            console.log(`[YJS] Tree update REJECTED "${key}": ${result.message}`);
            notifyTreeRejection(room, (node?.createdBy || ""), key, "update", result.message);
          }
        }
      }
    }

    observing = false;
  });

  // Children map observer
  room.sharedChildren.observe((event: Y.YMapEvent<string[]>) => {
    if (observing) return;
    // Children changes are applied alongside node changes, so MasterDoc handles them
    // We still sync to master''s children map
    for (const [key, change] of event.changes.keys) {
      const children = room.sharedChildren.get(key);
      const master = getMasterDoc();
      const masterChildren = master.getAllChildren();
      const existing = masterChildren.get(key);
      if (children && JSON.stringify(children) !== JSON.stringify(existing || [])) {
        masterChildren.set(key, [...children]);
        master.saveToFile();
      }
    }
  });
}

/** Notify a client that their tree mutation was rejected */
function notifyTreeRejection(
  room: DocRoom,
  userId: string,
  nodeId: string,
  operation: string,
  reason: string
): void {
  for (const [ws, entry] of clientUserMap) {
    if (entry.user.userId === userId && entry.nodeId === room.nodeId) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: "tree-rejected",
            nodeId,
            operation,
            reason,
          }));
        }
      } catch {}
      break;
    }
  }
}

// ============================================================
// Room Management
// ============================================================

function getRoom(nodeId: string): DocRoom {
  let room = rooms.get(nodeId);
  if (!room) {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    // Create shared tree maps
    const sharedNodes = doc.getMap<TreeNode>("sharedNodes");
    const sharedChildren = doc.getMap<string[]>("sharedChildren");

    room = {
      doc,
      awareness,
      clients: new Set(),
      nodeId,
      saveTimer: null,
      dirty: false,
      sharedNodes,
      sharedChildren,
      pendingMutations: new Map(),
    };

    // Load persisted state from disk
    const loaded = loadRoom(room);

    // If no persisted state, populate from MasterDoc
    if (!loaded) {
      populateTreeFromMaster(room);
    }

    // Set up tree mutation observer
    setupTreeObserver(room);

    // Broadcast document updates to all clients in room
    doc.on("update", (update: Uint8Array, origin: any) => {
      markDirty(room!);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync
      encoding.writeVarUint(encoder, 2); // syncUpdate
      encoding.writeVarUint8Array(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      room!.clients.forEach((client) => {
        if (client !== origin && client.readyState === client.OPEN) {
          send(client, msg);
        }
      });
    });

    // Broadcast awareness changes
    awareness.on("update", ({ added, updated, removed }: any, origin: WebSocket) => {
      const changed = [...added, ...updated, ...removed];
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // messageAwareness
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      const msg = encoding.toUint8Array(encoder);

      room!.clients.forEach((client) => {
        if (client !== origin && client.readyState === client.OPEN) {
          send(client, msg);
        }
      });
    });

    // Periodic save (every 5 seconds when dirty and has clients)
    room.saveTimer = setInterval(() => {
      if (room!.dirty && room!.clients.size > 0) {
        saveRoom(room!);
        syncRoomContentToMaster(room!);
      }
    }, 5000);

    rooms.set(nodeId, room);
  }
  return room;
}

function send(ws: WebSocket, data: Uint8Array): void {
  try { if (ws.readyState === ws.OPEN) ws.send(data); } catch {}
}

function sendJson(ws: WebSocket, data: object): void {
  try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data)); } catch {}
}

// ============================================================
// Connection handler
// ============================================================

export function handleYjsConnection(
  ws: WebSocket,
  user: UserInfo,
  getNode: (id: string) => TreeNode | undefined,
  masterDoc: { getNode: (id: string) => TreeNode | undefined }
): void {
  clientUserMap.set(ws, { user, nodeId: null });

  ws.on("message", (raw: Buffer) => {
    try {
      const data = new Uint8Array(raw);

      if (data[0] === 0x7B) {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text);
        handleControlMessage(ws, user, msg, getNode, masterDoc);
        return;
      }

      const { nodeId } = clientUserMap.get(ws) || {};
      if (!nodeId) {
        sendJson(ws, { type: "error", message: "Not joined to any document" });
        return;
      }

      const room = rooms.get(nodeId);
      if (!room) return;

      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case 0: {
          const syncType = decoding.readVarUint(decoder);
          if (syncType === 0) {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 0);
            syncProtocol.writeSyncStep1(encoder, room.doc);
            send(ws, encoding.toUint8Array(encoder));

            const encoder2 = encoding.createEncoder();
            encoding.writeVarUint(encoder2, 0);
            syncProtocol.writeSyncStep2(encoder2, room.doc);
            send(ws, encoding.toUint8Array(encoder2));
          } else if (syncType === 1) {
            syncProtocol.readSyncStep2(decoder, room.doc, ws as any);
          } else if (syncType === 2) {
            const update = decoding.readVarUint8Array(decoder);
            Y.applyUpdate(room.doc, update, ws as any);
          }
          break;
        }
        case 1: {
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            ws as any
          );
          break;
        }
      }
    } catch (err) {
      console.error("[YJS] Parse error:", (err as Error).message);
    }
  });

  ws.on("close", () => {
    const entry = clientUserMap.get(ws);
    if (entry?.nodeId) {
      leaveRoom(ws, entry.nodeId);
    }
    clientUserMap.delete(ws);
    console.log(`[YJS] Disconnected: ${entry?.user.userId || "unknown"}`);
  });

  ws.on("error", () => {});
}

// ============================================================
// Control messages (JSON)
// ============================================================

function handleControlMessage(
  ws: WebSocket,
  user: UserInfo,
  msg: any,
  getNode: (id: string) => TreeNode | undefined,
  masterDoc: { getNode: (id: string) => TreeNode | undefined }
): void {
  switch (msg.type) {
    case "join": {
      const nodeId = msg.nodeId;
      if (!nodeId) {
        sendJson(ws, { type: "error", message: "Missing nodeId" });
        return;
      }

      const current = clientUserMap.get(ws);
      if (current?.nodeId) {
        leaveRoom(ws, current.nodeId);
      }

      const node = getNode(nodeId);
      if (!node) {
        sendJson(ws, { type: "error", message: "Document not found" });
        return;
      }

      if (!canAccessNode(user, node)) {
        sendJson(ws, { type: "error", message: "Access denied to this document" });
        return;
      }

      const room = getRoom(nodeId);
      room.clients.add(ws);

      const entry = clientUserMap.get(ws)!;
      entry.nodeId = nodeId;

      // Ensure Y.Doc has current content
      const ytext = room.doc.getText("content");
      const currentContent = ytext.toString();
      if (!currentContent && node.content) {
        room.doc.transact(() => {
          ytext.insert(0, node.content);
        });
      }

      // Send initial sync (includes full tree + content)
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, room.doc);
      send(ws, encoding.toUint8Array(encoder));

      sendJson(ws, { type: "joined", nodeId, title: node.title });
      console.log(`[YJS] ${user.userId} joined doc ${nodeId}`);
      break;
    }

    case "leave": {
      const entry = clientUserMap.get(ws);
      if (entry?.nodeId) {
        leaveRoom(ws, entry.nodeId);
        entry.nodeId = null;
      }
      break;
    }

    case "ping": {
      sendJson(ws, { type: "pong" });
      break;
    }
  }
}

function leaveRoom(ws: WebSocket, nodeId: string): void {
  const room = rooms.get(nodeId);
  if (room) {
    room.clients.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.awareness, [ws as any], "left");

    if (room.clients.size === 0) {
      saveRoom(room);
      syncRoomContentToMaster(room);
    }
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

export function shutdownYjsServer(): void {
  console.log("[YJS] Shutting down, saving all rooms...");
  for (const [nodeId, room] of rooms) {
    if (room.saveTimer) {
      clearInterval(room.saveTimer);
      room.saveTimer = null;
    }
    saveRoom(room);
    syncRoomContentToMaster(room);
    console.log(`[YJS] Saved room ${nodeId}`);
  }
  console.log("[YJS] All rooms saved. Shutdown complete.");
}

// ============================================================
// Content sync from REST operations to Yjs rooms
// ============================================================

export function syncContentToRoom(nodeId: string, content: string): void {
  const room = rooms.get(nodeId);
  if (room) {
    const ytext = room.doc.getText("content");
    room.doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, content);
    });
  }
}

/** Sync tree changes from MasterDoc to a specific room (called after REST operations) */
export function syncTreeToRoom(nodeId: string): void {
  const room = rooms.get(nodeId);
  if (!room) return;

  const master = getMasterDoc();
  const masterNodes = master.getAllNodes();
  const masterChildren = master.getAllChildren();

  room.doc.transact(() => {
    // Update nodes
    masterNodes.forEach((node, key) => {
      room.sharedNodes.set(key, { ...node });
    });
    // Update children
    masterChildren.forEach((children, key) => {
      room.sharedChildren.set(key, [...children]);
    });
    // Remove nodes that were deleted from master
    room.sharedNodes.forEach((_node, key) => {
      if (!masterNodes.has(key)) {
        room.sharedNodes.delete(key);
      }
    });
  });
}

/** Sync tree changes from MasterDoc to ALL active rooms */
export function syncTreeToAllRooms(): void {
  for (const [nodeId, room] of rooms) {
    if (room.clients.size > 0) {
      syncTreeToRoom(nodeId);
    }
  }
}

export function getRoomContent(nodeId: string): string | null {
  const room = rooms.get(nodeId);
  if (!room) return null;
  return room.doc.getText("content").toString();
}

export function getConnectedCount(): number {
  return clientUserMap.size;
}



