import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// 图表插件是纯 JS（无构建步骤），动态 import 拿它的注册行为做单测。
// 环境是 node，所以这里只验证「双环境分支、占位转义、错误降级、传给 Pele 的参数」
// 这类不依赖真实排版的部分；SVG 出来长什么样留给真机点验（既有决定：不引 jsdom）。
const entryPath = '../../../plugins/mermaid/entry.js';

type FenceFn = (info: string, code: string) => string;
type MountFn = (el: FakeEl, payload: unknown, ctx: FakeCtx) => void | Promise<void>;

interface FakeCtx {
  env: { scope: string };
  onFence: (langs: string[], fn: FenceFn) => void;
  onMount: (selector: string, fn: MountFn) => void;
  libs: { load: (name: string) => Promise<unknown> };
}

interface FakeEl {
  getAttribute: (name: string) => string | null;
  innerHTML: string;
  clientWidth: number;
  classList: { add: (c: string) => void; has: (c: string) => boolean };
}

const mod = (await import(entryPath)) as unknown as {
  register: (md: unknown, ctx: FakeCtx) => void;
};

function harness(scope: string, load: (name: string) => Promise<unknown>) {
  const fences: { langs: string[]; fn: FenceFn }[] = [];
  const mounts: { selector: string; fn: MountFn }[] = [];
  const calls: string[] = [];
  const ctx: FakeCtx = {
    env: { scope },
    onFence: (langs, fn) => fences.push({ langs, fn }),
    onMount: (selector, fn) => mounts.push({ selector, fn }),
    libs: {
      load: (name) => {
        calls.push(name);
        return load(name);
      },
    },
  };
  return { ctx, fences, mounts, calls };
}

function fakeEl(source: string | null, width = 700): FakeEl {
  const classes = new Set<string>();
  return {
    getAttribute: () => source,
    innerHTML: '',
    clientWidth: width,
    classList: { add: (c) => void classes.add(c), has: (c) => classes.has(c) },
  };
}

/** 插件只用 getComputedStyle 取左右 padding 与 fontFamily，按需造一个最小实现 */
function stubComputedStyle(): void {
  (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({
    paddingLeft: '16px',
    paddingRight: '16px',
    fontFamily: 'Segoe UI, sans-serif',
  });
}

function peleError(over: Record<string, unknown> = {}) {
  return Object.assign(new Error('Parse error on line 2:\n  A[ --> \n--------^\nExpecting'), {
    code: 'syntax',
    line: 2,
    column: 3,
    snippet: '  A[ --> \n--------^',
    ...over,
  });
}

beforeEach(stubComputedStyle);
afterEach(() => {
  delete (globalThis as unknown as { getComputedStyle?: unknown }).getComputedStyle;
});

describe('Worker 侧的占位', () => {
  it('注册 mermaid / mmd 两个围栏名，不注册 mount', () => {
    const { ctx, fences, mounts } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    expect(fences).toHaveLength(1);
    expect(fences[0].langs).toEqual(['mermaid', 'mmd']);
    expect(mounts).toHaveLength(0);
  });

  it('源码里的引号与尖括号必须转义，否则会截断 data-code 属性', () => {
    const { ctx, fences } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    const html = fences[0].fn('', 'A["<b>"] --> B');
    expect(html).toContain('data-code="A[&quot;&lt;b&gt;&quot;] --&gt; B"');
    expect(html).not.toContain('<b>');
  });

  it('空围栏给一句提示，不产出可渲染容器', () => {
    const { ctx, fences } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    const html = fences[0].fn('', '  \n ');
    expect(html).toContain('ge-mermaid--empty');
    expect(html).not.toContain('data-code');
  });
});

describe('主线程侧的注册', () => {
  it('只注册 .ge-mermaid 的 mount，不重复注册围栏', () => {
    const { ctx, fences, mounts } = harness('main', async () => ({}));
    mod.register({}, ctx);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].selector).toBe('.ge-mermaid');
    expect(fences).toHaveLength(0);
  });

  it('库走 libs 白名单，且名字是 pele（mermaid.js 已移除）', async () => {
    const { ctx, mounts, calls } = harness('main', async () => ({
      renderAsync: async () => ({ svg: '<svg></svg>' }),
    }));
    mod.register({}, ctx);
    await mounts[0].fn(fakeEl('flowchart LR\n A-->B'), { key: 'k1' }, ctx);
    expect(calls).toEqual(['pele']);
  });
});

describe('主线程渲染', () => {
  it('把 SVG 塞进容器并标记 ready', async () => {
    const el = fakeEl('flowchart LR\n A-->B');
    const { ctx, mounts } = harness('main', async () => ({
      renderAsync: async () => ({ svg: '<svg id="x"></svg>' }),
    }));
    mod.register({}, ctx);
    await mounts[0].fn(el, { key: 'k1' }, ctx);
    expect(el.innerHTML).toBe('<svg id="x"></svg>');
    expect(el.classList.has('ge-mermaid--ready')).toBe(true);
  });

  it('maxWidth 取内容盒宽度（扣掉左右 padding），idPrefix 用块 key', async () => {
    let seen: Record<string, unknown> = {};
    const { ctx, mounts } = harness('main', async () => ({
      renderAsync: async (_code: string, opts: Record<string, unknown>) => {
        seen = opts;
        return { svg: '<svg></svg>' };
      },
    }));
    mod.register({}, ctx);
    await mounts[0].fn(fakeEl('flowchart LR\n A-->B', 700), { key: 'abc-123' }, ctx);
    expect(seen.maxWidth).toBe(668);
    expect(seen.idPrefix).toBe('ge-abc-123');
    expect(seen.fontFamily).toBe('Segoe UI, sans-serif');
  });

  it('没有 data-code 时静默返回，不碰库', async () => {
    const { ctx, mounts, calls } = harness('main', async () => ({}));
    mod.register({}, ctx);
    await expect(Promise.resolve(mounts[0].fn(fakeEl(null), {}, ctx))).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('错误处理', () => {
  it('PeleError 转成带行列号的错误卡片，源码一并显示', async () => {
    const el = fakeEl('flowchart LR\n  A[ --> ');
    const { ctx, mounts } = harness('main', async () => ({
      renderAsync: () => Promise.reject(peleError()),
    }));
    mod.register({}, ctx);
    await mounts[0].fn(el, { key: 'k1' }, ctx);
    expect(el.innerHTML).toContain('ge-mermaid__error');
    expect(el.innerHTML).toContain('第 2 行第 3 列');
    expect(el.innerHTML).toContain('Parse error on line 2');
    expect(el.innerHTML).toContain('ge-mermaid__source');
    // 只取首行做标题，多行消息不该整段塞进标题里
    expect(el.innerHTML).not.toContain('Expecting');
  });

  it('错误消息里的尖括号必须转义，不能被当成标签', async () => {
    const el = fakeEl('bad');
    const { ctx, mounts } = harness('main', async () => ({
      renderAsync: () => Promise.reject(peleError({ message: '<script>x</script>', snippet: '<x>' })),
    }));
    mod.register({}, ctx);
    await mounts[0].fn(el, { key: 'k1' }, ctx);
    expect(el.innerHTML).toContain('&lt;script&gt;');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('库加载失败时抛出，交给管线显示可重试的挂载错误', async () => {
    const { ctx, mounts } = harness('main', () => Promise.reject(new Error('offline')));
    mod.register({}, ctx);
    await expect(
      Promise.resolve(mounts[0].fn(fakeEl('flowchart LR\n A-->B'), {}, ctx))
    ).rejects.toThrow(/图表库加载失败/);
  });
});
