# privacy-crdt-editor
一个基于 CRDT 算法的隐私协同编辑器

## 功能
- 多人实时协同编辑
- 本地优先架构
- 隐私数据本地加密

## 使用方法
```bash
cd backend
npm install
npm run dev
cd frontend
npm install
npm run dev
```

## 测试
单元测试位于 `test/module-test/`，详见 [test/module-test/README.md](test/module-test/README.md)。

```bash
cd backend
npm test
```