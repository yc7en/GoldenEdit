/**
 * L3 预览外壳入口。
 * 只做三件事：与宿主握手、装配管线、把事件回传。渲染逻辑全部在 pipeline / worker。
 */
import './plugins.css';

import type { Block } from './blocks';
import { RuntimeRegistry } from './context';
import { Pipeline, type RenderMode } from './pipeline';
import {
  PROTOCOL_VERSION,
  type HostMessage,
  type PreviewMessage,
  type PluginSpec,
  type RenderOptions,
  type ThemePayload,
} from './protocol';

/** 沙箱 iframe 的 origin 是 opaque，不能用 location.origin，只能按路径推导 */
const baseUrl = new URL('./', location.href).href;

/**
 * 安全说明（实测 2026-10-28，Tauri 2.12 / WebView2）：
 * WebView2 的初始化脚本会把 `__TAURI_INTERNALS__` 注入到所有子框架，且属性
 * writable/configurable 均为 false，无法删除或覆写。但子框架发出的 invoke 不会被
 * Rust 侧处理（消息永不 resolve，也不产生副作用，已用 set_ui_state 探针验证），
 * 因此第三方插件拿不到 command 能力。升级 Tauri 后必须重跑该探针（ARCHITECTURE §12.2）。
 */
if (typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined') {
  console.warn('[ge] Tauri IPC 桥在预览框架内可见（已实测不可调用，见 ARCHITECTURE §12.2）');
}

const send = (msg: PreviewMessage) => {
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    /* 父窗口已卸载 */
  }
};

function applyTheme(theme: ThemePayload): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;
  applyCustomCss(theme.customCss ?? '');
}

