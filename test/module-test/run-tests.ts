/**
 * 测试运行器 — 执行全部模块测试并生成 JSON 报告
 *
 * 用法: npx tsx test/module-test/run-tests.ts
 * 输出: test/module-test/test-results.json
 */

import { exec } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const OUTPUT_FILE = resolve(__dirname, "test-results.json");

interface TestCase {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

interface Suite {
  name: string;
  file: string;
  tests: TestCase[];
  passed: number;
  failed: number;
  durationMs: number;
  error?: string; // 模块加载失败等
}

interface Report {
  generatedAt: string;
  summary: {
    files: number;
    suites: number;
    tests: number;
    passed: number;
    failed: number;
    durationMs: number;
  };
  suites: Suite[];
}

console.log("正在运行全部模块测试...\n");

const cmd = `npx tsx --test --test-reporter spec --test-concurrency=1 "test/module-test/*.test.ts"`;

exec(cmd, { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
  const report = parseSpecOutput(stdout + "\n" + stderr, error ? false : true);
  writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n报告已生成: ${OUTPUT_FILE}`);
  printSummary(report);
});

// -------- 解析 spec reporter 输出 --------

function parseSpecOutput(output: string, overallOk: boolean): Report {
  const suites: Suite[] = [];
  let currentSuite: Suite | null = null;
  let currentFile = "";

  const lines = output.split("\n");

  for (const line of lines) {
    // 匹配子测试文件头: Subtest: path/to/file.test.ts
    const fileMatch = line.match(/^# Subtest:\s*(.+\.test\.ts)/);
    if (fileMatch) {
      currentFile = fileMatch[1].replace(/\\/g, "/").split("/").pop() || fileMatch[1];
      continue;
    }

    // 匹配 suite 开始: ▶ Suite Name
    const suiteMatch = line.match(/^▶\s+(.+)/);
    if (suiteMatch) {
      if (currentSuite) {
        suites.push(currentSuite);
      }
      currentSuite = {
        name: suiteMatch[1].trim(),
        file: currentFile,
        tests: [],
        passed: 0,
        failed: 0,
        durationMs: 0,
      };
      continue;
    }

    // 匹配 suite 结束: ✔ Suite Name (Xms) 或 ✖ Suite Name (Xms)
    const suiteEndMatch = line.match(/^[✔✖]\s+(.+?)\s+\(([\d.]+)ms\)/);
    if (suiteEndMatch && currentSuite) {
      currentSuite.durationMs = parseFloat(suiteEndMatch[2]);
      continue;
    }

    // 匹配测试通过: ✔ Test Name (Xms)
    const passMatch = line.match(/^\s+✔\s+(.+?)\s+\(([\d.]+)ms\)/);
    if (passMatch && currentSuite) {
      currentSuite.tests.push({
        name: passMatch[1].trim(),
        passed: true,
        durationMs: parseFloat(passMatch[2]),
      });
      currentSuite.passed++;
      continue;
    }

    // 匹配测试失败: ✖ Test Name (Xms)
    const failMatch = line.match(/^\s+✖\s+(.+?)\s+\(([\d.]+)ms\)/);
    if (failMatch && currentSuite) {
      currentSuite.tests.push({
        name: failMatch[1].trim(),
        passed: false,
        durationMs: parseFloat(failMatch[2]),
      });
      currentSuite.failed++;
      continue;
    }

    // 匹配错误信息
    if (line.includes("AssertionError") && currentSuite) {
      const lastTest = currentSuite.tests[currentSuite.tests.length - 1];
      if (lastTest && !lastTest.passed) {
        lastTest.error = (lastTest.error || "") + line.trim() + "\n";
      }
    }

    // 子测试失败（模块加载失败等）
    const subFail = line.match(/^not ok \d+ - (.+)/);
    if (subFail && currentFile && !currentSuite) {
      currentSuite = {
        name: "模块加载",
        file: currentFile,
        tests: [],
        passed: 0,
        failed: 1,
        durationMs: 0,
        error: "模块加载失败（检查 npm install 是否已执行）",
      };
    }

    // 统计行: ℹ tests N
    const statsMatch = line.match(/^ℹ\s+(\w+)\s+(\d+)/);
    if (statsMatch) {
      // 收集统计信息，稍后汇总
    }
  }

  // 保存最后一个 suite
  if (currentSuite) {
    suites.push(currentSuite);
  }

  // 提取总体统计
  const testsMatch = output.match(/ℹ tests (\d+)/);
  const passMatch2 = output.match(/ℹ pass (\d+)/);
  const failMatch2 = output.match(/ℹ fail (\d+)/);
  const durMatch = output.match(/ℹ duration_ms ([\d.]+)/);

  // 按文件分组计算 suites 数
  const suiteCount = suites.length;
  const fileCount = new Set(suites.map((s) => s.file)).size;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      files: fileCount || suites.length,
      suites: suiteCount,
      tests: testsMatch ? parseInt(testsMatch[1]) : suites.reduce((s, suite) => s + suite.tests.length, 0),
      passed: passMatch2 ? parseInt(passMatch2[1]) : suites.reduce((s, suite) => s + suite.passed, 0),
      failed: failMatch2 ? parseInt(failMatch2[1]) : suites.reduce((s, suite) => s + suite.failed, 0),
      durationMs: durMatch ? parseFloat(durMatch[1]) : 0,
    },
    suites,
  };
}

function printSummary(report: Report) {
  const s = report.summary;
  console.log(`\n${"=".repeat(50)}`);
  console.log(` 文件: ${s.files}  |  套件: ${s.suites}  |  用例: ${s.tests}`);
  console.log(` 通过: ${s.passed}  |  失败: ${s.failed}  |  耗时: ${s.durationMs.toFixed(0)}ms`);
  console.log(`${"=".repeat(50)}`);
  if (s.failed === 0) {
    console.log(" ✅ 全部通过");
  } else {
    console.log(` ❌ ${s.failed} 条失败`);
  }
}
