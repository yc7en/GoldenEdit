/**
 * highlight.js 单一语言注册表（P26）。
 *
 * 两个消费方共用**同一份**注册与配色分桶，避免「预览有颜色、编辑区没有」或两边
 * 对同一个词的颜色不一致：
 *   - `frontend/preview-shell/worker/parse.ts`：MarkdownIt `highlight` 钩子，产出 `.hljs-*` HTML；
 *   - `frontend/src/editor/index.ts`：Monaco 围栏代码块的 decorations，产出 `.ge-hl-*` 类名。
 *
 * 用 `lib/core` + 显式注册，而不是 `lib/common`：后者把 37 种语言全打进包里，
 * 而预览 Worker 与编辑区都是常驻成本。加一种语言就在这里加一行。
 *
 * 本模块不碰 DOM、不依赖 Tauri，Worker 与主窗口都能直接 import。
 */
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';

import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import cpp from 'highlight.js/lib/languages/cpp';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** 语言自带的别名（js / py / sh / html / md / yml / c++ …）由 registerLanguage 一并注册 */
const LANGUAGES: [string, LanguageFn][] = [
  ['bash', bash],
  ['csharp', csharp],
  ['css', css],
  ['cpp', cpp],
  ['diff', diff],
  ['dockerfile', dockerfile],
  ['go', go],
  ['ini', ini],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['kotlin', kotlin],
  ['lua', lua],
  ['markdown', markdown],
  ['php', php],
  ['powershell', powershell],
  ['python', python],
  ['ruby', ruby],
  ['rust', rust],
  ['scss', scss],
  ['sql', sql],
  ['swift', swift],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
];

for (const [name, fn] of LANGUAGES) hljs.registerLanguage(name, fn);

/**
 * token 配色分桶。`.hljs-*` 类名很多，但颜色只有这 10 组；
 * 预览侧 `plugins.css` 的 `--ge-hl-*` 与编辑侧 `app.css` 的 `--ed-hl-*` 按同一分组落色。
 */
export const HLJS_BUCKETS = {
  comment: ['comment', 'quote'],
  keyword: ['keyword', 'selector-tag', 'literal', 'type', 'doctag'],
  string: ['string', 'regexp', 'attribute', 'template-variable', 'selector-attr', 'selector-pseudo'],
  title: ['title', 'section', 'name', 'selector-id', 'selector-class', 'function'],
  number: ['number', 'symbol', 'bullet', 'link', 'variable', 'template-tag', 'params'],
  builtin: ['built_in', 'builtin-name', 'attr', 'property', 'subst'],
  meta: ['meta'],
  deletion: ['deletion'],
  addition: ['addition'],
  tag: ['tag'],
} as const satisfies Record<string, readonly string[]>;

export type HlBucket = keyof typeof HLJS_BUCKETS;

const BUCKET_OF = new Map<string, HlBucket>();
for (const [bucket, names] of Object.entries(HLJS_BUCKETS)) {
  for (const name of names) BUCKET_OF.set(name, bucket as HlBucket);
}

/**
 * 从 class 属性里取分桶。`hljs-title function_` 这类 tiered scope 只看第一个
 * `hljs-` 前缀的类名；`language-*` 是子语言标记，不参与配色。
 */
export function bucketOf(classAttr: string): HlBucket | null {
  for (const cls of classAttr.split(/\s+/)) {
    if (!cls.startsWith('hljs-')) continue;
    return BUCKET_OF.get(cls.slice(5)) ?? null;
  }
  return null;
}

/**
 * markdown-it 的 `highlight` 钩子。
 * 返回空串时 markdown-it 会退回 `escapeHtml(code)`——未标注语言、语言未注册、
 * 以及高亮抛错都走这条路，只退化成无色代码块，不会让整篇文档渲染失败。
 */
export function highlightCode(code: string, lang: string, _attrs = ''): string {
  if (!lang) return '';
  // 只用它判断「有没有注册」；不要把 resolved.name 传给 highlight()——
  // 那是语言显示名（如 'HTML, XML'），别名会解析失败并静默退化成无高亮。
  // 传原始 lang 字符串，由 highlight.js 内部的 getLanguage() 解析别名。
  if (!hljs.getLanguage(lang)) return '';
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return '';
  }
}

/** 高亮 HTML 的一个片段：解码后的原文 + 它所处的 class（未着色为 null） */
interface Segment {
  text: string;
  className: string | null;
}

/** highlight.js/lib/core 的 escapeHTML 只产出这 5 种实体，另外兼容常见的数字实体写法 */
const ENTITY = /&(?:amp|lt|gt|quot|apos|#x27|#39|#x[0-9a-fA-F]+|#[0-9]+);/g;
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#x27;': "'",
  '&#39;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (raw) => {
    if (ENTITY_MAP[raw]) return ENTITY_MAP[raw];
    const hex = /^&#x([0-9a-fA-F]+);$/.exec(raw);
    if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
    const dec = /^&#([0-9]+);$/.exec(raw);
    if (dec) return String.fromCodePoint(Number.parseInt(dec[1], 10));
    return raw;
  });
}

/**
 * 把 `<span class="...">…</span>` 拆成片段，并把实体还原成原文字符，
 * 这样片段长度才能直接当成「原文偏移量」用。输入固定来自 hljs 的 HTMLRenderer，
 * 不是任意 HTML——不做通用 HTML 解析，也不允许任何标签注入。
 */
export function parseHighlightHtml(html: string): Segment[] {
  const out: Segment[] = [];
  const stack: string[] = [];
  const re = /<span class="([^"]*)">|<\/span>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      stack.push(m[1]);
    } else if (m[2] !== undefined) {
      const text = decodeEntities(m[2]);
      if (text) out.push({ text, className: stack.at(-1) ?? null });
    } else {
      // `</span>`：出栈。hljs 的产出自洽，多出的闭合标签按「结束所有嵌套」处理。
      stack.pop();
    }
  }
  return out;
}

/** 落在原文 code 上的一段着色区间（左闭右开） */
export interface HlRange {
  start: number;
  end: number;
  bucket: HlBucket;
}

/** 单个围栏最多产生的装饰数，防止病态代码块把 decoration 集合撑爆 */
const MAX_RANGES = 4000;

/**
 * 给 Monaco 用：返回原文字符偏移量 + 配色分桶。
 *
 * 关键防线：把解析出的片段拼回去必须**逐字符等于**原始 code。若不等（hljs 版本
 * 换了转义策略、或输入里有代理对），整块放弃高亮而不是把颜色画到错字上。
 */
export function highlightRanges(code: string, lang: string): HlRange[] {
  if (!code || !lang || !hljs.getLanguage(lang)) return [];
  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return [];
  }
  const segments = parseHighlightHtml(html);
  if (segments.map((s) => s.text).join('') !== code) return [];

  const out: HlRange[] = [];
  let offset = 0;
  for (const seg of segments) {
    const bucket = seg.className ? bucketOf(seg.className) : null;
    const len = seg.text.length;
    // 纯空白不必上色：省下大量 decoration，视觉上没有差别
    if (bucket && seg.text.trim()) {
      const last = out.at(-1);
      if (last && last.bucket === bucket && last.end === offset) last.end = offset + len;
      else out.push({ start: offset, end: offset + len, bucket });
      if (out.length >= MAX_RANGES) break;
    }
    offset += len;
  }
  return out;
}
