import * as api from './bridge';
import type {
  Commit,
  Entry,
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
  | 'log'
  | 'toast';

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
  preview: { width: 980, syncScroll: false, pauseAboveMb: 10 },
  export: {
    format: 'html',
    width: 980,
    inlineImages: true,
    inlinePluginCss: true,
    inlinePluginScripts: false,
  },
  plugins: { enabled: [], config: {} },
  recents: [],
  lastVault: null,
};

class Store {
  appVersion = '0.1.0';
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
  private uiLoaded = false;

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
    if (this.settings.plugins.enabled.length === 0) {
      // 首次打开：默认启用内置插件（按 manifest 声明顺序）
      this.settings.plugins.enabled = this.plugins
        .filter((p) => p.source.type === 'builtin')
        .map((p) => p.id);
      await api.setSettings({ plugins: { enabled: this.settings.plugins.enabled } });
    }
    bus.emit('plugins');
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
    bus.emit('status');
    bus.emit('tabs');
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
    const set = new Set(this.settings.plugins.enabled);
    if (on) set.add(id);
    else set.delete(id);
    this.settings.plugins.enabled = [...set];
    await api.setSettings({ plugins: { enabled: this.settings.plugins.enabled } });
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

  persistDocState(patch: { ratio?: number; previewHidden?: boolean; width?: number; scrollTop?: number }): void {
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
