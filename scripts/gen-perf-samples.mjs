#!/usr/bin/env node
/**
 * 生成 P13 的三档性能样本（200KB / 2MB / 8MB）。
 *
 * 样本是「构造出来的」而不是随手找一篇大文档：每段都包含标题、段落、
 * 列表、表格、代码块、引用与公式，这样测到的耗时能反映各类块的分布差异。
 * 产物不入库（见 .gitignore），随时可重新生成。
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'perf');
const targets = [
  { file: 'small-200kb.md', bytes: 200 * 1024 },
  { file: 'medium-2mb.md', bytes: 2 * 1024 * 1024 },
  { file: 'large-8mb.md', bytes: 8 * 1024 * 1024 },
];

const topics = [
  '渲染管线的分层边界',
  '块级增量的 key 设计',
  '插件能力分级的判定',
  '沙箱预览的隔离强度',
  '大文件降级策略',
  '分片渲染与滚动位置',
  'Worker 与主线程的分工',
  '导出链路的一致性',
];

function section(i) {
  const topic = topics[i % topics.length];
  return `
## ${i + 1}. ${topic}

这一段用来压测**行内语法**与段落折行：普通文本里混入 *强调*、**加粗**、\`行内代码\`、
[外链](https://example.com/${i})、脚注式引用以及 $E = mc^2$ 这样的行内公式。
段落长度刻意保持在三到五行，避免单块过大掩盖块切分的开销。

- 列表项 ${i}.1：用来验证列表不会被切碎成多个块
- 列表项 ${i}.2：嵌套内容

  - 嵌套项 ${i}.2.1
  - 嵌套项 ${i}.2.2

- 列表项 ${i}.3

| 指标 | 第 ${i} 轮 | 说明 |
|---|---:|---|
| 块数 | ${120 + i} | 顶层 token 切分后 |
| 耗时 | ${8 + (i % 7)}ms | Worker 内解析 |
| 命中插件 | ${1 + (i % 3)} | 围栏与容器 |

\`\`\`ts
// 第 ${i} 段：代码块用来压测围栏渲染与插件 codebar
export function block${i}(source: string): string {
  return source.replace(/\\r\\n/g, '\\n').trim();
}
\`\`\`

> 引用块第 ${i} 段：验证引用不会被拆成多块，也验证引用内的插件容器仍能命中。

::: tip 提示 ${i}
容器语法压测：每次渲染都要走一遍插件的 onContainer 分支。
:::
`;
}

const filler = (i) => section(i) + section(i + 1);

for (const t of targets) {
  const path = join(outDir, t.file);
  mkdirSync(outDir, { recursive: true });
  let out = `# 性能样本 · ${t.file}\n\n> 由 scripts/gen-perf-samples.mjs 生成，请勿手工编辑。\n`;
  let i = 0;
  while (Buffer.byteLength(out) < t.bytes) {
    out += filler(i);
    i += 2;
  }
  writeFileSync(path, out, 'utf8');
  const size = statSync(path).size;
  console.log(
    `${relative(process.cwd(), path).padEnd(38)} ${(size / 1024).toFixed(0).padStart(6)} KB  ${i} 段`
  );
}
