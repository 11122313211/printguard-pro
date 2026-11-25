#!/usr/bin/env node
/**
 * PrintGuard Pro 一键自动化单元测试运行器
 * 顺序执行核心算法模块与本地存储层的内置 Node 自测，并输出汇总报告。
 * 用法：node scripts/run-tests.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const suites = [
  { name: '条码引擎与 BWR 补偿', file: 'modules/module_barcode_bwr.js' },
  { name: 'DXF 刀模解析与图层分类', file: 'modules/module_dxf_parser.js' },
  { name: '色彩科学与 CIEDE2000', file: 'modules/module_ciede2000.js' },
  { name: '参数化盒型与 3D 动力学', file: 'modules/module_new_boxes.js' },
  { name: 'CIP3 墨区与耗墨估算', file: 'modules/module_ink_estimator.js' },
  { name: '任意刀线通用 3D 折叠引擎', file: 'modules/module_dxf_folder.js' },
  { name: '预检人话解释与分级门禁', file: 'modules/module_preflight_explainer.js' },
  { name: 'Color Workshop 工艺护照桥接', file: 'modules/module_workshop_bridge.js' },
  { name: 'CIP3 损耗预测与 EMA 学习', file: 'modules/module_waste_predictor.js' },
  { name: '本地持久化与工程文件往返', file: 'js/app-store.js' }
];

console.log('============================================================');
console.log('  PrintGuard Pro 自动化单元测试套件');
console.log('============================================================');

let passed = 0;
let failed = 0;

for (const suite of suites) {
  const fullPath = path.join(rootDir, suite.file);
  const start = Date.now();
  const res = spawnSync(process.execPath, [fullPath], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30000
  });
  const costMs = Date.now() - start;
  const ok = res.status === 0 && !res.error;
  if (ok) {
    passed++;
    console.log(`  [PASS] ${suite.name} (${suite.file}) - ${costMs}ms`);
  } else {
    failed++;
    console.error(`  [FAIL] ${suite.name} (${suite.file}) - exit=${res.status}`);
    if (res.stdout) console.error(res.stdout.trim());
    if (res.stderr) console.error(res.stderr.trim());
    if (res.error) console.error(res.error);
  }
}

console.log('------------------------------------------------------------');
console.log(`总计：${suites.length} 组套件 | 通过：${passed} | 失败：${failed}`);
console.log('============================================================');

process.exit(failed > 0 ? 1 : 0);
