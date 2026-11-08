/**
 * YAML frontmatter 解析 + 属性面板渲染。
 *
 * 纯函数模块：不碰 DOM、不碰 self，Worker 与 vitest(node) 都能直接 import。
 *
 * 两个关键约定：
 * 1. 头部被「等量空行」替换而不是直接切掉，这样 markdown-it 的 token.map 行号
 *    天然与编辑器源码一致，大纲跳转、同步滚动、错误行号都无需各自补 offset。
 * 2. 用 js-yaml 的 JSON_SCHEMA：只产出 null/bool/number/string/array/plain object。
 *    不生成 Date / Uint8Array 这类需要 structured clone 或会破坏 JSON 序列化的值，
 *    让 postMessage、插件 ctx.doc.frontmatter、导出拿到的是同一份可预测数据。
 */
import jsYaml from 'js-yaml';

export interface FrontmatterError {
  /** 1 基源码行号（指向头部内出错的那一行） */
  line: number;
  message: string;
}

export interface FrontmatterResult {
  /** 供 markdown-it 解析的正文；行号与原文严格对齐 */
  body: string;
  /** 结构化元数据；解析失败时为空对象 */
  data: Record<string, unknown>;
  /** 头部原文（不含首尾分隔符） */
  raw: string;
  /** 头部占用的源码行数（含两条分隔符）；无头部时为 0 */
  lines: number;
  error: FrontmatterError | null;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MAX_DEPTH = 4;
const MAX_SCALAR = 400;

function none(text: string): FrontmatterResult {
  return { body: text, data: {}, raw: '', lines: 0, error: null };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}

/** 去掉可能触发原型污染的键，顺带保证发往宿主的数据是纯 JSON 值 */
function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!UNSAFE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function parseFrontmatter(text: string): FrontmatterResult {
  if (typeof text !== 'string' || !text) return none(text);
  // BOM 不占行，去掉后不影响行号对齐
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  if (lines[0].trim() !== '---') return none(text);

  // 结束分隔符必须独占一行；未闭合时整段交回 markdown-it（会渲染成一条分隔线），
  // 不能吞掉用户的正文。
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return none(text);

  const raw = lines.slice(1, end).join('\n');
  // repeat(end + 1)：正文首行落在索引 end + 1，与原文 lines[end + 1] 对齐
  const body = '\n'.repeat(end + 1) + lines.slice(end + 1).join('\n');
  const base = { body, raw, lines: end + 1 };
  if (!raw.trim()) return { ...base, data: {}, error: null };

  try {
    const loaded = jsYaml.load(raw, { schema: jsYaml.JSON_SCHEMA, filename: 'frontmatter' });
    if (loaded === null || loaded === undefined) return { ...base, data: {}, error: null };
    if (typeof loaded !== 'object' || Array.isArray(loaded)) {
      return {
        ...base,
        data: {},
        error: { line: 2, message: 'YAML 解析失败：frontmatter 顶层必须是键值映射' },
      };
    }
    return { ...base, data: sanitize(loaded as Record<string, unknown>), error: null };
  } catch (err) {
    const e = err as { mark?: { line?: number }; reason?: string; message?: string };
    return {
      ...base,
      data: {},
      error: {
        line: 2 + (e.mark?.line ?? 0),
        message: `YAML 解析失败：${e.reason ?? e.message ?? String(err)}`,
      },
    };
  }
}

/* ───────── 属性面板 HTML ───────── */

function clip(s: string): string {
  return s.length > MAX_SCALAR ? `${s.slice(0, MAX_SCALAR)}…` : s;
}

/** 数组元素 / 深层对象退化成单行文本，避免 chip 里塞进 DOM */
function scalarText(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') {
    try {
      return clip(JSON.stringify(v));
    } catch {
      return String(v);
    }
  }
  return clip(String(v));
}

function renderValue(v: unknown, depth: number): string {
  if (v === null || v === undefined) return '<span class="ge-fm__null">null</span>';
  if (typeof v === 'boolean') {
    return `<span class="ge-fm__bool ge-fm__bool--${v}">${v}</span>`;
  }
  if (typeof v === 'number') {
    return `<span class="ge-fm__num">${escapeHtml(String(v))}</span>`;
  }
  if (typeof v === 'string') {
    const text = escapeHtml(clip(v));
    if (ISO_DATE.test(v)) {
      return `<time class="ge-fm__date" datetime="${escapeHtml(v)}">${text}</time>`;
    }
    const cls = v.includes('\n') ? ' ge-fm__val--multi' : '';
    return `<span class="ge-fm__text${cls}">${text}</span>`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '<span class="ge-fm__null">[]</span>';
    return `<div class="ge-fm__chips">${v
      .map((x) => `<span class="ge-fm__chip">${escapeHtml(scalarText(x))}</span>`)
      .join('')}</div>`;
  }
  if (typeof v === 'object') {
    if (depth >= MAX_DEPTH) {
      return `<span class="ge-fm__null">${escapeHtml(clip(JSON.stringify(v)))}</span>`;
    }
    return `<div class="ge-fm__sub">${renderRows(v as Record<string, unknown>, depth + 1)}</div>`;
  }
  return `<span class="ge-fm__text">${escapeHtml(scalarText(v))}</span>`;
}

function renderRows(obj: Record<string, unknown>, depth = 0): string {
  const entries = Object.entries(obj).filter(([k]) => !UNSAFE_KEYS.has(k));
  if (entries.length === 0) return '<div class="ge-fm__empty">（空）</div>';
  return entries
    .map(
      ([k, v]) =>
        `<div class="ge-fm__row" style="--ge-fm-indent:${depth}">` +
        `<div class="ge-fm__key">${escapeHtml(k)}</div>` +
        `<div class="ge-fm__val">${renderValue(v, depth)}</div>` +
        `</div>`
    )
    .join('');
}

/**
 * 生成可折叠的属性面板。用原生 <details> 而非脚本：Worker 侧无 DOM，
 * 且 morphdom 按 key 复用节点时展开/折叠状态不会被重置。
 */
export function renderFrontmatter(result: FrontmatterResult): string {
  if (result.lines === 0) return '';
  const count = Object.keys(result.data).length;
  const head =
    '<summary class="ge-fm__head">' +
    '<span class="ge-fm__arrow"></span>' +
    '<span class="ge-fm__label">属性</span>' +
    `<span class="ge-fm__count">${result.error ? '解析失败' : `${count} 项`}</span>` +
    '</summary>';

  if (result.error) {
    return (
      `<details class="ge-fm ge-fm--error" open>${head}<div class="ge-fm__body">` +
      `<p class="ge-fm__err">第 ${result.error.line} 行：${escapeHtml(result.error.message)}</p>` +
      `<pre class="ge-fm__raw">${escapeHtml(result.raw)}</pre>` +
      '</div></details>'
    );
  }

  return (
    `<details class="ge-fm" open>${head}<div class="ge-fm__body">` +
    renderRows(result.data) +
    '</div></details>'
  );
}
