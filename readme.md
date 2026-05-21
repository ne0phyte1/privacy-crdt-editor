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
npm install
cd ..

# 运行全部测试（必须串行）
npx tsx --test --test-reporter spec --test-concurrency=1 test/module-test/*.test.ts

# 运行单个测试文件
npx tsx --test --test-reporter spec test/module-test/<文件名>.test.ts

# 生成可视化报告并在浏览器中查看
npx tsx test/module-test/run-tests.ts
npx serve test/module-test
# 浏览器打开 http://localhost:3000/test-dashboard.html
```
