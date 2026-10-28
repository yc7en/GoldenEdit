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

  // 块级公式 $$ ... $$
  inst.block.ruler.before(
    'fence',
    'ge_math_block',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (start + 2 > max) return false;
      if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) !== 0x24) return false;

      const firstLine = state.src.slice(start, max).trim();
      let body = '';
      let next = startLine;

      if (firstLine.length > 4 && firstLine.endsWith('$$')) {
        body = firstLine.slice(2, -2).trim();
        next = startLine + 1;
      } else {
        next = startLine + 1;
        let closed = false;
        for (; next < endLine; next++) {
          const s = state.bMarks[next] + state.tShift[next];
          const e = state.eMarks[next];
          const line = state.src.slice(s, e).trim();
          if (line === '$$' || line.endsWith('$$')) {
            closed = true;
            break;
          }
        }
        body = state.src.slice(state.bMarks[startLine + 1], state.bMarks[next] ?? state.eMarks[next - 1]).trim();
        if (closed) next++;
      }

      if (silent) return true;
      state.line = Math.min(next, endLine);
      const token = state.push('html_block', '', 0);
      token.map = [startLine, state.line];
      token.content = wrapPlugin(
        'katex',
        `<div class="ge-katex ge-katex--block" data-math="${escapeHtml(body)}" data-display="true"></div>`
      );
      hit.push('katex@1.0.0');
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

  // Obsidian 提示框语法支持：> [!NOTE] Title 以及折叠/元数据增强
  const OBS_ICONS: Record<string, string> = {
    note: 'ℹ️', info: 'ℹ️', tip: '💡', important: '💡',
    warn: '⚠️', warning: '⚠️', danger: '🛑', caution: '⚠️', attention: '⚠️',
    success: '✅', done: '✅', todo: '📋', example: '📋',
    quote: '💬', question: '❓', bug: '🛑', abstract: '📋',
  };
  const OBS_TITLES: Record<string, string> = {
    note: '注意', info: '信息', tip: '提示', important: '重要',
    warn: '警告', warning: '警告', danger: '危险', caution: '警告', attention: '注意',
    success: '成功', done: '完成', todo: '待办', example: '示例',
    quote: '引用', question: '疑问', bug: '缺陷', abstract: '摘要',
  };

  // 兼容旧语法：!!!note{旧语法} ... !!!
  inst.block.ruler.before(
    'fence',
    'ge_legacy_admonition',
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      if (
        start + 3 > max ||
        state.src.charCodeAt(start) !== 0x21 ||
        state.src.charCodeAt(start + 1) !== 0x21 ||
        state.src.charCodeAt(start + 2) !== 0x21
      ) {
        return false;
      }
      const line = state.src.slice(start, max);
      const m = /^!!!\s*([a-zA-Z0-9_-]+)(?:\{(.*?)\})?\s*$/.exec(line);
      if (!m) return false;
      if (silent) return true;

      let next = startLine + 1;
      for (; next < endLine; next++) {
        const s = state.bMarks[next] + state.tShift[next];
        const e = state.eMarks[next];
        if (/^!!!\s*$/.test(state.src.slice(s, e))) break;
      }

      const body = state.src.slice(
        state.bMarks[startLine + 1],
        state.bMarks[next] ?? state.eMarks[next - 1]
      );
      state.line = Math.min(next + 1, endLine);

      const rawType = m[1].toLowerCase();
      const attrStr = (m[2] ?? '').trim();
      let title = '';
      let foldable = false;
      let defaultOpen = true;

      if (attrStr) {
        if (!attrStr.includes('=') && !attrStr.includes(' ')) {
          title = attrStr;
        } else {
          for (const p of attrStr.split(/\s+/)) {
            if (p === 'collapsible' || p === 'fold') foldable = true;
            else if (p === 'open=false' || p === 'closed') {
              foldable = true;
              defaultOpen = false;
            } else if (p === 'open=true' || p === 'open') {
              foldable = true;
              defaultOpen = true;
            } else if (p.startsWith('title=')) {
              title = p.slice(6).replace(/^["']|["']$/g, '');
            } else if (!title) {
              title = p;
            }
          }
        }
      }

      const normType =
        rawType === 'warning' || rawType === 'caution' || rawType === 'attention'
          ? 'warn'
          : rawType === 'important' || rawType === 'example'
          ? 'tip'
          : rawType === 'info' || rawType === 'todo' || rawType === 'question'
          ? 'note'
          : rawType === 'bug' || rawType === 'error' || rawType === 'failure'
          ? 'danger'
          : rawType === 'done'
          ? 'success'
          : rawType;

      const icon = OBS_ICONS[rawType] || '💡';
      const finalTitle = title || OBS_TITLES[rawType] || (rawType.charAt(0).toUpperCase() + rawType.slice(1));
      const tag = foldable ? 'details' : 'div';
      const headerTag = foldable ? 'summary' : 'div';
      const openAttr = foldable && defaultOpen ? ' open' : '';
      const foldClass = foldable ? ' ge-callout--foldable' : '';
      const renderedBody = inst.render(body);

      const token = state.push('html_block', '', 0);
      token.map = [startLine, state.line];
      token.content = `<div class="ge-plugin ge-plugin--callout" data-ge-plugin="callout"><${tag} class="ge-callout ge-callout--${normType} ge-callout--type-${rawType}${foldClass}"${openAttr}><${headerTag} class="ge-callout__header"><span class="ge-callout__icon">${icon}</span><span class="ge-callout__title">${escapeHtml(
        finalTitle
      )}</span>${foldable ? '<span class="ge-callout__fold-arrow"></span>' : ''}</${headerTag}><div class="ge-callout__body">${renderedBody}</div></${tag}></div>`;

      hit.push('callout@1.0.0');
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote'] }
  );

  inst.core.ruler.after('block', 'ge_obsidian_callout', (state) => {
    const tokens = state.tokens;
    const re = /^\[!([a-zA-Z0-9_-]+)(?:\|([^\]]*))?\]([+-])?(?:[ \t]+([^\n]*))?(?:\n([\s\S]*))?$/;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;

      let depth = 1;
      let closeIdx = -1;
      for (let k = i + 1; k < tokens.length; k++) {
        if (tokens[k].type === 'blockquote_open') depth++;
        else if (tokens[k].type === 'blockquote_close') {
          depth--;
          if (depth === 0) {
            closeIdx = k;
            break;
          }
        }
      }
      if (closeIdx === -1) continue;

      let inlineIdx = -1;
      for (let k = i + 1; k < closeIdx; k++) {
        if (tokens[k].type === 'inline') {
          inlineIdx = k;
          break;
        }
      }
      if (inlineIdx === -1) continue;

      const m = re.exec(tokens[inlineIdx].content);
      if (!m) continue;

      const rawType = m[1].toLowerCase();
      const metaStr = m[2] || '';
      const fold = m[3];
      const rawTitle = m[4];
      const rest = m[5] || '';

      let typeOverride = '';
      let color = '';
      let icon = '';
      let noIcon = false;
      let foldable = fold === '+' || fold === '-';
      let defaultOpen = fold !== '-';
      const customClasses: string[] = [];

      const metaTokens = metaStr.trim() ? metaStr.trim().split(/\s+/) : [];
      for (const mt of metaTokens) {
        if (/^(type|kind):/i.test(mt)) {
          typeOverride = mt.replace(/^(type|kind):/i, '').toLowerCase();
        } else if (/^color:/i.test(mt)) {
          color = mt.replace(/^color:/i, '');
        } else if (/^icon:/i.test(mt)) {
          const ic = mt.replace(/^icon:/i, '');
          if (ic === 'none') noIcon = true;
          else icon = ic;
        } else if (mt === 'no-icon') {
          noIcon = true;
        } else if (mt === 'collapsible' || mt === 'fold') {
          foldable = true;
        } else if (mt === 'open') {
          foldable = true;
          defaultOpen = true;
        } else if (mt === 'closed') {
          foldable = true;
          defaultOpen = false;
        } else if (
          /^#|^rgb|^hsl/.test(mt) ||
          ['purple', 'green', 'red', 'blue', 'orange', 'pink', 'cyan', 'yellow'].includes(mt)
        ) {
          color = mt;
          customClasses.push(`mdext-admonition--meta-${mt}`);
        } else {
          customClasses.push(`mdext-admonition--meta-${mt}`);
        }
      }

      const type = typeOverride || rawType;
      const normType =
        type === 'warning' || type === 'caution' || type === 'attention'
          ? 'warn'
          : type === 'important' || type === 'example'
          ? 'tip'
          : type === 'info' || type === 'todo' || type === 'question'
          ? 'note'
          : type === 'bug' || type === 'error' || type === 'failure' || type === 'missing'
          ? 'danger'
          : type === 'done'
          ? 'success'
          : type;

      const finalIcon = noIcon ? '' : icon || OBS_ICONS[type] || OBS_ICONS[normType] || '💡';
      const finalTitle =
        rawTitle !== undefined && rawTitle.trim() !== ''
          ? rawTitle.trim()
          : OBS_TITLES[type] || OBS_TITLES[normType] || (type.charAt(0).toUpperCase() + type.slice(1));

      // 更新首段文本：清除 [!TYPE] 标记所在首行，只保留后续正文
      tokens[inlineIdx].content = rest;
      if (!rest.trim()) {
        if (inlineIdx > i && tokens[inlineIdx - 1].type === 'paragraph_open') {
          tokens[inlineIdx - 1].hidden = true;
        }
        if (inlineIdx < closeIdx && tokens[inlineIdx + 1].type === 'paragraph_close') {
          tokens[inlineIdx + 1].hidden = true;
        }
      }

      const colorStyle = color
        ? `--ge-callout-custom-color: ${color}; border-left-color: ${color} !important;`
        : '';
      const headerBgStyle = color
        ? `background: color-mix(in srgb, ${color} 10%, transparent);`
        : '';

      const tag = foldable ? 'details' : 'div';
      const headerTag = foldable ? 'summary' : 'div';
      const openAttr = foldable && defaultOpen ? ' open' : '';
      const foldClass = foldable ? ' ge-callout--foldable' : '';
      const classStr = `ge-callout ge-callout--${normType} ge-callout--type-${type}${foldClass} ${customClasses.join(
        ' '
      )}`.trim();

      tokens[i].type = 'html_block';
      tokens[i].content = `<div class="ge-plugin ge-plugin--callout" data-ge-plugin="callout"><${tag} class="${classStr}"${openAttr} style="${colorStyle}"><${headerTag} class="ge-callout__header" style="${headerBgStyle}">${
        finalIcon ? `<span class="ge-callout__icon">${finalIcon}</span>` : ''
      }<span class="ge-callout__title">${escapeHtml(finalTitle)}</span>${
        foldable ? '<span class="ge-callout__fold-arrow"></span>' : ''
      }</${headerTag}><div class="ge-callout__body">`;

      tokens[closeIdx].type = 'html_block';
      tokens[closeIdx].content = `</div></${tag}></div>`;
      hit.push('callout@1.0.0');
    }
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
