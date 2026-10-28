/**
 * L2 ↔ L3 消息协议。两侧共享同一份类型，避免「字段名对不上」这类只在运行时才暴露的错误。
 * 主页面侧用 type-only import 引用本文件（不打包预览代码）。
 */

export const PROTOCOL_VERSION = 1;

export type PluginCapability = 'L0' | 'L1' | 'L2' | 'L3';

export interface PluginSpec {
  id: string;
  name: string;
  version: string;
  trust: 'builtin' | 'local';
  capability: PluginCapability;
  entryUrl?: string;
  styleUrl?: string;
  match: { fence?: string[]; container?: string[]; delimiter?: string[] };
  config: Record<string, unknown>;
}

export interface ThemePayload {
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
}

export interface DocMeta {
  path: string;
  name: string;
  dir: string;
  frontmatter: Record<string, unknown>;
}

/** L2 → L3 */
export type HostMessage =
  | {
      type: 'init';
      protocol: number;
      hostVersion: string;
      plugins: PluginSpec[];
      theme: ThemePayload;
      doc: DocMeta;
      options: RenderOptions;
    }
  | { type: 'doc'; gen: number; text: string }
  | { type: 'doc-meta'; doc: DocMeta }
  | { type: 'theme'; theme: ThemePayload }
  | { type: 'width'; width: number }
  | { type: 'remount' }
  | { type: 'export'; id: number; title: string }
  /** PDF 降级路径：由 L3 调 window.print()，打印设置里选「另存为 PDF」 */
  | { type: 'print' };

export interface RenderOptions {
  /** >10MB 时由 L2 决定是否暂停 */
  paused: boolean;
  /** 分片阈值（字节），来自 §6.4 */
  fullRenderLimit: number;
  shardLimit: number;
}

/** L3 → L2 */
export type PreviewMessage =
  | { type: 'ready'; protocol: number }
  | { type: 'rendered'; gen: number; ms: number; blocks: number; plugins: string[]; errors: RenderError[] }
  | { type: 'outline'; items: OutlineItem[] }
  | { type: 'jump'; line: number }
  | { type: 'open-external'; url: string }
  | { type: 'copy'; text: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'fatal'; message: string }
  | { type: 'exported'; id: number; html: string }
  | { type: 'stats'; count: number };

export interface RenderError {
  plugin?: string;
  line: number;
  message: string;
}

export interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  paused: false,
  fullRenderLimit: 200 * 1024,
  shardLimit: 2 * 1024 * 1024,
};
