#!/usr/bin/env node
/**
 * 边界检查：frontend/src 下除 bridge/ 外，任何文件不得 import Tauri API。
 * 这条规则在 eslint.config.js 里也有一份；这里是它的可执行版本，
 * 因为 lint 规则可能被 `eslint-disable` 绕过，而 npm script 不行。
 *
 * 用法：
 *   node scripts/check-bridge-boundary.mjs            正常检查
 *   node scripts/check-bridge-boundary.mjs --self-test 用故意违规的 fixture 验证检测真的生效
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath as toPath } from 'node:url';

const repoRoot = toPath(new URL('..', import.meta.url));
const ALLOWED_DIR = join(repoRoot, 'frontend', 'src', 'bridge');
const SELF_TEST_DIR = join(repoRoot, 'scripts', 'fixtures');
const TAURI_IMPORT = /(?:from\s*|import\s*\(\s*)['"]@tauri-apps\/[^'"]+['"]/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function scan(roots, allowedDir) {
  const violations = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.startsWith(allowedDir)) continue;
      const src = readFileSync(file, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        if (TAURI_IMPORT.test(line)) {
          violations.push(`${relative(repoRoot, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim()}`);
        }
      });
    }
  }
  return violations;
}

if (process.argv.includes('--self-test')) {
  const hits = scan([SELF_TEST_DIR], ALLOWED_DIR);
  if (hits.length === 1) {
    console.log('boundary self-test OK：故意违规的 fixture 被检出');
    process.exit(0);
  }
  console.error(`boundary self-test FAILED：期望命中 1 处，实际 ${hits.length} 处`);
  process.exit(1);
}

const violations = scan(
  [join(repoRoot, 'frontend', 'src'), join(repoRoot, 'frontend', 'preview-shell')],
  ALLOWED_DIR
);

if (violations.length) {
  console.error('发现越界 import（只允许 frontend/src/bridge/）：');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('boundary OK：Tauri API 仅出现在 bridge/');