/** 用户自定义预览 CSS：单独一个 <style>，清空即移除（§7.3） */
function applyCustomCss(css: string): void {
  let el = document.getElementById('ge-custom-css') as HTMLStyleElement | null;
  if (!css.trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'ge-custom-css';
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function injectStyle(id: string, url: string): void {
  if (document.querySelector(`link[data-ge-plugin="${id}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.gePlugin = id;
  document.head.appendChild(link);
}

const root = document.getElementById('ge-root') ?? document.body;
const pipeline = new Pipeline(root, {
  onJump: (line) => send({ type: 'jump', line }),
  onOpenExternal: (url) => send({ type: 'open-external', url }),
  onLog: (level, message) => send({ type: 'log', level, message }),
});

let worker: Worker | null = null;
let inited = false;
/**
 * 渲染代际号必须由宿主发号、外壳原样带回。
 * 早先两侧各自 `gen += 1`，主题重渲染只让外壳加号，两边立刻错位——宿主那边的
 * 「等这次渲染完成」就永远等不到（表现为预览卡在渲染中，探针一律超时）。
 */
let gen = 0;
/** 宿主最近一次发来的号：主题变更、重挂这类由外壳自己发起的渲染复用它，不加号 */
let lastGen = 0;
let lastText: string | null = null;
let mainRegistry: RuntimeRegistry | null = null;
let options: RenderOptions = { paused: false, fullRenderLimit: 200 * 1024, shardLimit: 2 * 1024 * 1024 };
let themeMode: 'light' | 'dark' = 'light';
/** 按需渲染的请求号：Worker 回包按 id 对应 */
let expandSeq = 0;
/** 收到 doc 的时刻，用来把「传输 + 解析」与「建 DOM」分开计时（§13.1） */
let tDoc = 0;
const pendingExpand = new Map<number, (blocks: { key: string; html: string; plugins: string[] }[]) => void>();

function modeFor(text: string): RenderMode {
  const size = text.length;
  if (size <= options.fullRenderLimit) return 'full';
  if (size <= options.shardLimit) return 'shard';
  return 'viewport';
}

function startWorker(specs: PluginSpec[], doc: HostMessage & { type: 'init' }): void {
  worker?.terminate();
  worker = new Worker(new URL('./worker/parse.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as
      | { type: 'ready' }
      | {
          type: 'result';
          gen: number;
          ms: number;
          chars: number;
          parseMs: number;
          loopMs: number;
          rules: Record<string, number>;
          blocks: Block[];
          outline: never[];
          errors: never[];
          plugins: string[];
        }
      | { type: 'expanded'; id: number; blocks: { key: string; html: string; plugins: string[] }[] }
      | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
      | { type: 'fatal'; message: string };
    if (msg.type === 'log') {
      send({ type: 'log', level: msg.level, message: msg.message });
      return;
    }
    if (msg.type === 'fatal') {
      send({ type: 'fatal', message: msg.message });
      return;
    }
    if (msg.type === 'ready') {
      inited = true;
      if (lastText !== null) requestRender(lastText);
      return;
    }
    if (msg.type === 'expanded') {
      const resolve = pendingExpand.get(msg.id);
      pendingExpand.delete(msg.id);
      resolve?.(msg.blocks);
      return;
    }
    if (msg.type === 'result') {
      if (msg.gen < gen) return; // 代际取消：过期批次直接丢弃
      void onResult(msg);
    }
  };
  worker.onerror = (e) => {
    send({ type: 'fatal', message: `解析 Worker 异常：${e.message}` });
  };
  worker.postMessage({
    type: 'init',
    specs,
    doc: doc.doc,
    theme: doc.theme,
    baseUrl,
  });
}

async function onResult(msg: {
  gen: number;
  ms: number;
  chars: number;
  parseMs: number;
  loopMs: number;
  rules: Record<string, number>;
  blocks: Block[];
  outline: { level: number; text: string; line: number }[];
  errors: { plugin?: string; line: number; message: string }[];
  plugins: string[];
}): Promise<void> {
  const mode = modeFor(lastText ?? '');
  const tDom = performance.now();
  const { mounted } = await pipeline.render(msg.blocks, mode);
  const domMs = Math.round(performance.now() - tDom);
  send({ type: 'outline', items: msg.outline });
  send({
    type: 'rendered',
    gen: msg.gen,
    ms: Math.round(msg.ms),
    submitted: (lastText ?? '').length,
    chars: msg.chars,
    parseMs: msg.parseMs,
    loopMs: msg.loopMs,
    rules: msg.rules,
    xferMs: Math.round(tDom - tDoc),
    domMs,
    blocks: msg.blocks.length,
    plugins: msg.plugins,
    errors: msg.errors,
  });
  if (mounted) {
    document.documentElement.dataset.mounted = '1';
  }
}

function requestRender(text: string, hostGen?: number): void {
  lastText = text;
  if (hostGen !== undefined) lastGen = hostGen;
  gen = lastGen;
  tDoc = performance.now();
  if (!worker) return;
  worker.postMessage({ type: 'doc', gen, text, mode: modeFor(text) });
}

/** 视口补齐：把请求转给 Worker，等回包（同一批 key 合并成一次请求） */
function requestBlocks(keys: string[]): Promise<{ key: string; html: string; plugins: string[] }[]> {
  if (!worker) return Promise.resolve([]);
  return new Promise((resolve) => {
    const id = ++expandSeq;
    pendingExpand.set(id, resolve);
    worker!.postMessage({ type: 'expand', id, keys });
    window.setTimeout(() => {
      if (pendingExpand.delete(id)) resolve([]);
    }, 10_000);
  });
}

async function init(msg: Extract<HostMessage, { type: 'init' }>): Promise<void> {
  options = msg.options ?? options;
  themeMode = msg.theme.mode;
  applyTheme(msg.theme);

  for (const spec of msg.plugins) {
    if (spec.styleUrl) injectStyle(spec.id, spec.styleUrl);
  }

  mainRegistry = new RuntimeRegistry('main', baseUrl, {
    log: (level, pluginId, message) => send({ type: 'log', level, message: `[${pluginId}] ${message}` }),
    loadFail: (pluginId, message) =>
      send({ type: 'log', level: 'error', message: `[${pluginId}] 主线程加载失败：${message}` }),
  });
  await mainRegistry.loadAll(msg.plugins, msg.doc, msg.theme, { utils: {} });
  pipeline.attachRegistry(mainRegistry);

  pipeline.setBlockLoader(requestBlocks);
  startWorker(msg.plugins, msg);
  if (lastText !== null) requestRender(lastText);
}

function buildExportHtml(title: string): string {
  let css = '';
  for (let i = 0; i < document.styleSheets.length; i++) {
    try {
      const sheet = document.styleSheets[i];
      const rules = sheet.cssRules;
      for (let j = 0; j < rules.length; j++) {
        css += rules[j].cssText + '\n';
      }
    } catch {
      // 跨域或安全受限样式表忽略
    }
  }

  const rootEl = document.documentElement;
  const mode = rootEl.dataset.mode || 'light';
  const customProps: string[] = [];
  for (let i = 0; i < rootEl.style.length; i++) {
    const prop = rootEl.style[i];
    if (prop.startsWith('--ge-')) {
      customProps.push(`${prop}: ${rootEl.style.getPropertyValue(prop)};`);
    }
  }

  const content = document.getElementById('ge-root')?.innerHTML ?? '';

  return `<!DOCTYPE html>
<html lang="zh-CN" data-mode="${mode}" style="${customProps.join(' ')}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${css}
  body {
    margin: 0;
    padding: 32px;
    background: var(--ge-bg, #ffffff);
    color: var(--ge-fg, #1a1a1a);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 980px;
    margin-left: auto;
    margin-right: auto;
  }
  .ge-line { display: none !important; }
  @media print {
    body { padding: 0; max-width: 100%; }
    @page { margin: 15mm; size: A4; }
  }
  </style>
</head>
<body>
  <div class="ge-preview">
    ${content}
  </div>
</body>
</html>`;
}

window.addEventListener('message', (ev: MessageEvent<HostMessage>) => {
  if (ev.source !== window.parent) return;
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'init':
      void init(msg);
      break;
    case 'doc':
      if (!inited) {
        // 握手前到的文档：连代际号一起记下来，否则唤醒后回代的号对不上
        lastText = msg.text;
        lastGen = msg.gen;
        return;
      }
      requestRender(msg.text, msg.gen);
      break;
    case 'doc-meta':
      mainRegistry?.setDoc(msg.doc);
      break;
    case 'theme':
      themeMode = msg.theme.mode;
      applyTheme(msg.theme);
      mainRegistry?.setTheme(msg.theme);
      if (lastText !== null) requestRender(lastText);
      break;
    case 'width':
      pipeline.setWidth(msg.width);
      break;
    case 'remount':
      if (lastText !== null) requestRender(lastText);
      break;
    case 'export':
      pipeline.expandAll();
      window.setTimeout(() => {
        const title = msg.title || 'GoldenEdit Export';
        const html = buildExportHtml(title);
        send({ type: 'exported', id: msg.id, html });
      }, 60);
      break;
    case 'print':
      // 打印前先等一帧，确保懒加载块已展开（pipeline 在 mode=viewport 时会延迟渲染）
      pipeline.expandAll();
      window.setTimeout(() => window.print(), 60);
      break;
    default:
      break;
  }
});

// 让宿主知道可以发 init 了
send({ type: 'ready', protocol: PROTOCOL_VERSION });
document.documentElement.dataset.themeMode = themeMode;
