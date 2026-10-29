/**
 * 主页面插件宿主（ARCHITECTURE §5.11）。
 *
 * 渲染插件跑在预览侧（Worker / iframe）；要改**源码文本**的插件（表格对齐、待办标记）
 * 必须拿到 Monaco，只能在主页面再 register 一次。同一份 entry.js，两个环境。
 */

import type { PluginManifest, ServerInfo } from '../bridge/types';
import {
  registerCommands,
  unregisterSource,
  type CommandContext,
} from '../commands/registry';
import { resolveMode } from '../theme/tokens';
import { isPluginEnabled, store } from '../store';
import type { EditorFacade } from './index';

interface CommandContribution {
  id: string;
  title: string;
  group?: string;
  default?: string;
  when?: CommandContext[];
  run: (ed: EditorFacade) => void | Promise<void>;
}

let facade: EditorFacade | null = null;
let server: ServerInfo | null = null;
/** 已成功加载的插件 id，重载时用来对比 */
const active = new Set<string>();

export function setEditorFacade(f: EditorFacade): void {
  facade = f;
}

function entryUrlOf(p: PluginManifest): string | null {
  if (!server || !p.entry) return null;
  return `${server.origin}/p/${server.token}/${p.base}/${p.entry}`;
}

function defaultsOf(p: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(p.config ?? {})) out[key] = field.default;
  return out;
}

function makeContext(p: PluginManifest) {
  return {
    env: {
      apiVersion: 1 as const,
      hostVersion: store.appVersion,
      locale: navigator.language,
      scope: 'main' as const,
    },
    get config() {
      return Object.freeze({
        ...defaultsOf(p),
        ...(store.settings.plugins.config[p.id] ?? {}),
        // 宿主注入的全局项：待办日期格式（§8.5），插件不必自己维护一份设置
        taskDateFormat: store.settings.markdown.taskDateFormat,
      });
    },
    get doc() {
      const rel = store.activeRel ?? '';
      return Object.freeze({
        path: rel,
        name: rel.split('/').pop() ?? '',
        dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
        frontmatter: {},
      });
    },
    get theme() {
      return Object.freeze({
        mode: resolveMode(store.settings.theme.preview),
        tokens: {} as Record<string, string>,
      });
    },
    commands: {
      register(def: CommandContribution): void {
        if (!facade) return;
        // 插件必须在自己的命名空间里注册，否则停用时按 source 清不干净
        const id = def.id.startsWith(`${p.id}.`) ? def.id : `${p.id}.${def.id}`;
        registerCommands([
          {
            id,
            title: def.title,
            group: def.group ?? p.name,
            when: def.when ?? ['editor'],
            default: def.default,
            source: p.id,
            run: () => (facade ? def.run(facade) : undefined),
          },
        ]);
      },
    },
    assets: {
      url: (rel: string) => `${server?.origin}/p/${server?.token}/${p.base}/assets/${rel}`,
    },
    libs: {
      load: () => Promise.reject(new Error('编辑器侧不提供第三方库加载')),
    },
    log: (level: 'info' | 'warn' | 'error', message: string) => {
      store.pushLog(level, `[${p.id}] ${message}`);
    },
  };
}

/**
 * 加载 / 重载编辑器插件。只有 manifest 声明了 `permissions: ["editor"]` 的才进来——
 * 没声明的即便调 `ctx.commands.register` 也拿不到命令。
 */
export async function loadEditorPlugins(
  plugins: PluginManifest[],
  info: ServerInfo
): Promise<void> {
  server = info;
  const wanted = plugins.filter(
    (p) => (p.permissions ?? []).includes('editor') && p.entry && isPluginEnabled(store.settings, p)
  );
  const keep = new Set(wanted.map((p) => p.id));

  // 停用 / 卸载的插件：命令一起下架，否则菜单里会留着一条点了没反应的项
  for (const id of [...active]) {
    if (!keep.has(id)) {
      unregisterSource(id);
      active.delete(id);
    }
  }

  for (const p of wanted) {
    const url = entryUrlOf(p);
    if (!url) continue;
    try {
      const mod = (await import(/* @vite-ignore */ url)) as {
        register?: (md: unknown, ctx: unknown) => void | Promise<void>;
      };
      if (typeof mod.register !== 'function') {
        store.pushLog('error', `[${p.id}] 缺少 register 导出，无法贡献命令`);
        continue;
      }
      // 重复加载前先清旧命令，避免同 id 覆盖后旧闭包仍指向上一版代码
      unregisterSource(p.id);
      await mod.register(null, makeContext(p));
      active.add(p.id);
      store.pushLog('info', `编辑器插件就绪：${p.name}`);
    } catch (err) {
      store.pushLog('error', `[${p.id}] 编辑器插件加载失败：${(err as Error).message}`);
    }
  }
}

/** 插件目录变化或启停切换时重建命令表 */
export async function refreshEditorPlugins(plugins: PluginManifest[]): Promise<void> {
  if (!server) return;
  await loadEditorPlugins(plugins, server);
}
