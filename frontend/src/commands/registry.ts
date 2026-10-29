/**
 * 命令表（ARCHITECTURE §8.2）。
 *
 * 菜单、命令面板、快捷键是同一张表的三类视图。任何动作只在这里注册一次，
 * 不许再出现「菜单里有一项、keydown 里另有一条 if」的写法——那种写法迟早
 * 会让同一条命令在两个入口表现不一致。
 */

import { bus, store } from '../store';

/** 命令可用的上下文。`global` 在任何上下文都可用。 */
export type CommandContext = 'global' | 'fileTree' | 'editor' | 'preview';

export interface CommandArg {
  /** fileTree：目标相对路径；空串表示右键在空白处 */
  rel?: string;
  /** fileTree：目标是文件还是目录 */
  isFile?: boolean;
  /** preview：外壳上报的选中纯文本 */
  text?: string;
}

export interface CommandDef {
  /** 命名空间化：'file.copy' / 'markdown-tools.formatTable' */
  id: string;
  title: string;
  /** 菜单分组，同组相邻 */
  group?: string;
  /** 缺省 ['global'] */
  when?: CommandContext[];
  /** 默认键位，如 'Ctrl+Shift+P' */
  default?: string;
  /** 'system' 或插件 id；快捷键弹窗的「源」列 */
  source?: string;
  /** 置灰条件：返回 false 时菜单项不可点、快捷键不响应 */
  enabled?: (arg?: CommandArg) => boolean;
  /**
   * 键位由宿主原生处理，命令系统不抢。
   * 典型是编辑器的 Ctrl+C/X/V：Monaco 已经处理得很好，抢过来只是多一层风险；
   * 这类命令的 `default` 仅用于菜单显示，快捷键弹窗里标注为不可改（§8.4）。
   */
  native?: boolean;
  run: (arg?: CommandArg) => void | Promise<void>;
}

const registry = new Map<string, CommandDef>();

/** 编辑器是否持有文本焦点。由 editor 侧注入，避免 commands → editor 的循环依赖。 */
let editorProbe: () => boolean = () => false;

export function setEditorProbe(fn: () => boolean): void {
  editorProbe = fn;
}

/**
 * 上下文参数。快捷键进来时没有菜单那样的 `arg`，只能由宿主按焦点推断
 * （例如文件树里按 Ctrl+C，目标就是当前选中的文件）。
 */
let argProvider: (ctx: CommandContext) => CommandArg | undefined = () => undefined;

export function setContextArgProvider(fn: (ctx: CommandContext) => CommandArg | undefined): void {
  argProvider = fn;
}

export function contextArg(ctx: CommandContext): CommandArg | undefined {
  return argProvider(ctx);
}

export function registerCommands(defs: CommandDef[]): void {
  for (const def of defs) {
    if (!def.id) throw new Error('命令必须有 id');
    if (registry.has(def.id) && registry.get(def.id)!.source !== def.source) {
      // 同 id 不同来源视为冲突：插件不许覆盖系统命令（否则停用插件后命令会「消失」）
      console.warn(`[commands] 命令 ${def.id} 已被 ${registry.get(def.id)!.source ?? 'system'} 占用`);
      continue;
    }
    registry.set(def.id, def);
  }
  bus.emit('commands');
}

/** 插件停用 / 重载时清掉它贡献的命令 */
export function unregisterSource(source: string): void {
  let changed = false;
  for (const [id, def] of registry) {
    if (def.source === source) {
      registry.delete(id);
      changed = true;
    }
  }
  if (changed) bus.emit('commands');
}

export function allCommands(): CommandDef[] {
  return [...registry.values()];
}

export function getCommand(id: string): CommandDef | undefined {
  return registry.get(id);
}

export function contextsOf(def: CommandDef): CommandContext[] {
  return def.when && def.when.length > 0 ? def.when : ['global'];
}

export function allows(def: CommandDef, ctx: CommandContext): boolean {
  const list = contextsOf(def);
  return list.includes('global') || list.includes(ctx);
}

/**
 * 焦点来源判定。不靠「谁弹出的菜单」——同一条命令可能从菜单、快捷键、
 * 命令面板三条路进来，只有焦点是三者共有的事实。
 */
export function resolveContext(): CommandContext {
  const el = document.activeElement as HTMLElement | null;
  if (el && el.closest('#fileTree')) return 'fileTree';
  if (editorProbe()) return 'editor';
  return 'global';
}

/** 菜单/面板用：按 when 与 enabled 过滤，保持注册顺序 */
export function commandsFor(ctx: CommandContext, arg?: CommandArg): CommandDef[] {
  return allCommands().filter((def) => {
    if (!allows(def, ctx)) return false;
    if (def.enabled && !def.enabled(arg)) return false;
    return true;
  });
}

/**
 * 唯一执行入口。任何调用方都不许直接调 `run`——否则「菜单能点、快捷键失效」
 * 这类不一致会重新长出来（§8.2）。
 */
export async function runCommand(
  id: string,
  arg?: CommandArg,
  ctx?: CommandContext
): Promise<void> {
  const def = registry.get(id);
  if (!def) {
    store.pushLog('error', `命令不存在：${id}`);
    bus.emit('toast', { text: `命令不存在：${id}`, kind: 'err' });
    return;
  }
  const here = ctx ?? resolveContext();
  if (!allows(def, here)) {
    store.pushLog('warn', `命令 ${id} 在 ${here} 上下文不可用`);
    return;
  }
  if (def.enabled && !def.enabled(arg)) return;

  try {
    await def.run(arg);
    store.pushLog('info', `命令：${def.title}`);
  } catch (err) {
    const message = (err as Error).message || String(err);
    store.pushLog('error', `命令 ${def.title} 失败：${message}`);
    bus.emit('toast', { text: `「${def.title}」失败：${message}`, kind: 'err' });
  }
}
