#!/usr/bin/env node
/**
 * P13 性能验收脚本：真机跑一遍三档样本，量「推进渲染管线 → 首屏完成」的时间。
 *
 * 做法：用环境变量把「验收清单」交给应用，应用启动后自己用真实预览管线跑完三档，
 * 把结果写回文件并退出。这里只负责递清单、等文件、打印表格。
 *
 * 为什么不用远程调试端口（CDP）：wry 建 WebView2 环境时总会以编程方式设置
 * AdditionalBrowserArguments，WebView2 因此忽略 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS，
 * 调试端口时有时无（实测同一份二进制前后两次启动行为不一致）。另外，为了跑测试
 * 在发布版里固定开一个调试端口也不该做。
 *
 * 用法：
 *   node scripts/gen-perf-samples.mjs      # 首次或想换样本时
 *   node scripts/perf-check.mjs [exe路径]
 *
 * 注意：单实例保护生效时不能重复启动，跑之前请先关掉正在运行的 GoldenEdit。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const exe = process.argv[2] ?? join(root, 'src-tauri', 'target', 'release', 'goldenedit.exe');
const fixtures = join(here, 'fixtures', 'perf');

/** 验收阈值（毫秒，墙钟）：按 ARCHITECTURE §13 的四档策略给 */
const samples = [
  { file: 'small-200kb.md', budget: 900 },
  { file: 'medium-2mb.md', budget: 1600 },
  { file: 'large-8mb.md', budget: 2000 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 调试用：只跑某一档（PERF_ONLY=large），用来判断前一档有没有干扰 */
const only = process.env.PERF_ONLY;
const picked = only ? samples.filter((s) => s.file.includes(only)) : samples;

const TIMEOUT = 180_000;

/**
 * 一档一个进程。
 * 同一个进程里连跑三档时，上一档的懒填充（2MB 有 1.3 万个块）会拖住下一档的首屏，
 * 实测 8MB 被多算了 9 秒。验收要的是「打开这么大的文件要多久」，每档从干净进程量才对。
 */
async function runOne(sample) {
  const manifest = join(fixtures, `manifest-${sample.file}.json`);
  const out = join(mkdtempSync(join(tmpdir(), 'ge-perf-')), 'rows.json');
  writeFileSync(manifest, JSON.stringify([{ file: sample.file, budget: sample.budget }]));

  const child = spawn(exe, [], {
    cwd: dirname(exe),
    stdio: 'ignore',
    env: { ...process.env, GE_PERF_MANIFEST: manifest, GE_PERF_OUT: out },
  });

  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  try {
    const deadline = Date.now() + TIMEOUT;
    while (!existsSync(out)) {
      if (Date.now() > deadline) {
        throw new Error(
          `${sample.file} 等结果超时：应用可能没启动，或被单实例保护转交出去（请先关掉 GoldenEdit）`
        );
      }
      if (exited) {
        // 进程退了还没写出结果，说明中途失败；给文件一点落盘时间再判
        await sleep(600);
        if (!existsSync(out)) throw new Error('应用提前退出，没有写出结果文件（看应用内日志）');
        break;
      }
      await sleep(200);
    }
    // 应用写完才调 exit，读文件可能撞上半写状态，稍等再读
    await sleep(300);
    const payload = JSON.parse(readFileSync(out, 'utf8'));
    if (payload.error) {
      console.error(`应用内验收中断（${sample.file}）：${payload.error}`);
      if (payload.diag) console.error(`现场：${JSON.stringify(payload.diag)}`);
    }
    return payload.rows ?? [];
  } finally {
    if (!exited && child.pid) {
      // Windows 上 child.kill() 未必能收掉 WebView2 那条进程链，残留会导致下次
      // 启动被单实例保护转交出去，所以按进程树杀
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
      } catch {
        child.kill();
      }
      await sleep(600);
    }
  }
}

async function main() {
  if (!existsSync(exe)) {
    console.error(`找不到可执行文件：${exe}\n先执行 npm run build 与 npx tauri build --no-bundle`);
    process.exit(2);
  }
  for (const s of picked) {
    if (!existsSync(join(fixtures, s.file))) {
      console.error(`缺少样本 ${join(fixtures, s.file)}\n先执行 node scripts/gen-perf-samples.mjs`);
      process.exit(2);
    }
  }

  const rows = [];
  for (const sample of picked) {
    rows.push(...(await runOne(sample)));
  }
  report(rows);
}

function report(rows) {
  if (!rows.length) {
    console.error('没有拿到任何验收结果');
    process.exitCode = 1;
    return;
  }
  for (const row of rows) {
    const truncated = row.chars !== row.rendered;
    const mark = truncated ? 'MISMATCH' : row.wallMs <= row.budget ? 'PASS' : 'FAIL';
    console.log(
      `${row.name.padEnd(16)} ${String(row.kb).padStart(6)} KB  ` +
        `字符 ${row.chars}→${row.submitted}→${row.rendered}  ` +
        `${String(row.blocks).padStart(5)} 块  内核 ${String(row.kernelMs).padStart(5)}ms ` +
        `(解析 ${String(row.parseMs).padStart(4)} + 块 ${String(row.loopMs).padStart(4)})  ` +
        `墙钟 ${String(row.wallMs).padStart(5)}ms  预算 ${row.budget}ms  ${mark}`
    );
    // 未归因 = 墙钟减去所有已计时段，剩下的就是「消息在两岸之间排队」的时间
    const attributed = row.debounceMs + row.postMs + row.xferMs + row.domMs + row.cbMs;
    console.log(
      `${''.padEnd(16)} 分段：防抖 ${row.debounceMs} + 投递 ${row.postMs} + 传输 ${row.xferMs} ` +
        `+ 建 DOM ${row.domMs} + 回调 ${row.cbMs} = ${attributed}ms，未归因 ${row.wallMs - attributed}ms`
    );
    if (row.name.includes('large') && row.rules && Object.keys(row.rules).length) {
      const top = Object.entries(row.rules)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k}=${v}ms`)
        .join('  ');
      console.log(`  规则耗时：${top}`);
    }
  }

  const truncated = rows.filter((r) => r.chars !== r.rendered);
  const failed = rows.filter((r) => r.wallMs > r.budget);
  if (truncated.length) {
    console.error(
      `\n${truncated.length} 档的文本在投递过程中被截断：${truncated
        .map((r) => `${r.name} ${r.chars}→${r.submitted}→${r.rendered}`)
        .join(', ')}`
    );
    process.exitCode = 1;
  } else if (failed.length) {
    console.error(`\n${failed.length} 档超出预算：${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${rows.length} 档全部在预算内。`);
  }}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
