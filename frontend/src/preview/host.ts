import type { PluginManifest, ServerInfo, Settings } from '../bridge/types';
import type { PreviewMessage, PluginSpec, RenderOptions, ThemePayload } from '../../preview-shell/protocol';
import { PREVIEW_TOKENS, resolveMode } from '../theme/tokens';

import { isPluginEnabled } from '../store';

/**
 * 插件清单 → 预览侧 spec。内置插件默认启用（§5.9），
 * 所以这里不能只看 settings.plugins.enabled 名单。
 */
function enabledPlugins(settings: Settings, plugins: PluginManifest[]): PluginManifest[] {
  return plugins.filter((p) => isPluginEnabled(settings, p));
}

export interface RenderInfo {
  blocks: number;
  ms: number;
  chars: number;
  parseMs: number;
  loopMs: number;
  rules: Record<string, number>;
  xferMs: number;
  domMs: number;
  submitted: number;
}

export interface PreviewCallbacks {
  onJump: (line: number) => void;
  onOutline: (items: { level: number; text: string; line: number }[]) => void;
  onRendered: (
    info: RenderInfo & { plugins: string[]; errors: { message: string; line: number }[] }
  ) => void;  onLog: (level: string, message: string) => void;
  onOpenExternal: (url: string) => void;
  /** 预览区右键：坐标已换算到主页面视口（§8.3） */
  onContextMenu?: (info: { x: number; y: number; text: string }) => void;
  onPaused: (paused: boolean) => void;
  onFatal: (message: string) => void;
}

const DEBOUNCE = 150;
const READY_TIMEOUT = 6000;

/**
 * L2 侧的预览宿主：负责 iframe 生命周期、握手、防抖与代际号。
 * 渲染本身一概不管——那是 L3 的事（ARCHITECTURE §2.1）。
 */
export class PreviewHost {
  private iframe: HTMLIFrameElement;
  private cb: PreviewCallbacks;
  private server: ServerInfo | null = null;
  private ready = false;
  private inited = false;
  private gen = 0;
  private pending: string | null = null;
  private timer: number | null = null;
  private readyTimer: number | null = null;
  private settings!: Settings;
  private plugins: PluginManifest[] = [];
  private docPath = '';
  private width = 980;
  private themeMode: 'light' | 'dark' = 'light';
  paused = false;
  private lastText = '';
  /**
   * 性能探针等待位。必须带代际号：晚到的旧批次 rendered 不能顶替这一次的结果
   * （真机上就踩过：2MB 样本拿到的是启动文档的耗时）。
   */
  private renderWaiter: {
    gen: number | null;
    fn: (info: RenderInfo) => void;
  } | null = null;
  /**
   * 主线程侧的分段计时（§13.1 诊断用）。
   * wall = 防抖 + 投递 + xfer + 建 DOM + 回程，缺哪一段就是卡在哪一段。
   */
  timing = { pushAt: 0, firedAt: 0, sentAt: 0, renderedAt: 0 };

