import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// 思维导图插件是纯 JS（无构建步骤），动态 import 拿它的注册行为做单测。
// 环境是 node：这里只验证「双环境分支、占位转义、缩放算术、错误降级、传给 markmap
// 的参数」这类不依赖真实排版的部分；SVG 出来长什么样留给真机点验（既有决定：不引 jsdom）。
const entryPath = '../../../plugins/markmap/entry.js';

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
  removeAttribute: (name: string) => void;
  innerHTML: string;
  clientWidth: number;
  classList: { add: (c: string) => void; has: (c: string) => boolean };
}

const mod = (await import(entryPath)) as unknown as {
  register: (md: unknown, ctx: FakeCtx) => void;
  placeholder: (code: string) => string;
  viewBoxOf: (bounds: { x: number; y: number; width: number; height: number }, pad?: number) => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFor: (natural: number, container: number) => number;
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
  const attrs = new Map<string, string | null>(source === null ? [] : [['data-code', source]]);
  return {
    getAttribute: (name) => attrs.get(name) ?? null,
    removeAttribute: (name) => void attrs.delete(name),
    innerHTML: '',
    clientWidth: width,
    classList: { add: (c) => void classes.add(c), has: (c) => classes.has(c) },
  };
}

/** 插件只用 getComputedStyle 取左右 padding 与 fontFamily，按需造一个最小实现 */
function stubComputedStyle(): void {
  (globalThis as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({
    paddingLeft: '12px',
    paddingRight: '12px',
    fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
  });
}

/** markmap 的假实现：只回填插件真正读的那几个函数 */
function fakeLib(over: Record<string, unknown> = {}) {
  const seen: Record<string, unknown> = {};
  const lib = {
    parse: {
      parse: () => ({ root: { id: 'root', content: '', children: [] } }),
    },
    render: {
      classicTheme: { font: { family: 'sans-serif', size: 16 }, tokens: {} },
      createCanvasMeasurer: () => ({ measure: () => 10 }),
      renderTreeAsync: async (root: unknown, opts: Record<string, unknown>) => {
        seen.root = root;
        seen.opts = opts;
        return { primitives: [], bounds: { x: 0, y: 0, width: 1000, height: 400 } };
      },
      primitivesToSVG: (_p: unknown, opts: Record<string, unknown>) => {
        seen.svgOpts = opts;
        return '<g id="body"></g>';
      },
    },
    seen,
    ...over,
  };
  return lib;
}

beforeEach(stubComputedStyle);
afterEach(() => {
  delete (globalThis as unknown as { getComputedStyle?: unknown }).getComputedStyle;
});

describe('Worker 侧的占位', () => {
  it('注册 markmap / mindmap 两个围栏名，不注册 mount', () => {
    const { ctx, fences, mounts } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    expect(fences).toHaveLength(1);
    expect(fences[0].langs).toEqual(['markmap', 'mindmap']);
    expect(mounts).toHaveLength(0);
  });

  it('源码里的引号与尖括号必须转义，否则会截断 data-code 属性', () => {
    const { ctx, fences } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    const html = fences[0].fn('', '# 根\n- <b>粗</b> 与 "引号"');
    expect(html).toContain('data-code="# 根');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('空围栏给一句提示，不产出可渲染容器', () => {
    const { ctx, fences } = harness('worker', async () => ({}));
    mod.register({}, ctx);
    const html = fences[0].fn('', '  \n ');
    expect(html).toContain('ge-markmap--empty');
    expect(html).not.toContain('data-code');
  });
});

describe('主线程侧的注册', () => {
  it('只注册 .ge-markmap 的 mount，不重复注册围栏', () => {
    const { ctx, fences, mounts } = harness('main', async () => ({}));
    mod.register({}, ctx);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].selector).toBe('.ge-markmap');
    expect(fences).toHaveLength(0);
  });

  it('库走 libs 白名单，名字是 markmap', async () => {
    const { ctx, mounts, calls } = harness('main', async () => fakeLib());
    mod.register({}, ctx);
    await mounts[0].fn(fakeEl('# 根'), { key: 'k1' }, ctx);
    expect(calls).toEqual(['markmap']);
  });

  it('没有 data-code 时静默返回，不碰库', async () => {
    const { ctx, mounts, calls } = harness('main', async () => fakeLib());
    mod.register({}, ctx);
    await expect(Promise.resolve(mounts[0].fn(fakeEl(null), {}, ctx))).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('主线程渲染', () => {
  it('把 SVG 塞进容器、标记 ready，并摘掉 data-code 防重复渲染', async () => {
    const el = fakeEl('# 根\n## 子');
    const { ctx, mounts } = harness('main', async () => fakeLib());
    mod.register({}, ctx);
    await mounts[0].fn(el, { key: 'k1' }, ctx);
    expect(el.innerHTML).toContain('<svg class="ge-markmap__svg"');
    expect(el.innerHTML).toContain('<g id="body"></g>');
    expect(el.innerHTML).toContain('<title>思维导图</title>');
    expect(el.classList.has('ge-markmap--ready')).toBe(true);
    expect(el.getAttribute('data-code')).toBeNull();
  });

  it('图元按静态渲染：interactive 关掉，不产出命中区域', async () => {
    const lib = fakeLib();
    const { ctx, mounts } = harness('main', async () => lib);
    mod.register({}, ctx);
    await mounts[0].fn(fakeEl('# 根'), {}, ctx);
    expect(lib.seen.svgOpts).toEqual({ interactive: false });
  });

  it('测量字体取容器实际字体，否则标签宽度算不准会挤字', async () => {
    const lib = fakeLib();
    const { ctx, mounts } = harness('main', async () => lib);
    mod.register({}, ctx);
    await mounts[0].fn(fakeEl('# 根'), {}, ctx);
    const opts = lib.seen.opts as { theme: { font: { family: string } } };
    expect(opts.theme.font.family).toBe('Segoe UI, Microsoft YaHei, sans-serif');
  });

  it('宽度取内容盒（扣掉左右 padding），并把 SVG 缩到容器宽', async () => {
    const el = fakeEl('# 根', 700);
    const { ctx, mounts } = harness('main', async () => fakeLib());
    mod.register({}, ctx);
    await mounts[0].fn(el, {}, ctx);
    // 自然宽 1000 + 左右留白 12×2 = 1024；容器内容盒 700 − 24 = 676
    const width = Number(/width="([\d.]+)"/.exec(el.innerHTML)?.[1]);
    expect(width).toBeCloseTo(676, 0);
  });
});

describe('缩放宽度的算术', () => {
  it('容器够宽时不放大，只按自然尺寸出图', () => {
    expect(mod.scaleFor(400, 676)).toBe(1);
  });

  it('图比容器宽时等比缩到容器宽', () => {
    expect(mod.scaleFor(800, 676)).toBeCloseTo(0.845, 3);
  });

  it('缩放下限 0.6：深图宁可横向滚动，也不压成看不清的尺寸', () => {
    expect(mod.scaleFor(5000, 676)).toBe(0.6);
  });

  it('容器量不到宽度时按 1 处理，别因为一次量宽失败把图压成一条缝', () => {
    expect(mod.scaleFor(1024, 0)).toBe(1);
    expect(mod.scaleFor(0, 676)).toBe(1);
  });

  it('viewBox 在包围盒外扩留白，空包围盒也不产出 0 宽高', () => {
    expect(mod.viewBoxOf({ x: -2, y: -3, width: 100, height: 40 })).toEqual({
      x: -14,
      y: -15,
      width: 124,
      height: 64,
    });
    expect(mod.viewBoxOf({ x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: -12,
      y: -12,
      width: 24,
      height: 24,
    });
  });
});

describe('错误处理', () => {
  it('排版抛错时给错误卡片，源码一并显示', async () => {
    const lib = fakeLib();
    lib.render.renderTreeAsync = async () => {
      throw new Error('无法测量节点');
    };
    const el = fakeEl('# 根');
    const { ctx, mounts } = harness('main', async () => lib);
    mod.register({}, ctx);
    await mounts[0].fn(el, {}, ctx);
    expect(el.innerHTML).toContain('ge-markmap__error');
    expect(el.innerHTML).toContain('无法测量节点');
    expect(el.innerHTML).toContain('ge-markmap__source');
    expect(el.classList.has('ge-markmap--ready')).toBe(false);
  });

  it('错误消息里的尖括号必须转义，不能被当成标签', async () => {
    const lib = fakeLib();
    lib.render.renderTreeAsync = async () => {
      throw new Error('<script>x</script>');
    };
    const el = fakeEl('# 根');
    const { ctx, mounts } = harness('main', async () => lib);
    mod.register({}, ctx);
    await mounts[0].fn(el, {}, ctx);
    expect(el.innerHTML).toContain('&lt;script&gt;');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('库加载失败时抛出，交给管线显示可重试的挂载错误', async () => {
    const { ctx, mounts } = harness('main', () => Promise.reject(new Error('offline')));
    mod.register({}, ctx);
    await expect(Promise.resolve(mounts[0].fn(fakeEl('# 根'), {}, ctx))).rejects.toThrow(
      /思维导图库加载失败/
    );
  });
});
