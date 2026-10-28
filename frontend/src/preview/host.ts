import type { PluginManifest, ServerInfo, Settings } from '../bridge/types';
import type { PreviewMessage, PluginSpec, RenderOptions, ThemePayload } from '../../preview-shell/protocol';
import { PREVIEW_TOKENS, resolveMode } from '../theme/tokens';

export interface PreviewCallbacks {
  onJump: (line: number) => void;
  onOutline: (items: { level: number; text: string; line: number }[]) => void;
  onRendered: (info: { blocks: number; ms: number; plugins: string[]; errors: { message: string; line: number }[] }) => void;
  onLog: (level: string, message: string) => void;
  onOpenExternal: (url: string) => void;
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
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.inited) {
        this.pending = text;
        return;
      }
      this.gen += 1;
      this.post({ type: 'doc', gen: this.gen, text });
    }, DEBOUNCE);
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
    return { mode: this.themeMode, tokens: PREVIEW_TOKENS[this.themeMode] };
  }

  private pluginSpecs(): PluginSpec[] {
    if (!this.server) return [];
    const enabled = new Set(this.settings.plugins.enabled);
    const cfg = this.settings.plugins.config;
    const base = `${this.server.origin}/p/${this.server.token}`;
    return this.plugins
      .filter((p) => enabled.has(p.id))
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
        this.cb.onRendered({
          blocks: msg.blocks,
          ms: msg.ms,
          plugins: msg.plugins,
          errors: msg.errors,
        });
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
      this.gen += 1;
      this.post({ type: 'doc', gen: this.gen, text });
    }
  }
}
