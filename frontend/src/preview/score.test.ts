import { describe, expect, it } from 'vitest';

// 插件是纯 JS（没有构建步骤），用动态 import 拿纯函数做单测。
// 这里只测「能在无 DOM 环境验证的部分」：占位生成、转义、双环境注册分支、
// 以及主线程分支在库加载失败时的行为。真正的 SVG 排版留给真机点验
// （vitest 配置 environment: 'node'，不引入 jsdom 是既有决定）。
const entryPath = '../../../plugins/score/entry.js';
type Entry = {
  placeholder: (code: string) => string;
  errorHtml: (message: string, code: string) => string;
  register: (md: unknown, ctx: FakeCtx) => void;
};

const mod = (await import(entryPath)) as unknown as Entry & {
  ensureViewBox: (svg: FakeSvg) => void;
};

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
}

interface FakeSvg {
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
}

function fakeSvg(attrs: Record<string, string>): FakeSvg {
  const map = { ...attrs };
  return {
    getAttribute: (k) => (k in map ? map[k] : null),
    setAttribute: (k, v) => {
      map[k] = String(v);
    },
  };
}

function harness(scope: string, load: () => Promise<unknown> = async () => ({})) {
  const fences: { langs: string[]; fn: FenceFn }[] = [];
  const mounts: { selector: string; fn: MountFn }[] = [];
  const ctx: FakeCtx = {
    env: { scope },
    onFence: (langs, fn) => fences.push({ langs, fn }),
    onMount: (selector, fn) => mounts.push({ selector, fn }),
    libs: { load },
  };
  return { ctx, fences, mounts };
}

function elWith(source: string | null): FakeEl {
  return { getAttribute: () => source, removeAttribute: () => {} };
}

describe('placeholder', () => {
  it('空围栏给提示，不产出可渲染容器', () => {
    const html = mod.placeholder('   \n  ');
    expect(html).toContain('ge-score--empty');
    expect(html).not.toContain('data-code');
  });

  it('非空源码放进 data-code', () => {
    const html = mod.placeholder('X:1\nK:C\nC D E');
    expect(html).toContain('class="ge-score"');
    expect(html).toContain('data-code="X:1');
  });

  it('源码里的引号与尖括号必须转义，否则会截断属性', () => {
    const html = mod.placeholder('T:"小星星" <b>');
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

describe('errorHtml', () => {
  it('错误消息与源码都转义后落进卡片', () => {
    const html = mod.errorHtml('bad <abc>', 'K:C "x"');
    expect(html).toContain('ge-score__error');
    expect(html).toContain('&lt;abc&gt;');
    expect(html).toContain('&quot;x&quot;');
  });
});

describe('register 的双环境分支', () => {
  it('Worker 侧注册三个围栏名，不注册 mount', () => {
    const { ctx, fences, mounts } = harness('worker');
    mod.register({}, ctx);
    expect(fences).toHaveLength(1);
    expect(fences[0].langs).toEqual(['music', 'abc', 'score']);
    expect(mounts).toHaveLength(0);
  });

  it('围栏回调直接复用 placeholder 的输出', () => {
    const { ctx, fences } = harness('worker');
    mod.register({}, ctx);
    expect(fences[0].fn('', 'X:1\nK:C\nC')).toBe(mod.placeholder('X:1\nK:C\nC'));
  });

  it('主线程侧只注册 .ge-score 的 mount，不重复注册围栏', () => {
    const { ctx, fences, mounts } = harness('main');
    mod.register({}, ctx);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].selector).toBe('.ge-score');
    expect(fences).toHaveLength(0);
  });

  it('未知 scope 什么都不做', () => {
    const { ctx, fences, mounts } = harness('other');
    mod.register({}, ctx);
    expect(fences).toHaveLength(0);
    expect(mounts).toHaveLength(0);
  });
});

describe('ensureViewBox', () => {
  it('已有 viewBox 时不覆盖', () => {
    const svg = fakeSvg({ viewBox: '0 0 1 1', width: '770', height: '200' });
    mod.ensureViewBox(svg);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1 1');
  });

  it('缺 viewBox 时用 width / height 补出来', () => {
    const svg = fakeSvg({ width: '770', height: '210.5' });
    mod.ensureViewBox(svg);
    expect(svg.getAttribute('viewBox')).toBe('0 0 770 210.5');
  });

  it('没有尺寸时不猜，留空交给 CSS 兜底', () => {
    const svg = fakeSvg({});
    mod.ensureViewBox(svg);
    expect(svg.getAttribute('viewBox')).toBeNull();
  });
});

describe('主线程渲染的失败路径', () => {
  it('没有 data-code 时静默返回，不抛错', async () => {
    const { ctx, mounts } = harness('main');
    mod.register({}, ctx);
    await expect(Promise.resolve(mounts[0].fn(elWith(null), {}, ctx))).resolves.toBeUndefined();
  });

  it('库加载失败时抛出，交给管线显示挂载错误', async () => {
    const { ctx, mounts } = harness('main', () => Promise.reject(new Error('offline')));
    mod.register({}, ctx);
    await expect(
      Promise.resolve(mounts[0].fn(elWith('X:1\nK:C\nC'), {}, ctx))
    ).rejects.toThrow(/乐谱库加载失败/);
  });
});
