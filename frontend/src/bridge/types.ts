/**
 * 前后端共享的类型定义（纯类型，不 import 任何 Tauri API）。
 * 与 ARCHITECTURE §9.1 的命令签名一一对应。
 */

export type EntryKind = 'file' | 'dir';

export interface Entry {
  name: string;
  /** 相对 vault 根的路径，始终使用 `/` 分隔 */
  rel: string;
  kind: EntryKind;
  size: number;
  /** 毫秒时间戳 */
  mtime: number;
}

export interface VaultInfo {
  root: string;
  /** 工作区路径的稳定哈希，用作 ui-state.json 的键 */
  id: string;
  name: string;
  entries: Entry[];
}

export interface DocRead {
  text: string;
  mtime: number;
  hash: string;
}

export interface DocWrite {
  mtime: number;
}

export type PluginTrust = 'builtin' | 'local';
export type PluginCapability = 'L0' | 'L1' | 'L2' | 'L3';
export type ConfigFieldType = 'boolean' | 'select' | 'number' | 'string' | 'textarea';

export interface ConfigField {
  type: ConfigFieldType;
  default: unknown;
  options?: string[];
  label?: string;
  description?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  author?: string;
  description?: string;
  trust: PluginTrust;
  entry?: string;
  style?: string;
  match: { fence?: string[]; container?: string[]; delimiter?: string[] };
  permissions?: string[];
  config?: Record<string, ConfigField>;
  preview?: string;
  source: { type: 'builtin' | 'local' | 'remote'; path?: string };
  /** 运行时探测出的能力等级，扫描阶段按静态特征预估 */
  capability: PluginCapability;
  /** 相对预览服务根的可取路径前缀，形如 plugin/mermaid */
  base: string;
}

export interface ServerInfo {
  port: number;
  token: string;
  origin: string;
}

export interface Commit {
  hash: string;
  short: string;
  subject: string;
  /** 毫秒时间戳 */
  date: number;
  version?: string;
}

export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
}

export interface ThemeSettings {
  preset: 'system' | 'writing' | 'light' | 'dark' | 'custom';
  editor: 'dark' | 'light' | 'system';
  preview: 'light' | 'dark' | 'system';
}

export interface PreviewSettings {
  width: number;
  syncScroll: boolean;
  /** >10MB 文档默认不渲染 */
  pauseAboveMb: number;
  /** 用户自定义预览 CSS，注入到预览外壳的 <style> 里（§7.3） */
  customCss: string;
}

export interface ExportSettings {
  format: 'html' | 'pdf';
  width: number;
  inlineImages: boolean;
  inlinePluginCss: boolean;
  inlinePluginScripts: boolean;
}

export interface Settings {
  theme: ThemeSettings;
  preview: PreviewSettings;
  export: ExportSettings;
  plugins: {
    /** 本地插件的启用名单；内置插件默认启用，不看这个字段 */
    enabled: string[];
    /** 被用户显式停用的插件（内置与本地都记这里） */
    disabled: string[];
    config: Record<string, Record<string, unknown>>;
  };
  /** 只存与命令默认值的差异；null 表示显式解绑（§8.4） */
  keybindings: Record<string, string | null>;
  /** 左栏宽度与收起状态（§8.1） */
  layout: LayoutSettings;
  /** 文本命令的行为参数（§8.5） */
  markdown: MarkdownSettings;
  recents: string[];
  lastVault: string | null;
}

export interface LayoutSettings {
  sideWidth: number;
  sideHidden: boolean;
}

export interface MarkdownSettings {
  /** 待办完成时追加的日期格式，占位符 YYYY MM DD HH mm */
  taskDateFormat: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface DocState {
  ratio?: number;
  previewHidden?: boolean;
  width?: number;
  scrollTop?: number;
  /** 三布局：分栏 / 仅编辑 / 仅预览 */
  layout?: LayoutMode;
}

export type LayoutMode = 'split' | 'editor' | 'preview';

export interface VaultUiState {
  docs?: Record<string, DocState>;
  groups?: Record<string, boolean>;
  filesExpanded?: string[];
  lastFile?: string | null;
}

export interface UiState {
  vaults?: Record<string, VaultUiState>;
}
