import { describe, expect, it } from 'vitest';

// 对白插件是纯 JS：动态 import 后拿 register 的行为做断言。
// 这里钉住的是「围栏与容器两种写法产出同一份 HTML」——新写法不再往文档里推，
// 但存量 `::: dialogue` 必须继续渲染，不能再退化成一段带冒号的普通文本。
const entryPath = '../../../plugins/dialogue/entry.js';

interface FakeCtx {
  env: { scope: string };
  onContainer: (names: string[], fn: (name: string, body: string) => string) => void;
  onFence: (langs: string[], fn: (info: string, code: string) => string) => void;
}

const mod = (await import(entryPath)) as unknown as {
  register: (md: unknown, ctx: FakeCtx) => void;
};

function harness(scope = 'worker') {
  const containers: { names: string[]; fn: (name: string, body: string) => string }[] = [];
  const fences: { langs: string[]; fn: (info: string, code: string) => string }[] = [];
  const ctx: FakeCtx = {
    env: { scope },
    onContainer: (names, fn) => containers.push({ names, fn }),
    onFence: (langs, fn) => fences.push({ langs, fn }),
  };
  return { ctx, containers, fences };
}

const BODY = ['旁白: 评审会开始。', '技术主管(右): 全部完成！', '产品经理：准予发布。'].join('\n');

describe('对白插件注册', () => {
  it('worker 侧同时认容器与围栏三种名字', () => {
    const { ctx, containers, fences } = harness();
    mod.register({}, ctx);
    expect(containers[0].names).toEqual(['dialogue', 'dialog', 'chat']);
    expect(fences[0].langs).toEqual(['dialogue', 'dialog', 'chat']);
  });

  it('主线程侧不注册任何东西（纯渲染插件）', () => {
    const { ctx, containers, fences } = harness('main');
    mod.register({}, ctx);
    expect(containers).toHaveLength(0);
    expect(fences).toHaveLength(0);
  });
});

describe('围栏与容器等价', () => {
  it('同一段正文两种入口产出完全相同的气泡结构', () => {
    const { ctx, containers, fences } = harness();
    mod.register({}, ctx);
    const viaContainer = containers[0].fn('dialogue', BODY);
    const viaFence = fences[0].fn('dialogue', BODY);
    expect(viaFence).toBe(viaContainer);
  });

  it('旁白默认左对齐，`(右)` 与用户名走右侧', () => {
    const { ctx, containers } = harness();
    mod.register({}, ctx);
    const html = containers[0].fn('dialogue', BODY);
    expect(html).toContain('ge-bubble--left');
    expect(html).toContain('ge-bubble--right');
    // 角色名里的 (右) 标记要摘掉，不能显示成「技术主管(右)」
    expect(html).toContain('技术主管');
    expect(html).not.toContain('技术主管(右)');
  });

  it('全角冒号也认，中文名不会被当成正文', () => {
    const { ctx, containers } = harness();
    mod.register({}, ctx);
    const html = containers[0].fn('dialogue', '产品经理：准予发布。');
    expect(html).toContain('产品经理');
    expect(html).toContain('准予发布。');
  });

  it('行内 Markdown 交给 md.renderInline，富文本在气泡里照常生效', () => {
    const { ctx, containers } = harness();
    const md = { renderInline: (t: string) => `<em>${t}</em>` };
    mod.register(md, ctx);
    expect(containers[0].fn('dialogue', '用户: 请帮我看看')).toContain('<em>请帮我看看</em>');
  });

  it('没有 md 时退回转义，尖括号不会变成标签', () => {
    const { ctx, containers } = harness();
    mod.register(undefined, ctx);
    const html = containers[0].fn('dialogue', '旁白: <script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('空行与空正文不产出空气泡', () => {
    const { ctx, containers } = harness();
    mod.register({}, ctx);
    expect(containers[0].fn('dialogue', '\n\n  \n')).toBe('<div class="ge-dialogue"></div>');
  });
});
