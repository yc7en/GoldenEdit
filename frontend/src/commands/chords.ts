/**
 * 键位解析（ARCHITECTURE §8.4）。纯函数，不碰 store 与 DOM，
 * 这样单测不需要拉起整个前端运行时。
 */

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const MOD_ORDER = ['Ctrl', 'Shift', 'Alt'] as const;

/** 键名归一：parse 与事件转换共用，避免 'esc' / 'Escape' 两套写法对不上 */
export function normalizeKey(raw: string): string {
  const k = raw.trim();
  if (!k) return '';
  const lower = k.toLowerCase();
  switch (lower) {
    case 'esc':
    case 'escape':
      return 'Esc';
    case 'del':
    case 'delete':
      return 'Del';
    case 'space':
    case ' ':
      return 'Space';
    case 'up':
    case 'arrowup':
      return 'UpArrow';
    case 'down':
    case 'arrowdown':
      return 'DownArrow';
    case 'left':
    case 'arrowleft':
      return 'LeftArrow';
    case 'right':
    case 'arrowright':
      return 'RightArrow';
    case 'enter':
    case 'return':
      return 'Enter';
    case 'tab':
      return 'Tab';
    case 'backspace':
      return 'Backspace';
    default:
      break;
  }
  if (lower.length === 1) return lower.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function parseChord(text: string): Chord | null {
  const parts = text
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const chord: Chord = { ctrl: false, shift: false, alt: false, key: '' };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') {
      chord.ctrl = true;
    } else if (lower === 'shift') {
      chord.shift = true;
    } else if (lower === 'alt' || lower === 'option') {
      chord.alt = true;
    } else {
      chord.key = normalizeKey(part);
    }
  }
  return chord.key ? chord : null;
}

/** KeyboardEvent 的最小形状，方便单测传普通对象 */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

export function chordOf(e: KeyLike): Chord {
  return {
    ctrl: e.ctrlKey || Boolean(e.metaKey),
    shift: e.shiftKey,
    alt: e.altKey,
    key: normalizeKey(e.key),
  };
}

export function sameChord(a: Chord, b: Chord): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
}

export function formatChord(chord: Chord, spaced = false): string {
  const parts: string[] = [];
  for (const mod of MOD_ORDER) {
    if (mod === 'Ctrl' && chord.ctrl) parts.push('Ctrl');
    if (mod === 'Shift' && chord.shift) parts.push('Shift');
    if (mod === 'Alt' && chord.alt) parts.push('Alt');
  }
  parts.push(chord.key);
  return parts.join(spaced ? ' + ' : '+');
}
