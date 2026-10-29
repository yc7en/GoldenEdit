import { describe, expect, it } from 'vitest';

import { PluginRuntime, withTimeout, type RuntimeEvents } from './context';
import type { PluginSpec } from './protocol';

const events: RuntimeEvents = { log: () => {}, loadFail: () => {} };

function spec(partial: Partial<PluginSpec> = {}): PluginSpec {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    trust: 'builtin',
    capability: 'L1',
    entryUrl: 'http://127.0.0.1:1/plugin/demo/entry.js',
    match: {},
    config: { startLevel: 2 },
    ...partial,
  };
}

describe('能力分级（运行时访问记录，§5.4）', () => {
  it('没有 entry 即 L0（纯样式插件）', () => {
    const rt = new PluginRuntime(spec({ entryUrl: undefined }), 'worker', 'http://h/', events);
    expect(rt.capability).toBe('L0');
  });

  it('只注册围栏 / 容器即 L1', () => {
    const rt = new PluginRuntime(spec(), 'worker', 'http://h/', events);
    rt.ctx.onFence(['mermaid'], () => '<div></div>');
    rt.ctx.onContainer(['note'], () => '<div></div>');
    expect(rt.capability).toBe('L1');
    expect(rt.fence.has('mermaid')).toBe(true);
    expect(rt.container.has('note')).toBe(true);
  });

  it('用了 onMount 升到 L2，且 Worker 侧不登记挂载点', () => {
    const rt = new PluginRuntime(spec(), 'worker', 'http://h/', events);
    rt.ctx.onMount('.x', () => {});
    expect(rt.capability).toBe('L2');
    // Worker 里没有 DOM，mount 只计能力不登记
    expect(rt.mounts).toHaveLength(0);
  });

  it('访问受限成员直接抛错并降级为 L3', () => {
    const rt = new PluginRuntime(spec(), 'worker', 'http://h/', events);
    expect(() => (rt.ctx as unknown as { net: unknown }).net).toThrow(/不允许使用 net/);
    expect(rt.capability).toBe('L3');
  });

  it('主线程 scope 下 onFence 是空操作（解析只在 Worker 做）', () => {
    const rt = new PluginRuntime(spec(), 'main', 'http://h/', events);
    rt.ctx.onFence(['mermaid'], () => '<div></div>');
    rt.ctx.onMount('.x', () => {});
    expect(rt.fence.size).toBe(0);
    expect(rt.mounts).toHaveLength(1);
  });
});

describe('PluginContext 契约（§5.5）', () => {
  it('config / env / doc 都是 getter，改了下一次读就是新值', () => {
    const s = spec();
    const rt = new PluginRuntime(s, 'worker', 'http://h/', events);
    expect(rt.ctx.config.startLevel).toBe(2);
    s.config = { startLevel: 3 };
    expect(rt.ctx.config.startLevel).toBe(3);
    expect(rt.ctx.env.apiVersion).toBe(1);
    expect(rt.ctx.env.scope).toBe('worker');

    rt.setDoc({ path: 'a.md', name: 'a.md', dir: '', frontmatter: { title: 'x' } });
    expect(rt.ctx.doc.frontmatter.title).toBe('x');
  });

  it('assets.url 拼到插件自己的目录，拒绝穿越', () => {
    const rt = new PluginRuntime(spec(), 'worker', 'http://h/p/t/', events);
    expect(rt.ctx.assets.url('logo.svg')).toBe('http://h/p/t/plugin/demo/logo.svg');
    expect(() => rt.ctx.assets.url('../x.svg')).toThrow(/非法资源路径/);
    expect(() => rt.ctx.assets.url('/etc/passwd')).toThrow(/非法资源路径/);
  });

  it('onCoreRule 只对 builtin 开放（第三方插件拿不到核心规则钩子）', () => {
    const builtin = new PluginRuntime(spec(), 'worker', 'http://h/', events);
    builtin.ctx.onCoreRule?.(() => {});
    expect(builtin.coreRuleHook).not.toBeNull();

    const local = new PluginRuntime(spec({ trust: 'local' }), 'worker', 'http://h/', events);
    local.ctx.onCoreRule?.(() => {});
    expect(local.coreRuleHook).toBeNull();
  });
});

describe('withTimeout', () => {
  it('超时抛错', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, '超时了')).rejects.toThrow('超时了');
  });
  it('正常返回', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, '超时了')).resolves.toBe(7);
  });
});
