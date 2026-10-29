/**
 * 键位：绑定表与分发（ARCHITECTURE §8.4）。
 *
 * 只有一个 keydown 监听，取代 main.ts 里那串 if/else。新增快捷键 = 给命令加
 * `default` 或在设置里改一次绑定，不需要动这里的代码。
 */

import { bus, store } from '../store';
import {
  allCommands,
  allows,
  contextArg,
  getCommand,
  resolveContext,
  runCommand,
  type CommandDef,
} from './registry';
import {
  chordOf,
  formatChord,
  parseChord,
  sameChord,
  type Chord,
} from './chords';

export {
  chordOf,
  formatChord,
  normalizeKey,
  parseChord,
  sameChord,
  type Chord,
} from './chords';

/* ───────── 绑定表 ───────── */

/** 只存与默认值的差异；null = 用户显式解绑 */
let overrides: Record<string, string | null> = {};

export function applyKeybindings(map: Record<string, string | null> | undefined): void {
  overrides = map ?? {};
}

/** 命令当前生效的键位原文（可能来自 defaults，也可能来自用户覆盖） */
export function bindingText(id: string): string | null {
  if (id in overrides) return overrides[id];
  return getCommand(id)?.default ?? null;
}

export function bindingOf(id: string): Chord | null {
  const text = bindingText(id);
  return text ? parseChord(text) : null;
}

/** 菜单/面板显示用：没绑定返回空串 */
export function bindingLabel(id: string): string {
  const chord = bindingOf(id);
  return chord ? formatChord(chord) : '';
}

/**
 * 改一条绑定。传 null 表示解绑，传 undefined 表示恢复默认（删掉覆盖项）。
 * 不在这里校验冲突——冲突要经过用户确认，由调用方（弹窗）负责。
 *
 * 写入时整表覆盖：settings 的深合并删不掉键，只发差异会让「恢复默认」永远失效。
 */
export async function setBinding(id: string, text: string | null | undefined): Promise<void> {
  const next: Record<string, string | null> = { ...overrides };
  if (text === undefined) delete next[id];
  else next[id] = text;

  overrides = next;
  await store.setSettingsPatch({ keybindings: next });
  bus.emit('keybindings');
}

const ALL_CONTEXTS = ['global', 'fileTree', 'editor', 'preview'];

function contextsOfDef(def: CommandDef): string[] {
  return allows(def, 'global') ? ALL_CONTEXTS : (def.when ?? ['global']);
}

/** 与 id 的 when 有交集、且键位相同的其它命令（用于冲突确认） */
export function conflictsFor(id: string, chord: Chord): CommandDef[] {
  const self = getCommand(id);
  if (!self) return [];
  const mine = contextsOfDef(self);
  return allCommands().filter((def) => {
    if (def.id === id) return false;
    const other = bindingOf(def.id);
    if (!other || !sameChord(other, chord)) return false;
    return contextsOfDef(def).some((c) => mine.includes(c));
  });
}

/* ───────── 分发 ───────── */

let letThrough = false;

/** 录制键位时打开，让按键原样落到弹窗的监听器上 */
export function setLetThrough(value: boolean): void {
  letThrough = value;
}

function inTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.isContentEditable;
}

/**
 * 同一键位可能绑在多个上下文（`Ctrl+C` 在文件树复制文件、在编辑器复制文本）。
 * 先找当前上下文专属的，再回落到 global。
 */
export function dispatchChord(e: KeyboardEvent): boolean {
  if (letThrough) return false;
  const chord = chordOf(e);
  if (!chord.key) return false;
  // 输入态下不允许不带修饰键的绑定触发，否则在搜索框里打字会误触 Del / F2
  if (inTypingTarget() && !chord.ctrl && !chord.alt) return false;

  const ctx = resolveContext();
  const arg = contextArg(ctx);
  const tiers: CommandDef[][] = [[], []];
  for (const def of allCommands()) {
    if (!allows(def, ctx)) continue;
    // native 命令的键位归宿主（Monaco）自己处理，这里只负责在菜单里显示它
    if (def.native) continue;
    const bound = bindingOf(def.id);
    if (!bound || !sameChord(bound, chord)) continue;
    // 上下文专属的命中优先于 global：Ctrl+C 在文件树里是复制文件，不是复制文本
    const specific = !allows(def, 'global');
    tiers[specific ? 0 : 1].push(def);
  }

  const hit = tiers[0][0] ?? tiers[1][0];
  if (!hit) return false;
  if (hit.enabled && !hit.enabled(arg)) return false;

  e.preventDefault();
  e.stopPropagation();
  void runCommand(hit.id, arg, ctx);
  return true;
}

let installed = false;

export function installKeyHandler(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented) return;
      dispatchChord(e);
    },
    // 捕获阶段先于 Monaco：编辑器内的自定义键在 Monaco 收到之前就被接管，
    // 这样不依赖 addCommand 转发，也不会被 Monaco 的默认绑定挡住
    true
  );
}
