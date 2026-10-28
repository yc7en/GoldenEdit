/**
 * PluginContext 实现（ARCHITECTURE §5.5）。
 *
 * 关键约束：
 * - 同一份 entry.js 会在 Worker 与主线程各执行一次 register，用 `ctx.scope` 分支；
 * - Worker 侧 `onMount` 是空操作，主线程侧 `onFence / onContainer / onDelimiter` 是空操作；
 * - 所有字段是 getter，配置变更后下一次渲染立即拿到新值；
 * - 能力等级由运行时访问记录判定，不由 manifest 自述决定。
 */

import type { DocMeta, PluginCapability, PluginSpec, ThemePayload } from './protocol';

export type FenceHandler = (info: string, code: string, ctx: PluginContext) => string;
export type ContainerHandler = (
  name: string,
  body: string,
  attrs: Record<string, string>,
  ctx: PluginContext
) => string;
export type DelimiterHandler = (text: string, ctx: PluginContext) => string;
export type MountFn = (el: HTMLElement, payload: unknown, ctx: PluginContext) => void | (() => void);

export interface PluginContext {
  readonly env: {
    apiVersion: 1;
    hostVersion: string;
    locale: string;
    scope: 'worker' | 'main';
  };
  readonly config: Readonly<Record<string, unknown>>;
  readonly doc: Readonly<DocMeta>;
  readonly theme: Readonly<ThemePayload>;
  onFence(langs: string[], fn: FenceHandler): void;
  onContainer(names: string[], fn: ContainerHandler): void;
  onDelimiter(kind: 'inline' | 'block', fn: DelimiterHandler): void;
  onMount(selector: string, fn: MountFn): void;
  assets: { url(rel: string): string };
  libs: { load(name: 'mermaid' | 'katex'): Promise<unknown> };
  log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void;
  onCoreRule?(fn: (state: unknown) => void): void;
}

export interface MountEntry {
  selector: string;
  fn: MountFn;
}

export interface RuntimeEvents {
  log: (level: 'info' | 'warn' | 'error', pluginId: string, message: string) => void;
  loadFail: (pluginId: string, message: string) => void;
}

const HOST_VERSION = '0.1.0';
const API_VERSION = 1;

/** 单个插件的运行时状态。 */
export class PluginRuntime {
  readonly spec: PluginSpec;
  readonly fence = new Map<string, FenceHandler>();
  readonly container = new Map<string, ContainerHandler>();
  readonly inlineDelims: DelimiterHandler[] = [];
  readonly mounts: MountEntry[] = [];
  /** 运行时探测：插件实际用了哪些受限口子 */
  readonly accessed = new Set<string>();
  coreRuleHook: ((state: unknown) => void) | null = null;
  ctx: PluginContext;
  loaded = true;
  error: string | null = null;

  constructor(
    spec: PluginSpec,
    readonly scope: 'worker' | 'main',
    readonly baseUrl: string,
    readonly events: RuntimeEvents
  ) {
    this.spec = spec;
    this.ctx = this.buildContext();
  }

  get capability(): PluginCapability {
    if (this.spec.entryUrl === undefined) return 'L0';
    if (this.accessed.has('net') || this.accessed.has('fs')) return 'L3';
    if (this.accessed.has('mount')) return 'L2';
    return 'L1';
  }

  private buildContext(): PluginContext {
    return createPluginContext(this);
  }

  docMeta: Readonly<DocMeta> = {
    path: '',
    name: '',
    dir: '',
    frontmatter: {},
  };
  themePayload: Readonly<ThemePayload> = { mode: 'light', tokens: {} };

  setDoc(doc: DocMeta): void {
    this.docMeta = doc;
  }
  setTheme(theme: ThemePayload): void {
    this.themePayload = theme;
  }

  /** register 抛错只影响该插件（§5.7） */
  async load(mdFacade: unknown): Promise<boolean> {
    if (!this.spec.entryUrl) return true;
    try {
      const mod = (await import(/* @vite-ignore */ this.spec.entryUrl)) as {
        register?: (md: unknown, ctx: PluginContext) => void;
        default?: (md: unknown, ctx: PluginContext) => void;
      };
      const register = mod.register ?? mod.default;
      if (typeof register !== 'function') {
        throw new Error('entry.js 未导出 register()');
      }
      await withTimeout(
        Promise.resolve(register(mdFacade, this.ctx)),
        2000,
        `插件 ${this.spec.id} 注册超时`
      );
      return true;
    } catch (err) {
      this.loaded = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.events.loadFail(this.spec.id, this.error);
      return false;
    }
  }
}

