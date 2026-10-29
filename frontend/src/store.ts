import * as api from './bridge';
import type {
  Commit,
  Entry,
  LayoutMode,
  PluginManifest,
  ServerInfo,
  Settings,
  UiState,
  VaultInfo,
  VaultUiState,
} from './bridge/types';

export interface Tab {
  rel: string;
  name: string;
  text: string;
  savedText: string;
  mtime: number;
  dirty: boolean;
  line: number;
  col: number;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

type EventName =
  | 'vault'
  | 'tabs'
  | 'active'
  | 'tree'
  | 'plugins'
  | 'outline'
  | 'commits'
  | 'settings'
  | 'status'
  | 'render'
  | 'doc-text'
  | 'log'
  | 'toast'
  | 'draft'
  | 'commands'
  | 'keybindings';

type Handler = (payload?: unknown) => void;

class Bus {
  private map = new Map<EventName, Set<Handler>>();
  on(name: EventName, fn: Handler): () => void {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name)!.add(fn);
    return () => this.map.get(name)?.delete(fn);
  }
  emit(name: EventName, payload?: unknown): void {
    for (const fn of this.map.get(name) ?? []) fn(payload);
  }
}

export const bus = new Bus();

const EMPTY_SETTINGS: Settings = {
  theme: { preset: 'writing', editor: 'dark', preview: 'light' },
  preview: { width: 980, syncScroll: false, pauseAboveMb: 10, customCss: '' },
  export: {
    format: 'html',
    width: 980,
    inlineImages: true,
    inlinePluginCss: true,
    inlinePluginScripts: false,
  },
  plugins: { enabled: [], disabled: [], config: {} },
  keybindings: {},
  layout: { sideWidth: 208, sideHidden: false },
  markdown: { taskDateFormat: 'YYYY年M月D日 HH:mm' },
  recents: [],
  lastVault: null,
};

/**
 * 插件是否启用（§5.9）。
 *
 * 内置插件**默认启用**——早先的实现只在「启用名单为空」时补一次默认值，
 * 结果是「后加的内置插件对老用户永远不可见」（markdown-tools 就是这么被漏掉的）。
 * 用户的显式停用记在 disabled 里，与「本地插件要先安装才能用」区分开。
 */
export function isPluginEnabled(settings: Settings, plugin: PluginManifest): boolean {
  if ((settings.plugins.disabled ?? []).includes(plugin.id)) return false;
  if (plugin.source.type === 'builtin') return true;
  return settings.plugins.enabled.includes(plugin.id);
}

class Store {  appVersion = '0.1.0';
  dataDir = '';
  vault: VaultInfo | null = null;
  tabs: Tab[] = [];
  activeRel: string | null = null;
  settings: Settings = structuredClone(EMPTY_SETTINGS);
  ui: UiState = {};
  plugins: PluginManifest[] = [];
  commits: Commit[] = [];
  outline: OutlineItem[] = [];
  tree = new Map<string, Entry[]>();
  expanded = new Set<string>();
  renderInfo = { blocks: 0, ms: 0, plugins: 0, errors: 0 };
  logs: { level: string; message: string }[] = [];
  previewServer: ServerInfo | null = null;
  /** 文件级剪贴板：只在应用内有效，不落盘、不跨实例（§8.3） */
  fileClip: { mode: 'copy' | 'cut'; rels: string[] } | null = null;
  private uiLoaded = false;
  private draftTimer: number | null = null;

  get activeTab(): Tab | null {
    return this.tabs.find((t) => t.rel === this.activeRel) ?? null;
  }

  get vaultUi(): VaultUiState {
    if (!this.vault) return {};
    this.ui.vaults ??= {};
    this.ui.vaults[this.vault.id] ??= { docs: {}, groups: {}, filesExpanded: [] };
    const v = this.ui.vaults[this.vault.id];
    v.docs ??= {};
    v.groups ??= {};
    return v;
  }

  docState(rel: string) {
    this.vaultUi.docs ??= {};
    this.vaultUi.docs[rel] ??= {};
    return this.vaultUi.docs[rel];
  }

