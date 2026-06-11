import pathlib, re

p = pathlib.Path(r"E:\privacy-crdt-editor\backend\src\privacy\accessControl.ts")
text = p.read_text("utf-8")

# Fix canCreateUnder: admin bypasses NBAC level restrictions
old_func_start = """export function canCreateUnder(
  user: UserInfo,
  parentNode: TreeNode,
  requestedLevel: 1 | 2 | 3,
  requestedTarget?: string
): { allowed: boolean; level: 1 | 2 | 3; target: string; message: string } {
  // Special: root parent - admin can always create
  if (parentNode.id === "root") {
    // For root, resolve NBAC child rules
    const resolved = resolveNBACChild(user, parentNode, requestedLevel, requestedTarget);
    if (!resolved) {
      return { allowed: false, level: requestedLevel, target: "", message: `NBAC rules prohibit creating level ${requestedLevel} under root` };
    }
    
    // RBAC: Who can create under root?
    if (user.role === "admin") {
      return { allowed: true, level: resolved.level, target: resolved.target, message: "Admin can create" };
    }
    if (user.role === "guest") {
      return { allowed: false, level: requestedLevel, target: "", message: "Guest cannot create nodes" };
    }
    // Leader or Member creating: check based on requested level
    if (requestedLevel === 1) {
      return { allowed: false, level: requestedLevel, target: "", message: "Non-admin cannot create level 1 nodes" };
    }
    if (user.role === "leader" && (requestedLevel === 2 || requestedLevel === 3)) {
      return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
    }
    if (user.role === "member" && requestedLevel === 3) {
      return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
    }
    return { allowed: false, level: requestedLevel, target: "", message: `Role ${user.role} cannot create level ${requestedLevel}` };
  }

  // Must have edit permission on the parent
  if (!canEditNode(user, parentNode)) {
    return { allowed: false, level: requestedLevel, target: "", message: `User ${user.userId} has no permission to add children under "${parentNode.title}"` };
  }

  // NBAC: resolve child level + target
  const resolved = resolveNBACChild(user, parentNode, requestedLevel, requestedTarget);
  if (!resolved) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC rules prohibit creating level ${requestedLevel} under level ${parentNode.level} parent` };
  }

  // RBAC: check if user can create nodes of this level
  if (user.role === "leader") {
    if (requestedLevel !== 2 && requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "Leader can only create level 2 or 3 nodes" };
    }
  }
  if (user.role === "member") {
    if (requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "Member can only create level 3 nodes" };
    }
  }

  return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
}"""

new_func = """export function canCreateUnder(
  user: UserInfo,
  parentNode: TreeNode,
  requestedLevel: 1 | 2 | 3,
  requestedTarget?: string
): { allowed: boolean; level: 1 | 2 | 3; target: string; message: string } {
  // Admin has full privileges: bypass all NBAC level restrictions
  if (user.role === "admin") {
    // Still resolve target inheritance for consistency
    let resolvedTarget: string;
    if (parentNode.level === 1 && parentNode.target === "all") {
      resolvedTarget = requestedTarget || "all";
    } else {
      resolvedTarget = parentNode.target;
    }
    return { allowed: true, level: requestedLevel, target: resolvedTarget, message: "Admin full access" };
  }

  // Guest cannot create any nodes
  if (user.role === "guest") {
    return { allowed: false, level: requestedLevel, target: "", message: "Guest cannot create nodes" };
  }

  // Must have write permission on the parent node
  if (!canEditNode(user, parentNode)) {
    return { allowed: false, level: requestedLevel, target: "", message: `No permission to add children under "${parentNode.title}"` };
  }

  // NBAC: enforce level creation rules for non-admin users
  // L1 parent -> can create L1, L2, L3  (but non-admin cannot create L1)
  // L2 parent -> can create L2, L3 only
  // L3 parent -> can create L3 only
  if (parentNode.level === 2 && requestedLevel === 1) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: cannot create level 1 (global announcement) under level 2 (group announcement) parent` };
  }
  if (parentNode.level === 3 && requestedLevel !== 3) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: level 3 parent can only have level 3 children, cannot create level ${requestedLevel}` };
  }

  // Non-admin cannot create level 1 nodes (global announcements)
  if (requestedLevel === 1) {
    return { allowed: false, level: requestedLevel, target: "", message: "Only admin can create level 1 (global announcement) nodes" };
  }

  // RBAC: check if user can create nodes of this level
  if (user.role === "leader") {
    if (requestedLevel !== 2 && requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "Leader can only create level 2 or 3 nodes" };
    }
  }
  if (user.role === "member") {
    if (requestedLevel !== 3) {
      return { allowed: false, level: requestedLevel, target: "", message: "Member can only create level 3 nodes" };
    }
  }

  // NBAC: resolve target attribute inheritance
  const resolved = resolveNBACChild(user, parentNode, requestedLevel, requestedTarget);
  if (!resolved) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC error resolving target attribute` };
  }

  return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
}"""

if old_func_start in text:
    text = text.replace(old_func_start, new_func)
    p.write_text(text, "utf-8")
    print("canCreateUnder: Admin now bypasses NBAC level restrictions")
else:
    print("Pattern not found! Checking...")
    idx = text.find("export function canCreateUnder")
    if idx >= 0:
        print("  Found at", idx)
        print("  ", repr(text[idx:idx+100]))
