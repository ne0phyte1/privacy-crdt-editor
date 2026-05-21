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

测试
--

单元测试位于 `test/module-test/`，详见 [test/module-test/README.md](https://github.com/ne0phyte1/privacy-crdt-editor/blob/module_test/test2_and_test3/test/module-test/README.md)。

```shell
npx tsx --test --test-reporter spec --test-concurrency=1 test/module-test/*.test.ts    # 运行全部测试文件
npx tsx --test --test-reporter spec test/module-test/<文件名>.test.ts    # 运行单个测试文件
```