const libCache = new Map<string, Promise<unknown>>();

function loadLib(name: 'mermaid' | 'katex'): Promise<unknown> {
  let hit = libCache.get(name);
  if (!hit) {
    hit =
      name === 'mermaid'
        ? import('mermaid').then((m) => m.default)
        : import('katex').then((m) => m.default);
    libCache.set(name, hit);
  }
  return hit;
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** 插件运行时的注册表：一个 scope 一份。 */
export class RuntimeRegistry {
  readonly runtimes = new Map<string, PluginRuntime>();

  constructor(
    private readonly scope: 'worker' | 'main',
    private readonly baseUrl: string,
    private readonly events: RuntimeEvents
  ) {}

  async loadAll(specs: PluginSpec[], doc: DocMeta, theme: ThemePayload, mdFacade: unknown): Promise<void> {
    this.runtimes.clear();
    const jobs = specs.map(async (spec) => {
      const rt = new PluginRuntime(spec, this.scope, this.baseUrl, this.events);
      rt.setDoc(doc);
      rt.setTheme(theme);
      this.runtimes.set(spec.id, rt);
      await rt.load(mdFacade);
    });
    await Promise.all(jobs);
  }

  setDoc(doc: DocMeta): void {
    for (const rt of this.runtimes.values()) rt.setDoc(doc);
  }

  setTheme(theme: ThemePayload): void {
    for (const rt of this.runtimes.values()) rt.setTheme(theme);
  }
}

function createPluginContext(runtime: PluginRuntime): PluginContext {
  const config = () => runtime.spec.config ?? {};
  const forbidden = (name: string) => ({
    get() {
      runtime.accessed.add(name);
      throw new Error(`插件不允许使用 ${name}：宿主未开放该能力（ARCHITECTURE §5.5）`);
    },
  });

  const raw: PluginContext = {
    get env() {
      return {
        apiVersion: API_VERSION as 1,
        hostVersion: HOST_VERSION,
        locale: 'zh-CN',
        scope: runtime.scope,
      };
    },
    get config() {
      return config();
    },
    get doc() {
      return runtime.docMeta;
    },
    get theme() {
      return runtime.themePayload;
    },
    onFence(langs, fn) {
      if (runtime.scope !== 'worker') return;
      for (const lang of langs) runtime.fence.set(lang.toLowerCase(), fn);
    },
    onContainer(names, fn) {
      if (runtime.scope !== 'worker') return;
      for (const name of names) runtime.container.set(name.toLowerCase(), fn);
    },
    onDelimiter(kind, fn) {
      if (runtime.scope !== 'worker') return;
      if (kind === 'inline') runtime.inlineDelims.push(fn);
    },
    onMount(selector, fn) {
      runtime.accessed.add('mount');
      if (runtime.scope !== 'main') return;
      runtime.mounts.push({ selector, fn });
    },
    assets: {
      url(rel: string) {
        if (rel.includes('..') || rel.startsWith('/')) {
          throw new Error(`非法资源路径：${rel}`);
        }
        return `${runtime.baseUrl}plugin/${runtime.spec.id}/${rel}`;
      },
    },
    libs: {
      async load(name: 'mermaid' | 'katex') {
        if (runtime.scope === 'worker') {
          throw new Error('libs.load 只能在主线程调用');
        }
        return loadLib(name);
      },
    },
    log(level, message, detail) {
      runtime.events.log(level, runtime.spec.id, detail ? `${message} ${String(detail)}` : message);
    },
    onCoreRule(fn) {
      if (runtime.spec.trust !== 'builtin' || runtime.scope !== 'worker') return;
      runtime.coreRuleHook = fn;
    },
  };

  // 受限成员用显式 getter 拒绝并记录访问：比让插件「用不到但能拿到」安全，
  // 同时给能力分级提供依据（§5.4）。
  Object.defineProperty(raw, 'net', forbidden('net'));
  Object.defineProperty(raw, 'fs', forbidden('fs'));
  return raw;
}