  constructor(iframe: HTMLIFrameElement, cb: PreviewCallbacks) {
    this.iframe = iframe;
    this.cb = cb;
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  configure(settings: Settings, plugins: PluginManifest[]): void {
    this.settings = settings;
    this.plugins = plugins;
    this.width = settings.preview.width;
    this.themeMode = resolveMode(settings.theme.preview);
  }

  async attach(server: ServerInfo): Promise<void> {
    this.server = server;
    this.reload();
  }

  /** 插件启停或配置变更后重建 iframe（§5.10：重建而不是热替换 register） */
  rebuild(settings: Settings, plugins: PluginManifest[]): void {
    this.configure(settings, plugins);
    this.reload();
  }

  private reload(): void {
    if (!this.server) return;
    this.ready = false;
    this.inited = false;
    this.clearReadyTimer();
    this.iframe.src = `${this.server.origin}/p/${this.server.token}/shell/`;
    this.readyTimer = window.setTimeout(() => {
      if (!this.ready) this.cb.onFatal('预览外壳 6 秒内未就绪，可能是预览服务未启动');
    }, READY_TIMEOUT);
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  setWidth(width: number): void {
    this.width = width;
    this.post({ type: 'width', width });
  }

  setDocPath(path: string, name: string): void {
    this.docPath = path;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    this.post({ type: 'doc-meta', doc: { path, name, dir, frontmatter: {} } });
  }

  /** 主题变更：只推 token，不重建 iframe；块 key 含 themeMode，L3 会自行重渲染 */
  setTheme(settings: Settings): void {
    this.settings = settings;
    this.themeMode = resolveMode(settings.theme.preview);
    this.post({ type: 'theme', theme: this.themePayload() });
  }

  /**
   * 推一次内容并等这一次渲染完成。
   * 性能探针专用：必须等到「这次 push」的结果，不能拿上一次渲染的耗时充数。
   */
  pushAndWait(
    text: string,
    timeoutMs = 60_000
  ): Promise<RenderInfo> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.renderWaiter = null;
        reject(new Error('渲染超时'));
      }, timeoutMs);
      this.renderWaiter = {
        gen: null,
        fn: (info) => {
          clearTimeout(timer);
          resolve(info);
        },
      };
      this.push(text);
    });
  }

  push(text: string): void {
    this.lastText = text;
    const limit = (this.settings.preview.pauseAboveMb || 10) * 1024 * 1024;
    if (text.length > limit) {
      this.paused = true;
      this.cb.onPaused(true);
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.cb.onPaused(false);
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timing.pushAt = performance.now();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.timing.firedAt = performance.now();
      if (!this.inited) {
        // 外壳还没握手：先存起来，init 时用同一个代际号补发（等待位在这里绑不上）
        this.pending = text;
        return;
      }
      this.post({ type: 'doc', gen: this.nextGen(), text });
      this.timing.sentAt = performance.now();
    }, DEBOUNCE);
  }

  /**
   * 递增代际号，并把这次的号码绑到等待位上——晚到的旧批次（gen 更小）一律不消费。
   * init 补发首次渲染时也必须走这里，否则「握手前就订阅了渲染完成」的等待位
   * 永远对不上号，只能等到超时。
   */
  private nextGen(): number {
    this.gen += 1;
    if (this.renderWaiter && this.renderWaiter.gen === null) this.renderWaiter.gen = this.gen;
    return this.gen;
  }

  /** 大文档暂停后手动恢复 */
  resume(): void {
    this.paused = false;
    this.cb.onPaused(false);
    this.push(this.lastText);
  }

  remount(): void {
    this.post({ type: 'remount' });
  }

  requestExport(id: number, title: string): void {
    this.post({ type: 'export', id, title });
  }

  /** PDF 降级：让 L3 调 window.print()，用户在打印设置里选「另存为 PDF」 */
  requestPrint(): void {
    this.post({ type: 'print' });
  }

  /**
   * 目标 origin 只能是 `*`：sandbox="allow-scripts" 的 iframe 文档源是 opaque（`null`），
   * 指定具体 origin 时浏览器会直接丢弃消息。安全性由 src 的 token 与上文的 e.source 校验承担。
   */
  private post(msg: unknown): void {
    if (!this.server) return;
    this.iframe.contentWindow?.postMessage(msg, '*');
  }

  private themePayload(): ThemePayload {
    return {
      mode: this.themeMode,
      tokens: PREVIEW_TOKENS[this.themeMode],
      customCss: this.settings.preview.customCss ?? '',
    };
  }

  private pluginSpecs(): PluginSpec[] {
    if (!this.server) return [];
    const cfg = this.settings.plugins.config;
    const base = `${this.server.origin}/p/${this.server.token}`;
    return enabledPlugins(this.settings, this.plugins)
      .map((p) => {
        const defaults: Record<string, unknown> = {};
        for (const [key, field] of Object.entries(p.config ?? {})) defaults[key] = field.default;
        return {
          id: p.id,
          name: p.name,
          version: p.version,
          trust: p.trust,
          capability: p.capability,
          entryUrl: p.entry ? `${base}/${p.base}/${p.entry}` : undefined,
          styleUrl: p.style ? `${base}/${p.base}/${p.style}` : undefined,
          match: p.match,
          config: { ...defaults, ...(cfg[p.id] ?? {}) },
        };
      });
  }

  private onMessage(e: MessageEvent): void {
    if (!this.server) return;
    // 只看 source：沙箱 iframe 发来的消息 origin 恒为 "null"，按 URL 比对会把握手消息全丢掉
    if (e.source !== this.iframe.contentWindow) return;
    if (e.origin !== 'null' && e.origin !== this.server.origin) return;
    const msg = e.data as PreviewMessage;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.clearReadyTimer();
        this.init();
        break;
      case 'rendered':
        this.timing.renderedAt = performance.now();
        this.cb.onRendered({
          blocks: msg.blocks,
          ms: msg.ms,
          chars: msg.chars,
          submitted: msg.submitted,
          parseMs: msg.parseMs,
          loopMs: msg.loopMs,
          rules: msg.rules ?? {},
          xferMs: msg.xferMs ?? 0,
          domMs: msg.domMs ?? 0,
          plugins: msg.plugins,
          errors: msg.errors,
        });
        if (this.renderWaiter && this.renderWaiter.gen === msg.gen) {
          const waiter = this.renderWaiter;
          this.renderWaiter = null;
          waiter.fn({
            blocks: msg.blocks,
            ms: msg.ms,
            chars: msg.chars,
            submitted: msg.submitted,
            parseMs: msg.parseMs,
            loopMs: msg.loopMs,
            rules: msg.rules ?? {},
            xferMs: msg.xferMs ?? 0,
            domMs: msg.domMs ?? 0,
          });
        }
        break;
      case 'outline':
        this.cb.onOutline(msg.items);
        break;
      case 'jump':
        this.cb.onJump(msg.line);
        break;
      case 'open-external':
        this.cb.onOpenExternal(msg.url);
        break;
      case 'ctx-menu': {
        // iframe 报的是相对它自己的坐标，弹菜单要用主页面的
        const rect = this.iframe.getBoundingClientRect();
        this.cb.onContextMenu?.({
          x: rect.left + msg.x,
          y: rect.top + msg.y,
          text: msg.text,
        });
        break;
      }
      case 'log':
        this.cb.onLog(msg.level, msg.message);
        break;
      case 'fatal':
        this.cb.onFatal(msg.message);
        break;
      case 'exported':
        window.dispatchEvent(new CustomEvent('ge:exported', { detail: msg }));
        break;
      default:
        break;
    }
  }

  private init(): void {
    const text = this.pending ?? this.lastText ?? '';
    this.pending = null;
    const dir = this.docPath.includes('/') ? this.docPath.slice(0, this.docPath.lastIndexOf('/')) : '';
    const options: RenderOptions = { paused: false, fullRenderLimit: 200 * 1024, shardLimit: 2 * 1024 * 1024 };
    this.post({
      type: 'init',
      protocol: 1,
      hostVersion: '0.1.0',
      plugins: this.pluginSpecs(),
      theme: this.themePayload(),
      doc: {
        path: this.docPath,
        name: this.docPath.split('/').pop() ?? '',
        dir,
        frontmatter: {},
      },
      options,
    });
    this.post({ type: 'width', width: this.width });
    this.inited = true;
    if (text) {
      this.post({ type: 'doc', gen: this.nextGen(), text });
    }
  }
}
