/// <reference lib="webworker" />
/**
 * 解析 Worker（ARCHITECTURE §6.2 第 4 层）。
 * 这里只做纯文本工作：markdown-it 解析、L1 插件渲染、块切分与 key 计算。
 * 没有 DOM，也不能有——L2 插件在 Worker 阶段只产出占位容器。
 */
import MarkdownIt from 'markdown-it';

import {
  blockKey,
  blockLine,
  blockSource,
  splitBlocks,
  stripForbiddenAttrs,
  stripScripts,
  type MdToken,
} from '../blocks';
import { RuntimeRegistry, type PluginRuntime } from '../context';
import type { DocMeta, OutlineItem, PluginSpec, RenderError, ThemePayload } from '../protocol';

interface InitMsg {
  type: 'init';
  specs: PluginSpec[];
  doc: DocMeta;
  theme: ThemePayload;
  baseUrl: string;
}

interface DocMsg {
  type: 'doc';
  gen: number;
  text: string;
}

type InMsg = InitMsg | DocMsg;

interface BlockOut {
  key: string;
  html: string;
  line: number;
  plugins: string[];
  source: string;
}

interface ResultMsg {
  type: 'result';
  gen: number;
  ms: number;
  blocks: BlockOut[];
  outline: OutlineItem[];
  errors: RenderError[];
  plugins: string[];
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

let registry: RuntimeRegistry | null = null;
let md: MarkdownIt | null = null;
let themeMode: 'light' | 'dark' = 'light';
/** 每个块渲染时命中的插件，逐块重置 */
let hit: string[] = [];
let errorSink: RenderError[] = [];

const subMd = new MarkdownIt({ html: true });

function mdFacade(inst: MarkdownIt) {
  // 故意不把整个 md 实例交给插件：给了就等于给全权（§5.5 缺口一）。
  // 提供独立的 subMd 供插件安全渲染内嵌 Markdown，避免主解析状态重入损坏。
  return {
    utils: inst.utils,
    render: (src: string) => subMd.render(src),
    renderInline: (src: string) => subMd.renderInline(src),
  };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

function parseAttrs(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    out[m[1]] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

function findContainer(name: string): { rt: PluginRuntime } | null {
  if (!registry) return null;
  for (const rt of registry.runtimes.values()) {
    if (rt.loaded && rt.container.has(name)) return { rt };
  }
  return null;
}

function build(inst: MarkdownIt): void {

  // 容器语法 ::: name —— 自己实现而不引 markdown-it-container，
  // 因为这里需要「原始正文 + 源码行号」，两者都由 block rule 天然提供。
  inst.block.ruler.before(
    'fence',
    'ge_container',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (state.src.charCodeAt(start) !== 0x3a) return false;
      const line = state.src.slice(start, max);
      const m = /^:::+\s*([A-Za-z0-9_-]*)\s*(.*)$/.exec(line);
      if (!m) return false;
      if (silent) return true;

      let next = startLine + 1;
      for (; next < endLine; next++) {
        const s = state.bMarks[next] + state.tShift[next];
        const e = state.eMarks[next];
        if (/^:::+\s*$/.test(state.src.slice(s, e))) break;
      }
      const body = state.src.slice(state.bMarks[startLine + 1], state.bMarks[next] ?? state.eMarks[next - 1]);
      const name = (m[1] || '').toLowerCase();
      const attrs = parseAttrs(m[2] ?? '');

      state.line = Math.min(next + 1, endLine);
      const token = state.push('html_block', '', 0);
      token.map = [startLine, state.line];
      token.content = renderContainer(name, body, attrs);
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote'] }
  );

  // 围栏：命中插件则交给插件，否则走默认渲染
  const defaultFence = inst.renderer.rules.fence;
  inst.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const lang = (token.info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const code = token.content;
    if (registry && lang) {
      for (const rt of registry.runtimes.values()) {
        const fn = rt.fence.get(lang);
        if (!rt.loaded || !fn) continue;
        try {
          const out = fn(token.info.trim(), code, rt.ctx);
          hit.push(`${rt.spec.id}@${rt.spec.version}`);
          return wrapPlugin(rt.spec.id, out);
        } catch (err) {
          errorSink.push({
            plugin: rt.spec.id,
            line: (token.map?.[0] ?? 0) + 1,
            message: err instanceof Error ? err.message : String(err),
          });
          return errorBlock(err, code);
        }
      }
    }
    if (defaultFence) return defaultFence(tokens, idx, opts, env, self);
    return self.renderToken(tokens, idx, opts);
  };

  // 行内定界符（$...$）：只有插件注册过才启用，避免误伤普通文本里的 $ 
  const hasInline = () =>
    !!registry && [...registry.runtimes.values()].some((rt) => rt.loaded && rt.inlineDelims.length > 0);
  inst.inline.ruler.before('emphasis', 'ge_delimiter', (state, silent) => {
    if (!hasInline()) return false;
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x24) return false;
    const max = state.posMax;
    let end = start + 1;
    while (end < max) {
      if (state.src.charCodeAt(end) === 0x24 && state.src.charCodeAt(end - 1) !== 0x5c) break;
      end++;
    }
    if (end >= max || end === start + 1) return false;
    const text = state.src.slice(start + 1, end);
    if (!text.trim() || /^\s|\s$/.test(text)) return false;
    if (silent) return true;

    for (const rt of registry!.runtimes.values()) {
      if (!rt.loaded) continue;
      const fn = rt.inlineDelims[0];
      if (!fn) continue;
      try {
        const html = fn(text, rt.ctx);
        if (html) {
          const token = state.push('html_inline', '', 0);
          token.content = html;
          hit.push(`${rt.spec.id}@${rt.spec.version}`);
          state.pos = end + 1;
          return true;
        }
      } catch (err) {
        errorSink.push({
          plugin: rt.spec.id,
          line: 0,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return false;
  });

  // 内置口子：只有 trust === 'builtin' 拿到过 coreRuleHook
  inst.core.ruler.push('ge_core_rules', (state) => {
    if (!registry) return;
    for (const rt of registry.runtimes.values()) {
      if (rt.loaded && rt.coreRuleHook) {
        try {
          rt.coreRuleHook(state);
        } catch (err) {
          errorSink.push({
            plugin: rt.spec.id,
            line: 0,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  });

  // 外链统一走宿主打开（沙箱内导航会把 iframe 变成别人的页面）
  inst.renderer.rules.link_open = (tokens, idx, opts, _env, self) => {
    const token = tokens[idx];
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
    const href = token.attrGet('href') ?? '';
    if (/^https?:/i.test(href)) token.attrSet('data-ge-external', href);
    return self.renderToken(tokens, idx, opts);
  };
}

function wrapPlugin(id: string, html: string): string {
  return `<div class="ge-plugin ge-plugin--${id}" data-ge-plugin="${id}">${html}</div>`;
}

function errorBlock(err: unknown, code: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return `<div class="ge-error"><div class="ge-error__t">渲染失败：${escapeHtml(
    message
  )}</div><pre class="ge-error__c">${escapeHtml(code)}</pre></div>`;
}

function renderContainer(name: string, body: string, attrs: Record<string, string>): string {
  const found = findContainer(name);
  if (!found) {
    return `<div class="ge-plugin ge-container ge-container--${name}"${
      Object.keys(attrs).length ? ` data-attrs="${escapeHtml(JSON.stringify(attrs))}"` : ''
    }>${escapeHtml(body)}</div>`;
  }
  const rt = found.rt;
  const fn = rt.container.get(name)!;
  try {
    const out = fn(name, body, attrs, rt.ctx);
    hit.push(`${rt.spec.id}@${rt.spec.version}`);
    return wrapPlugin(rt.spec.id, out);
  } catch (err) {
    errorSink.push({
      plugin: rt.spec.id,
      line: 0,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorBlock(err, body);
  }
}

function extractOutline(tokens: MdToken[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const level = Number(t.tag.slice(1)) || 1;
    const inline = tokens[i + 1];
    const text = (inline?.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('')
      .trim();
    items.push({ level, text: text || '(无标题)', line: (t.map?.[0] ?? 0) + 1 });
  }
  return items;
}

function parseFrontmatter(text: string): { body: string; data: Record<string, unknown> } {
  if (!text.startsWith('---')) return { body: text, data: {} };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { body: text, data: {} };
  const head = text.slice(3, end);
  const data: Record<string, unknown> = {};
  for (const line of head.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const rest = text.slice(end + 4);
  return { body: rest, data };
}

function render(gen: number, text: string): ResultMsg {
  const started = performance.now();
  errorSink = [];
  const result: ResultMsg = {
    type: 'result',
    gen,
    ms: 0,
    blocks: [],
    outline: [],
    errors: [],
    plugins: [],
  };
  if (!md) {
    result.errors.push({ line: 1, message: '渲染内核未初始化' });
    result.ms = performance.now() - started;
    return result;
  }

  const { body, data } = parseFrontmatter(text);
  if (registry) {
    for (const rt of registry.runtimes.values()) {
      rt.setDoc({ ...rt.ctx.doc, frontmatter: data });
    }
  }

  const env: Record<string, unknown> = {};
  let tokens: MdToken[];
  try {
    tokens = md.parse(body, env) as unknown as MdToken[];
  } catch (err) {
    result.errors.push({ line: 1, message: err instanceof Error ? err.message : String(err) });
    result.ms = performance.now() - started;
    return result;
  }

  const lines = body.split(/\r?\n/);
  result.outline = extractOutline(tokens);

  const groups = splitBlocks(tokens);
  for (const group of groups) {
    hit = [];
    const source = blockSource(group, lines);
    const line = blockLine(group);
    let html = '';
    try {
      html = md.renderer.render(group as never, md.options, env);
    } catch (err) {
      errorSink.push({
        line,
        message: err instanceof Error ? err.message : String(err),
      });
      html = errorBlock(err, source);
    }
    const cleaned = stripScripts(stripForbiddenAttrs(html).html);
    const plugins = [...new Set(hit)].sort();
    result.blocks.push({
      key: blockKey(source, plugins, themeMode),
      html: cleaned,
      line,
      plugins,
      source,
    });
  }

  result.errors = errorSink;
  result.plugins = [...new Set(result.blocks.flatMap((b) => b.plugins))];
  result.ms = performance.now() - started;
  return result;
}

self.onmessage = async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      themeMode = msg.theme.mode;
      const inst = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
      build(inst);
      md = inst;
      registry = new RuntimeRegistry('worker', msg.baseUrl, {
        log: (level, pluginId, message) =>
          post({ type: 'log', level, message: `[${pluginId}] ${message}` }),
        loadFail: (pluginId, message) =>
          post({ type: 'log', level: 'error', message: `[${pluginId}] 加载失败：${message}` }),
      });
      await registry.loadAll(msg.specs, msg.doc, msg.theme, mdFacade(inst));
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'doc') {
      if (registry) registry.setTheme({ mode: themeMode, tokens: {} });
      post(render(msg.gen, msg.text));
    }
  } catch (err) {
    post({ type: 'fatal', message: err instanceof Error ? err.message : String(err) });
  }
};
