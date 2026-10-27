import MarkdownIt from 'markdown-it';
import type { LoadedPlugin, PluginContext, PluginManifest, PluginRegister } from './types';

/**
 * 内置插件注册表。
 * 每个内置插件通过 import 静态注册（一期不做磁盘动态扫描）；
 * manifest 仍按契约格式书写，未来第三方插件从用户目录动态加载时复用同一份 manager。
 */
import callout from '../../plugins/callout/register';
import headingNumber from '../../plugins/heading-number/register';
import mermaid from '../../plugins/mermaid/register';
import codebar from '../../plugins/codebar/register';
import katex from '../../plugins/katex/register';
import tableGfm from '../../plugins/table-gfm/register';
import dialogue from '../../plugins/dialogue/register';

const builtin: Array<{ manifest: PluginManifest; register: PluginRegister }> = [
  callout, headingNumber, mermaid, codebar, katex, tableGfm, dialogue,
];

type Listener = (event: string, ...args: unknown[]) => void;

export class PluginManager {
  private loaded: LoadedPlugin[] = [];
  private userConfig: Record<string, Record<string, unknown>> = {};
  private enabledMap: Record<string, boolean> = {};
  private mountQueue = new Map<string, (el: HTMLElement, code: string, cfg: Record<string, unknown>) => void>();
  private listeners: Listener[] = [];

  constructor() {
    for (const p of builtin) {
      this.loaded.push({ manifest: p.manifest, register: p.register, enabled: true });
      this.enabledMap[p.manifest.id] = true;
    }
  }

  /** 应用用户设置：插件启停 + 配置覆盖。 */
  applySettings(s: { plugins?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }> }) {
    const ps = s.plugins ?? {};
    for (const p of this.loaded) {
      const u = ps[p.manifest.id] ?? {};
      p.enabled = u.enabled !== false;
      if (u.config) this.userConfig[p.manifest.id] = u.config;
    }
  }

  /** 装配到 markdown-it 实例。 */
  buildMarkdownIt(): MarkdownIt {
    const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
    for (const p of this.loaded) {
      if (!p.enabled) continue;
      const ctx = this.makeCtx(p.manifest);
      p.register(md, ctx);
    }
    return md;
  }

  /** 预览 DOM 更新后，执行所有 onMount 钩子。 */
  runMounts(container: HTMLElement) {
    for (const [selector, fn] of this.mountQueue) {
      container.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        const code = el.dataset.code ?? '';
        const id = el.dataset.plugin ?? '';
        const cfg = this.userConfig[id] ?? {};
        fn(el, code, cfg);
      });
    }
  }

  list() {
    return this.loaded.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      enabled: p.enabled,
      config: this.userConfig[p.manifest.id] ?? {},
      configSchema: p.manifest.config ?? {},
    }));
  }

  private makeCtx(m: PluginManifest): PluginContext {
    return {
      config: this.userConfig[m.id] ?? {},
      onMount: (selector, fn) => {
        this.mountQueue.set(`${m.id}:${selector}`, fn);
      },
      bus: {
        on: (ev, fn) => this.listeners.push((e, ...a) => e === ev && fn(...a)),
        emit: (ev, ...a) => this.listeners.forEach((l) => l(ev, ...a)),
      },
    };
  }
}
