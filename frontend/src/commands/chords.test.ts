import { describe, expect, it } from 'vitest';

import {
  chordOf,
  formatChord,
  normalizeKey,
  parseChord,
  sameChord,
  type Chord,
} from './chords';

describe('normalizeKey', () => {
  it('把常见别名收敛成同一个键名', () => {
    expect(normalizeKey('esc')).toBe('Esc');
    expect(normalizeKey('Escape')).toBe('Esc');
    expect(normalizeKey('del')).toBe('Del');
    expect(normalizeKey('Delete')).toBe('Del');
    expect(normalizeKey('arrowup')).toBe('UpArrow');
    expect(normalizeKey('Up')).toBe('UpArrow');
    expect(normalizeKey('Backspace')).toBe('Backspace');
  });

  it('单字符统一大写，其余首字母大写', () => {
    expect(normalizeKey('p')).toBe('P');
    expect(normalizeKey('P')).toBe('P');
    expect(normalizeKey('f2')).toBe('F2');
  });

  it('空串返回空串，不抛错', () => {
    expect(normalizeKey('   ')).toBe('');
  });
});

describe('parseChord', () => {
  it('解析修饰键与主键', () => {
    expect(parseChord('Ctrl+Shift+P')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      key: 'P',
    });
  });

  it('接受小写与别名写法', () => {
    const a = parseChord('ctrl+shift+p');
    const b = parseChord('Control+Shift+P');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(sameChord(a!, b!)).toBe(true);
  });

  it('Cmd / Meta 归一到 ctrl，Win 上不需要分支', () => {
    const cmd = parseChord('Cmd+K');
    expect(cmd?.ctrl).toBe(true);
    expect(cmd?.key).toBe('K');
  });

  it('只有一个主键也合法', () => {
    expect(parseChord('F2')).toEqual({ ctrl: false, shift: false, alt: false, key: 'F2' });
  });

  it('只有修饰键时视为无效', () => {
    expect(parseChord('Ctrl+Shift')).toBeNull();
    expect(parseChord('')).toBeNull();
  });
});

describe('chordOf', () => {
  it('把 KeyboardEvent 形状转成 Chord', () => {
    const e = { key: 'p', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(chordOf(e)).toEqual({ ctrl: true, shift: true, alt: false, key: 'P' });
  });

  it('metaKey 等价于 Ctrl', () => {
    const e = { key: 'k', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
    expect(chordOf(e).ctrl).toBe(true);
  });
});

describe('formatChord', () => {
  it('修饰键顺序固定为 Ctrl → Shift → Alt', () => {
    const chord: Chord = { ctrl: true, shift: true, alt: true, key: 'X' };
    expect(formatChord(chord)).toBe('Ctrl+Shift+Alt+X');
    expect(formatChord(chord, true)).toBe('Ctrl + Shift + Alt + X');
  });

  it('解析再格式化能还原（大小写归一后）', () => {
    expect(formatChord(parseChord('shift+ctrl+o')!)).toBe('Ctrl+Shift+O');
  });
});

describe('sameChord', () => {
  it('四个维度任一不同即不相等', () => {
    const base = parseChord('Ctrl+K')!;
    expect(sameChord(base, parseChord('Ctrl+K')!)).toBe(true);
    expect(sameChord(base, parseChord('Shift+K')!)).toBe(false);
    expect(sameChord(base, parseChord('Ctrl+Shift+K')!)).toBe(false);
    expect(sameChord(base, parseChord('Ctrl+J')!)).toBe(false);
  });
});
