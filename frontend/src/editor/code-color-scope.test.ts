import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 回归护栏（P26，用户更正）：行内代码的深色文字是**右侧预览区**专用的，
 * 中间 Monaco 编辑区不该出现这个色值。CSS 分属两个 Vite 构建，人工很容易
 * 把规则加到主窗口那份里，所以用文件级断言把边界钉住。
 */
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const appCss = read('../styles/app.css');
const tokensCss = read('../styles/tokens.css');
const previewCss = read('../../preview-shell/plugins.css');

describe('行内代码色的作用域', () => {
  it('只出现在预览外壳的 code 规则里', () => {
    expect(/code\s*\{[^}]*color:\s*#141925/m.test(previewCss)).toBe(true);
  });

  it('主窗口样式、编辑器主题与 Monaco 代码里都没有这个色值', () => {
    const sources: [string, string][] = [
      ['app.css', appCss],
      ['tokens.css', tokensCss],
      ['editor/index.ts', read('./index.ts')],
      ['editor/fences.ts', read('./fences.ts')],
    ];
    for (const [name, src] of sources) {
      expect(src, `${name} 不应出现该色值`).not.toContain('#141925');
    }
  });

  it('两侧各有独立的 hljs 配色变量，且分组一一对应', () => {
    for (const bucket of [
      'comment', 'keyword', 'string', 'title', 'number',
      'builtin', 'meta', 'deletion', 'addition', 'tag',
    ]) {
      expect(appCss).toContain(`.ge-hl-${bucket}`);
      expect(tokensCss).toContain(`--ed-hl-${bucket}`);
      expect(previewCss).toContain(`--ge-hl-${bucket}`);
    }
    // 亮暗两套都要有，否则切主题会掉色
    expect(tokensCss.match(/--ed-hl-keyword:/g)).toHaveLength(2);
    expect(previewCss.match(/--ge-hl-keyword:/g)).toHaveLength(2);
  });
});
