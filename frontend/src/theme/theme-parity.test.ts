import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDITOR_THEMES, INLINE_CODE, PREVIEW_TOKENS, type Mode } from './tokens';

/**
 * 回归护栏（R-261116-0004）：左右两栏并排时正文是同一段文字。
 *
 * 之前预览底板取 VS Code 默认色，正文跟着用了 #d4d4d4，而编辑区是 Ayu 的暖灰
 * #bfbdb6 —— 两种灰左右并排，一眼就能看出「两栏不是一套」。这类偏差不会报错，
 * 只会一直难看，所以用断言钉住：预览正文色必须恒等于编辑区 editor.foreground。
 */

const MODES: Mode[] = ['light', 'dark'];
const previewCss = readFileSync(new URL('../../preview-shell/plugins.css', import.meta.url), 'utf8');

/** 抽出某个规则块里的 --ge-* 变量；选择器要写全，避免 `:root` 命中带属性的那条 */
function cssVars(selector: string): Record<string, string> {
  const at = previewCss.indexOf(selector);
  expect(at, `plugins.css 里找不到选择器 ${selector}`).toBeGreaterThanOrEqual(0);
  const start = previewCss.indexOf('{', at);
  const end = previewCss.indexOf('}', start);
  const out: Record<string, string> = {};
  for (const m of previewCss.slice(start + 1, end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[`--${m[1]}`] = m[2].trim();
  }
  return out;
}

describe('左右两栏的文字色', () => {
  for (const mode of MODES) {
    it(`${mode}：预览正文 / 代码基础色与编辑区 editor.foreground 相等`, () => {
      const editorFg = EDITOR_THEMES[mode].colors['editor.foreground'];
      expect(PREVIEW_TOKENS[mode]['--ge-fg']).toBe(editorFg);
      expect(PREVIEW_TOKENS[mode]['--ge-code-fg']).toBe(editorFg);
    });

    it(`${mode}：plugins.css 兜底与 PREVIEW_TOKENS 逐条相等`, () => {
      const fallback = mode === 'dark' ? cssVars(":root[data-mode='dark'] {") : cssVars(':root {');
      for (const [key, value] of Object.entries(PREVIEW_TOKENS[mode])) {
        expect(fallback[key], `${key} 的 CSS 兜底与 tokens.ts 不一致`).toBe(value);
      }
    });
  }
});

describe('行内代码色', () => {
  for (const mode of MODES) {
    it(`${mode}：预览变量取自 INLINE_CODE（编辑区 variable.md 同源）`, () => {
      expect(PREVIEW_TOKENS[mode]['--ge-inline-code-fg']).toBe(INLINE_CODE[mode].fg);
      expect(PREVIEW_TOKENS[mode]['--ge-inline-code-bg']).toBe(INLINE_CODE[mode].bg);
    });
  }
});
