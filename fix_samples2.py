import pathlib

# ============================================================
# 1. Fix sample data titles in masterDoc.ts
# ============================================================
p = pathlib.Path(r"E:\privacy-crdt-editor\backend\src\crdt\masterDoc.ts")
text = p.read_text("utf-8")

# Rename root
text = text.replace('title: "项目文档中心",', 'title: "全域公告",')
text = text.replace('content: "这是隐私协同编辑器的文档根节点，所有文档都从这里开始组织。"', 'content: "这是项目全域公告的根节点。管理员可在此创建各级子节点。"')

# Rename L1 nodes
text = text.replace('"公司全员公告",', '"全域公告示例",')
text = text.replace('"全员项目看板",', '"全域公告-项目看板",')

# Rename L2 nodes
text = text.replace('"GroupA 组内公告",', '"GroupA-组内公告",')
text = text.replace('"GroupB 组内公告",', '"GroupB-组内公告",')

# Rename L3 nodes
text = text.replace('"GroupA 需求文档",', '"GroupA-组间文档",')
text = text.replace('"GroupB 技术方案",', '"GroupB-组间文档",')

p.write_text(text, "utf-8")
print("masterDoc: sample data titles updated")

# Verify
titles = []
for line in text.split("\n"):
    if 'title: "' in line and 'title: string' not in line and 'fields.title' not in line and 'tree.title' not in line:
        titles.append(line.strip())
print("\nSample node titles:")
for t in titles:
    print(" ", t)
