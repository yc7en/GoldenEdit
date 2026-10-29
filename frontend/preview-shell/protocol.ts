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
  /** 用户自定义预览 CSS（§7.3）；空字符串表示不注入 */
  customCss?: string;
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
  | {
      type: 'rendered';
      gen: number;
      ms: number;
      /** 外壳收到的字符数（宿主 → iframe 这一跳的结果） */
      submitted: number;
      /** Worker 实际解析的字符数（iframe → worker 这一跳的结果） */
      chars: number;
      /** 解析阶段耗时 */
      parseMs: number;
      /** 块循环耗时 */
      loopMs: number;
      /** 各条自定义规则的累计耗时（诊断用） */
      rules?: Record<string, number>;
      /** 从收到 doc 到 Worker 回结果（含两次跨线程传输 + 解析）——诊断用 */
      xferMs?: number;
      /** 主线程建 DOM（pipeline.render）耗时——诊断用 */
      domMs?: number;
      blocks: number;
      plugins: string[];
      errors: RenderError[];
    }
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
