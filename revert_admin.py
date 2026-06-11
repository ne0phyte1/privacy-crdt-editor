import pathlib

p = pathlib.Path(r"E:\privacy-crdt-editor\backend\src\privacy\accessControl.ts")
text = p.read_text("utf-8")

# Find the current (modified) canCreateUnder and replace with the correct version
# The correct version: Admin respects NBAC level rules but has full RBAC access
old_start = "export function canCreateUnder("
old_idx = text.find(old_start)
next_export = text.find("\nexport function", old_idx + 1)
if next_export < 0:
    next_export = len(text)

current_func = text[old_idx:next_export]
print("Current canCreateUnder length:", len(current_func))

correct_func = """export function canCreateUnder(
  user: UserInfo,
  parentNode: TreeNode,
  requestedLevel: 1 | 2 | 3,
  requestedTarget?: string
): { allowed: boolean; level: 1 | 2 | 3; target: string; message: string } {
  // Admin has full RBAC privileges but still respects NBAC level rules
  // (NBAC level restrictions apply to everyone including admin)

  // Guest cannot create any nodes
  if (user.role === "guest") {
    return { allowed: false, level: requestedLevel, target: "", message: "Guest cannot create nodes" };
  }

  // Must have write permission on the parent node
  if (!canEditNode(user, parentNode)) {
    return { allowed: false, level: requestedLevel, target: "", message: `No permission to add children under "${parentNode.title}"` };
  }

  // NBAC: enforce level creation rules (applies to all roles including admin)
  // Under L1 parent: can create L1, L2, L3
  // Under L2 parent: can create L2, L3 only (no L1)
  // Under L3 parent: can create L3 only (no L1, no L2)
  if (parentNode.level === 2 && requestedLevel === 1) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: cannot create level 1 under level 2 parent (only level 2 or 3 allowed under group announcements)` };
  }
  if (parentNode.level === 3 && requestedLevel !== 3) {
    return { allowed: false, level: requestedLevel, target: "", message: `NBAC violation: cannot create level ${requestedLevel} under level 3 parent (only level 3 allowed under group documents)` };
  }

  // RBAC: non-admin cannot create level 1 nodes
  if (requestedLevel === 1 && user.role !== "admin") {
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
    return { allowed: false, level: requestedLevel, target: "", message: "NBAC error resolving target attribute" };
  }

  return { allowed: true, level: resolved.level, target: resolved.target, message: "OK" };
}"""

text = text[:old_idx] + correct_func + text[next_export:]
p.write_text(text, "utf-8")
print("canCreateUnder: reverted to correct version (Admin respects NBAC + has full RBAC)")
