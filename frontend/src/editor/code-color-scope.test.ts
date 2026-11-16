import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INLINE_CODE, type Mode } from '../theme/tokens';

/**
 * 回归护栏（P26 起，`R-261116-0005` 改写）。
 *
 * 行内代码色是左右两栏**唯一**逐字同值的强调色：反引号里的文字在编辑区与预览区
 * 必须同色，否则同一段 `README.md` 会一边一个颜色。这里钉三件事：
 * 1. 预览侧走 `--ge-inline-code-*` 变量，不写死色值；
 * 2. 编辑区由 `INLINE_CODE` 承载，不允许直接写十六进制；
 * 3. 两套色都要过 WCAG AA，粉字压粉底不能靠眼睛估。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const appCss = read('../styles/app.css');
const tokensCss = read('../styles/tokens.css');
const previewCss = read('../../preview-shell/plugins.css');
const editorSrc = read('./index.ts');

describe('行内代码色', () => {
  it('预览 code 规则消费专用变量，不写死色值', () => {
    expect(/code\s*\{[^}]*color:\s*var\(--ge-inline-code-fg\)/m.test(previewCss)).toBe(true);
    expect(/code\s*\{[^}]*background:\s*var\(--ge-inline-code-bg\)/m.test(previewCss)).toBe(true);
  });

  it('代码块不被行内代码的粉底污染：pre code 恢复 --ge-code-bg / --ge-code-fg', () => {
    expect(/pre\s+code\s*\{[^}]*background:\s*none/m.test(previewCss)).toBe(true);
    expect(/pre\s+code\s*\{[^}]*color:\s*var\(--ge-code-fg\)/m.test(previewCss)).toBe(true);
  });

  it('编辑区 variable.md 引用 INLINE_CODE，不直接写死十六进制', () => {
    expect(/token:\s*'variable\.md',\s*foreground:\s*[0-9a-f]{6}/i.test(editorSrc)).toBe(false);
    for (const mode of ['light', 'dark'] as Mode[]) {
      expect(editorSrc).toContain(`foreground: INLINE_CODE.${mode}.fg.slice(1)`);
    }
  });

  it('旧的 #141925 已退场（两侧不再各用一套深色）', () => {
    for (const [name, src] of [
      ['preview-shell/plugins.css', previewCss],
      ['app.css', appCss],
      ['tokens.css', tokensCss],
      ['editor/index.ts', editorSrc],
    ] as [string, string][]) {
      expect(src, `${name} 不应再出现 #141925`).not.toContain('#141925');
    }
  });

  it('两套色都过 WCAG AA（行内代码字号偏小，不留余地）', () => {
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(ratio(INLINE_CODE.light.fg, INLINE_CODE.light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(INLINE_CODE.dark.fg, INLINE_CODE.dark.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
