/**
 * 唯一允许 import @tauri-apps/api 的目录（ARCHITECTURE §3）。
 * 其余代码一律通过这里暴露的函数访问宿主；预览侧代码将来可原样搬到网页版。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppInfo,
  Commit,
  DocRead,
  DocWrite,
  Entry,
  FileFilter,
  PluginManifest,
  ServerInfo,
  Settings,
  UiState,
  VaultInfo,
} from './types';

/** 宿主返回的结构化错误，code 用于分支判断（CONFLICT / TOO_LARGE / DENIED …） */
export class HostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HostError';
    this.code = code;
  }
}

interface RawError {
  code?: string;
  message?: string;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (typeof e === 'object' && e !== null) {
      const raw = e as RawError;
      if (raw.code) throw new HostError(raw.code, raw.message ?? raw.code);
      if (raw.message) throw new HostError('UNKNOWN', raw.message);
    }
    throw new HostError('UNKNOWN', String(e));
  }
}

/* ---------------- vault ---------------- */

export const openVault = (path: string) => call<VaultInfo>('open_vault', { path });
export const listDir = (rel: string) => call<Entry[]>('list_dir', { rel });
export const readDoc = (rel: string) => call<DocRead>('read_doc', { rel });
export const writeDoc = (rel: string, text: string, expectedMtime: number | null) =>
  call<DocWrite>('write_doc', { rel, text, expectedMtime });
export const createEntry = (rel: string, kind: 'file' | 'dir') =>
  call<Entry>('create_entry', { rel, kind });
export const renameEntry = (rel: string, to: string) => call<Entry>('rename_entry', { rel, to });
/** 复制到目录；同名后缀由宿主决定，返回值带实际使用的相对路径 */
export const copyEntry = (rel: string, toDir: string) => call<Entry>('copy_entry', { rel, toDir });
export const deleteEntry = (rel: string) => call<void>('delete_entry', { rel });
export const revealInExplorer = (rel: string) => call<void>('reveal_in_explorer', { rel });
export const watchVault = () => call<void>('watch_vault');
export const unwatchVault = () => call<void>('unwatch_vault');
export const closeVault = () => call<void>('close_vault');

/* ---------------- settings / ui state ---------------- */

export const getSettings = () => call<Settings>('get_settings');
export const setSettings = (patch: Partial<Settings> | Record<string, unknown>) =>
  call<Settings>('set_settings', { patch });
export const getUiState = () => call<UiState>('get_ui_state');
export const setUiState = (patch: UiState) => call<UiState>('set_ui_state', { patch });

/* ---------------- plugins ---------------- */

export const scanPlugins = () => call<PluginManifest[]>('scan_plugins');
export const installPlugin = (src: string) => call<PluginManifest>('install_plugin', { src });
export const removePlugin = (id: string) => call<void>('remove_plugin', { id });
export const openPluginsDir = () => call<void>('open_plugins_dir');

/* ---------------- preview server ---------------- */

export const startPreviewServer = () => call<ServerInfo>('start_preview_server');
export const stopPreviewServer = () => call<void>('stop_preview_server');

/* ---------------- export / system ---------------- */

export const saveExport = (path: string, contents: string) =>
  call<void>('save_export', { path, contents });
export const exportPdf = (path: string) => call<void>('export_pdf', { path });
export const openExternal = (url: string) => call<void>('open_external', { url });
export const pickFolder = () => call<string | null>('pick_folder');
export const pickFile = (filters?: FileFilter[]) => call<string | null>('pick_file', { filters });
export const saveDialog = (defaultName: string, filters?: FileFilter[]) =>
  call<string | null>('save_dialog', { defaultName, filters });
export const getAppInfo = () => call<AppInfo>('get_app_info');
export const gitLog = (limit = 12) => call<Commit[]>('git_log', { limit });
export const setActiveDoc = (rel: string | null) => call<void>('set_active_doc', { rel });
/** 启动参数里的文件（双击 .md / 命令行）；取一次即清空 */
export const takePendingOpen = () => call<string | null>('take_pending_open');

/* ---------------- 性能验收（§13.1，仅 perf-check 脚本触发） ---------------- */

export interface PerfSample {
  name: string;
  budget: number;
  text: string;
}
export interface PerfPlan {
  samples: PerfSample[];
  /** 结果文件路径，写完就退出进程 */
  out: string;
}

/** 普通启动返回 null；只有设置了 GE_PERF_MANIFEST 才会拿到验收清单 */
export const perfPlan = () => call<PerfPlan | null>('perf_plan');
export const perfReport = (out: string, rows: string) => call<void>('perf_report', { out, rows });

/* ---------------- events ---------------- */

export interface VaultChangedPayload {
  paths: string[];
}
export interface DocExternalChangedPayload {
  rel: string;
  mtime: number;
}
export interface ServerReadyPayload {
  origin: string;
}

export type HostEventMap = {
  'vault:changed': VaultChangedPayload;
  'doc:external_changed': DocExternalChangedPayload;
  'server:ready': ServerReadyPayload;
  'app:open-file': { path: string };
  /** 内置 / 用户插件目录有文件变化（新增、编辑、删除） */
  'plugins:changed': null;
};

export function on<K extends keyof HostEventMap>(
  event: K,
  handler: (payload: HostEventMap[K]) => void
): Promise<UnlistenFn> {
  return listen<HostEventMap[K]>(event, (e) => handler(e.payload));
}

/** 系统拖入文件：Tauri 提供真实路径，浏览器 File API 拿不到 */
export async function onDragDrop(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') handler(event.payload.paths);
  });
}