  async init(): Promise<void> {
    const [info, settings] = await Promise.all([api.getAppInfo(), api.getSettings()]);
    this.appVersion = info.version;
    this.dataDir = info.dataDir;
    this.settings = settings;
    this.ui = await api.getUiState();
    this.uiLoaded = true;
    bus.emit('settings');
    if (settings.lastVault) {
      try {
        await this.openVaultPath(settings.lastVault, false);
      } catch {
        /* 上次的工作区可能已被移动或删除，静默失败 */
      }
    }
  }

  async openVaultDialog(): Promise<void> {
    const path = await api.pickFolder();
    if (!path) return;
    await this.openVaultPath(path, true);
  }

  async openVaultPath(path: string, remember: boolean): Promise<void> {
    const info = await api.openVault(path);
    this.vault = info;
    this.tabs = [];
    this.activeRel = null;
    this.tree.clear();
    this.expanded = new Set(this.vaultUi.filesExpanded ?? []);
    this.tree.set('', info.entries);
    bus.emit('vault');
    bus.emit('tabs');
    bus.emit('active');
    bus.emit('tree');

    if (remember) {
      this.settings.lastVault = info.root;
      const recents = [info.root, ...this.settings.recents.filter((r) => r !== info.root)].slice(0, 6);
      this.settings.recents = recents;
      await api.setSettings({ lastVault: info.root, recents });
    }

    await Promise.all([this.refreshPlugins(), this.refreshCommits()]);
    const last = this.vaultUi.lastFile;
    if (last) {
      try {
        await this.openFile(last);
      } catch {
        /* 上次打开的文件可能已删除 */
      }
    }
  }

  async refreshCommits(): Promise<void> {
    try {
      this.commits = await api.gitLog(12);
    } catch {
      this.commits = [];
    }
    bus.emit('commits');
  }

  async refreshPlugins(): Promise<void> {
    try {
      this.plugins = await api.scanPlugins();
    } catch (err) {
      this.plugins = [];
      console.error(err);
    }
    bus.emit('plugins');
  }

  /** 某个插件当前是否生效（§5.9 的判定，供预览与命令插件共用） */
  pluginEnabled(id: string): boolean {
    const plugin = this.plugins.find((p) => p.id === id);
    return plugin ? isPluginEnabled(this.settings, plugin) : false;
  }

  enabledPlugins(): PluginManifest[] {
    const on = new Set(this.settings.plugins.enabled);
    return this.plugins.filter((p) => on.has(p.id));
  }

  async loadDir(rel: string): Promise<Entry[]> {
    const cached = this.tree.get(rel);
    if (cached) return cached;
    const entries = await api.listDir(rel);
    this.tree.set(rel, entries);
    bus.emit('tree');
    return entries;
  }

  async toggleDir(rel: string): Promise<void> {
    if (this.expanded.has(rel)) {
      this.expanded.delete(rel);
    } else {
      this.expanded.add(rel);
      await this.loadDir(rel);
    }
    this.vaultUi.filesExpanded = [...this.expanded];
    void this.persistUi();
    bus.emit('tree');
  }

  async openFile(rel: string): Promise<void> {
    const existing = this.tabs.find((t) => t.rel === rel);
    if (existing) {
      this.activeRel = rel;
      bus.emit('active');
      return;
    }
    const doc = await api.readDoc(rel);
    const tab: Tab = {
      rel,
      name: rel.split('/').pop() ?? rel,
      text: doc.text,
      savedText: doc.text,
      mtime: doc.mtime,
      dirty: false,
      line: 1,
      col: 1,
    };
    this.tabs.push(tab);
    this.activeRel = rel;
    this.vaultUi.lastFile = rel;
    void this.persistUi();
    void api.setActiveDoc(rel);
    bus.emit('tabs');
    bus.emit('active');

    // 崩溃恢复：磁盘内容与草稿不一致时，让用户决定用哪一份（§10.3）
    const draft = this.draft(rel);
    if (draft && draft.text !== doc.text) {
      bus.emit('draft', { rel, at: draft.at, text: draft.text });
    }
  }

  activate(rel: string): void {
    if (!this.tabs.some((t) => t.rel === rel)) return;
    this.activeRel = rel;
    this.vaultUi.lastFile = rel;
    void this.persistUi();
    void api.setActiveDoc(rel);
    bus.emit('active');
  }

