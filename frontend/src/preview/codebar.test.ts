import { describe, expect, it } from 'vitest';

// 代码块工具条插件。钉住的核心是「插件接管围栏之后不能把语法高亮弄丢」：
// codebar 自己拼 <div> 外壳，若直接用 escapeHtml(code) 输出，js / ts / py / rust
// 等 24 种常见语言在预览里就只剩一片灰，与编辑区那侧的颜色对不上（ARCHITECTURE §6.6）。
const entryPath = '../../../plugins/codebar/entry.js';

interface FakeCtx {
  env: { scope: string };
  highlight: (code: string, lang: string) => string;
  onFence: (langs: string[], fn: (info: string, code: string) => string) => void;
  onMount: (selector: string, fn: (el: unknown) => void) => void;
}

const mod = (await import(entryPath)) as unknown as {
  register: (md: unknown, ctx: FakeCtx) => void;
};

/** 假高亮：只把关键词包一层 span，够验证「插件确实用了宿主的高亮结果」 */
function fakeHighlight(code: string, lang: string): string {
  if (lang !== 'js') return '';
  return code.replace(/\bfunction\b/g, '<span class="hljs-keyword">function</span>');
}

function harness(scope = 'worker', highlight = fakeHighlight) {
  const fences: { langs: string[]; fn: (info: string, code: string) => string }[] = [];
  const mounts: { selector: string; fn: (el: unknown) => void }[] = [];
  const ctx: FakeCtx = {
    env: { scope },
    highlight,
    onFence: (langs, fn) => fences.push({ langs, fn }),
    onMount: (selector, fn) => mounts.push({ selector, fn }),
  };
  return { ctx, fences, mounts };
}

const CODE = 'function hello() {\n  return 1;\n}';

describe('代码块工具条注册', () => {
  it('worker 侧接管常见语言的围栏，主线程侧只挂复制按钮', () => {
    const worker = harness();
    mod.register({}, worker.ctx);
    expect(worker.fences).toHaveLength(1);
    expect(worker.fences[0].langs).toContain('js');
    expect(worker.mounts).toHaveLength(0);

    const main = harness('main');
    mod.register({}, main.ctx);
    expect(main.fences).toHaveLength(0);
    expect(main.mounts[0].selector).toBe('.ge-codebar__copy');
  });
});

describe('高亮不被工具条吃掉', () => {
  it('走宿主的高亮结果，代码块里有 hljs 分桶类名', () => {
    const { ctx, fences } = harness();
    mod.register({}, ctx);
    const html = fences[0].fn('js', CODE);
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('ge-codebar__header');
  });

  it('语言未注册（高亮返回空串）时退回转义后的纯文本，不吐空代码块', () => {
    const { ctx, fences } = harness('worker', () => '');
    mod.register({}, ctx);
    const html = fences[0].fn('js', 'const a = 1 < 2;');
    expect(html).toContain('const a = 1 &lt; 2;');
    expect(html).not.toContain('hljs-');
  });

  it('复制按钮拿到的仍是原始源码，不是高亮后的 HTML', () => {
    const { ctx, fences } = harness();
    mod.register({}, ctx);
    const html = fences[0].fn('js', CODE);
    const m = /data-code="([^"]*)"/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(CODE);
    expect(m![1]).not.toContain('hljs');
  });

  it('代码里的尖括号与引号一律转义，不因插入高亮而破口', () => {
    const { ctx, fences } = harness('worker', () => '');
    mod.register({}, ctx);
    const html = fences[0].fn('html', '<img src=x onerror="alert(1)">');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toContain('<img');
  });
});
