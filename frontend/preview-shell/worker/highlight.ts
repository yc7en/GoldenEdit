/**
 * 围栏代码块高亮（L1 Worker，无 DOM）。
 *
 * 用 `lib/core` + 显式注册，而不是 `lib/common`：后者把 37 种语言全打进 Worker，
 * 而 Worker 是每次预览都要加载的常驻成本。语言文件按需列在这里，加一种就多一种体积。
 *
 * 高亮产物只有 `.hljs-*` 类名，配色在 plugins.css 的 `--ge-hl-*` 变量里，
 * 所以切换明暗主题只需换变量、不用重解析文档（§6.6）。
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