  closeTab(rel: string): void {
    const idx = this.tabs.findIndex((t) => t.rel === rel);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);
    if (this.activeRel === rel) {
      const next = this.tabs[Math.max(0, idx - 1)];
      this.activeRel = next?.rel ?? null;
      bus.emit('active');
    }
    bus.emit('tabs');
  }

  updateText(text: string): void {
    const tab = this.activeTab;
    if (!tab) return;
    tab.text = text;
    tab.dirty = text !== tab.savedText;
    this.scheduleDraft(tab);
    bus.emit('status');
    bus.emit('tabs');
  }

  /* ───────── 崩溃恢复：未保存内容写入草稿 ───────── */

  private draftKey(rel: string): string | null {
    if (!this.vault) return null;
    return `ge:draft:v1:${this.vault.id}:${rel}`;
  }

  /**
   * 输入后 500ms 落一次草稿。刻意用 localStorage：草稿属于界面状态，
   * 不应出现在用户的工作区目录里（§10「不污染用户仓库」）。
   */
  private scheduleDraft(tab: Tab): void {
    if (this.draftTimer !== null) clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      const key = this.draftKey(tab.rel);
      if (!key) return;
      if (!tab.dirty) {
        localStorage.removeItem(key);
        return;
      }
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ text: tab.text, savedText: tab.savedText, at: Date.now() })
        );
      } catch {
        /* 配额满：草稿是尽力而为，不能影响编辑本身 */
      }
    }, 500);
  }

  draft(rel: string): { text: string; at: number; savedText?: string } | null {
    const key = this.draftKey(rel);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { text: string; at: number }) : null;
    } catch {
      return null;
    }
  }

  clearDraft(rel: string): void {
    const key = this.draftKey(rel);
    if (key) localStorage.removeItem(key);
  }

  /** 用草稿覆盖当前标签内容（保持 dirty，等待用户保存） */
  restoreDraft(rel: string): void {
    const draft = this.draft(rel);
    const tab = this.tabs.find((t) => t.rel === rel);
    if (!draft || !tab) return;
    tab.text = draft.text;
    tab.dirty = draft.text !== tab.savedText;
    bus.emit('tabs');
    bus.emit('status');
    bus.emit('active');
  }

  setCursor(line: number, col: number): void {
    const tab = this.activeTab;
    if (!tab) return;
    tab.line = line;
    tab.col = col;
    bus.emit('status');
  }

  async save(): Promise<boolean> {
    const tab = this.activeTab;
    if (!tab) return false;
    try {
      const res = await api.writeDoc(tab.rel, tab.text, tab.mtime);
      tab.mtime = res.mtime;
      tab.savedText = tab.text;
      tab.dirty = false;
      this.clearDraft(tab.rel);
      bus.emit('tabs');
      bus.emit('status');
      return true;
    } catch (err) {
      if (err instanceof api.HostError && err.code === 'CONFLICT') {
        bus.emit('toast', {
          text: '文件已被外部修改，未保存。可选择「重载」或另存。',
          kind: 'err',
        });
        return false;
      }
      bus.emit('toast', { text: `保存失败：${(err as Error).message}`, kind: 'err' });
      return false;
    }
  }

  async reloadFromDisk(): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    const doc = await api.readDoc(tab.rel);
    tab.text = doc.text;
    tab.savedText = doc.text;
    tab.mtime = doc.mtime;
    tab.dirty = false;
    this.clearDraft(tab.rel);
    bus.emit('active');
    bus.emit('tabs');
  }

  async createFile(name: string, parent = ''): Promise<void> {
    const rel = parent ? `${parent}/${name}` : name;
    const entry = await api.createEntry(rel, 'file');
    await this.loadDir(parent);
    bus.emit('tree');
    await this.openFile(entry.rel);
  }

  async deleteEntry(rel: string): Promise<void> {
    await api.deleteEntry(rel);
    this.tree.clear();
    this.expanded.clear();
    this.tree.clear();
    this.closeTab(rel);
    bus.emit('tree');
  }

  /* ───────── 文件级剪贴板（§8.3） ───────── */

  setFileClip(mode: 'copy' | 'cut', rels: string[]): void {
    this.fileClip = rels.length > 0 ? { mode, rels: [...rels] } : null;
    bus.emit('status');
  }

  clearFileClip(): void {
    this.fileClip = null;
    bus.emit('status');
  }

  /**
   * 粘贴到目录。复制走 copy_entry（同名后缀由宿主决定），剪切走 rename。
   * 返回实际改动过的相对路径，供调用方决定要不要打开新文件。
   */
  async pasteInto(dir: string): Promise<string[]> {
    const clip = this.fileClip;
    if (!clip) return [];
    const touched: string[] = [];
    const dirtyDirs = new Set<string>([dir]);

    for (const rel of clip.rels) {
      const sourceDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      dirtyDirs.add(sourceDir);
      const name = rel.split('/').pop() ?? rel;
      const target = dir ? `${dir}/${name}` : name;

      if (clip.mode === 'copy') {
        const entry = await api.copyEntry(rel, dir);
        touched.push(entry.rel);
      } else if (target !== rel) {
        await api.renameEntry(rel, target);
        touched.push(target);
        // 剪切的源文件若正开着，标签路径要跟着改
        const tab = this.tabs.find((t) => t.rel === rel);
        if (tab) tab.rel = target;
        if (this.activeRel === rel) this.activeRel = target;
      }
    }

    if (clip.mode === 'cut') this.clearFileClip();
    for (const d of dirtyDirs) this.tree.delete(d);
    for (const d of dirtyDirs) {
      try {
        await this.loadDir(d);
      } catch {
        /* 源目录可能已被整个移走 */
      }
    }
    bus.emit('tree');
    bus.emit('tabs');
    return touched;
  }

  async setTheme(patch: Partial<Settings['theme']>): Promise<void> {
    this.settings = { ...this.settings, theme: { ...this.settings.theme, ...patch } };
    await api.setSettings({ theme: this.settings.theme });
    bus.emit('settings');
  }

  async setSettingsPatch(patch: Record<string, unknown>): Promise<void> {
    this.settings = (await api.setSettings(patch)) as Settings;
    bus.emit('settings');
  }

  async togglePlugin(id: string, on: boolean): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === id);
    if (!plugin) return;
    const enabled = new Set(this.settings.plugins.enabled);
    const disabled = new Set(this.settings.plugins.disabled ?? []);
    if (plugin.source.type === 'builtin') {
      // 内置插件默认开，所以「关」要记进 disabled，「开」就是把它移出来
      if (on) disabled.delete(id);
      else disabled.add(id);
    } else if (on) {
      enabled.add(id);
    } else {
      enabled.delete(id);
    }
    this.settings.plugins.enabled = [...enabled];
    this.settings.plugins.disabled = [...disabled];
    await api.setSettings({ plugins: { enabled: [...enabled], disabled: [...disabled] } });
    bus.emit('plugins');
  }

  async setPluginConfig(id: string, key: string, value: unknown): Promise<void> {
    const config = { ...(this.settings.plugins.config[id] ?? {}), [key]: value };
    this.settings.plugins.config = { ...this.settings.plugins.config, [id]: config };
    await api.setSettings({ plugins: { config: { [id]: config } } });
    bus.emit('plugins');
  }

  setOutline(items: OutlineItem[]): void {
    this.outline = items;
    bus.emit('outline');
  }

  setRenderInfo(info: { blocks: number; ms: number; plugins: number; errors: number }): void {
    this.renderInfo = info;
    bus.emit('render');
  }

  pushLog(level: string, message: string): void {
    this.logs.push({ level, message });
    if (this.logs.length > 60) this.logs.shift();
    bus.emit('log');
  }

  persistDocState(patch: {
    ratio?: number;
    previewHidden?: boolean;
    width?: number;
    scrollTop?: number;
    layout?: LayoutMode;
  }): void {
    if (!this.vault || !this.activeRel) return;
    Object.assign(this.docState(this.activeRel), patch);
    void this.persistUi();
  }

  persistGroupState(groups: Record<string, boolean>): void {
    if (!this.vault) return;
    this.vaultUi.groups = { ...(this.vaultUi.groups ?? {}), ...groups };
    void this.persistUi();
  }

  private async persistUi(): Promise<void> {
    if (!this.uiLoaded) return;
    try {
      await api.setUiState(this.ui);
    } catch (err) {
      console.warn('ui-state 写入失败', err);
    }
  }

  wordCount(): number {
    const text = this.activeTab?.text ?? '';
    const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
    const words = text
      .replace(/[\u3400-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    return cjk + words;
  }

  toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
    bus.emit('toast', { text, kind });
  }
}

export const store = new Store();
