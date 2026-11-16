import { describe, expect, it } from 'vitest';

import { planInlineToggle, type TextProbe } from './inline';

/** 用若干行文本造一个最小 probe：行列与 Monaco 一样是 1-based */
function probeOf(lines: string[]): TextProbe {
  return {
    lineMaxColumn: (line) => (lines[line - 1]?.length ?? 0) + 1,
    textBetween: (sl, sc, el, ec) => {
      if (sl === el) return (lines[sl - 1] ?? '').slice(sc - 1, ec - 1);
      const head = (lines[sl - 1] ?? '').slice(sc - 1);
      const mid = lines.slice(sl, el - 1);
      const tail = (lines[el - 1] ?? '').slice(0, ec - 1);
      return [head, ...mid, tail].join('\n');
    },
  };
}

/** 按 edits 实际重放一次，验证结果与替换后的选区都落在预期位置 */
function replay(lines: string[], plan: ReturnType<typeof planInlineToggle>): string {
  const text = lines.join('\n');
  const offsets = (line: number, col: number): number =>
    lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;

  const ops = [...plan.edits].sort((a, b) => offsets(b.startLine, b.startColumn) - offsets(a.startLine, a.startColumn));
  let out = text;
  for (const op of ops) {
    const from = offsets(op.startLine, op.startColumn);
    const to = offsets(op.endLine, op.endColumn);
    out = out.slice(0, from) + op.text + out.slice(to);
  }
  return out;
}

/** 把计划后的选区换算成字符偏移，方便断言落在哪几个字上。
 *  坐标是**编辑之后**的文本坐标，所以要先 replay 一次。 */
function selectionText(lines: string[], plan: ReturnType<typeof planInlineToggle>): string {
  const after = replay(lines, plan).split('\n');
  const text = after.join('\n');
  const offsets = (line: number, col: number): number =>
    after.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  return text.slice(
    offsets(plan.selection.startLine, plan.selection.startColumn),
    offsets(plan.selection.endLine, plan.selection.endColumn)
  );
}

describe('planInlineToggle', () => {
  it('空选区插入成对标记，光标停在两者之间', () => {
    const lines = ['hello'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 6, endLine: 1, endColumn: 6, empty: true },
      probeOf(lines),
      '**',
      '**'
    );
    expect(replay(lines, plan)).toBe('hello****');
    expect(plan.selection).toEqual({ startLine: 1, startColumn: 8, endLine: 1, endColumn: 8 });
    expect(selectionText(lines, plan)).toBe('');
  });

  it('包裹选区后选区仍罩住原文字，位置后移标记长度', () => {
    const lines = ['hello world'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6, empty: false },
      probeOf(lines),
      '**',
      '**'
    );
    expect(replay(lines, plan)).toBe('**hello** world');
    expect(plan.selection).toEqual({ startLine: 1, startColumn: 3, endLine: 1, endColumn: 8 });
    expect(selectionText(lines, plan)).toBe('hello');
  });

  it('已经包裹时再按一次就剥掉，选区收回原文字', () => {
    const lines = ['**hello** world'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 3, endLine: 1, endColumn: 8, empty: false },
      probeOf(lines),
      '**',
      '**'
    );
    expect(replay(lines, plan)).toBe('hello world');
    expect(plan.selection).toEqual({ startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 });
    expect(selectionText(lines, plan)).toBe('hello');
  });

  it('只包住一半不算已包裹，仍然再包一层', () => {
    const lines = ['**hello world'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 3, endLine: 1, endColumn: 8, empty: false },
      probeOf(lines),
      '**',
      '**'
    );
    expect(replay(lines, plan)).toBe('****hello** world');
  });

  it('选区贴着行首时不会因为列号越界而算错', () => {
    const lines = ['hello'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6, empty: false },
      probeOf(lines),
      '~~',
      '~~'
    );
    expect(replay(lines, plan)).toBe('~~hello~~');
    // before 为空、after 为空 → 不是已包裹，走包裹分支
    expect(plan.edits).toHaveLength(2);
  });

  it('跨行选区只位移第一行，末行末尾插入不改变末行起点', () => {
    const lines = ['first', 'second'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 1, endLine: 2, endColumn: 7, empty: false },
      probeOf(lines),
      '~~',
      '~~'
    );
    expect(replay(lines, plan)).toBe('~~first\nsecond~~');
    expect(plan.selection).toEqual({ startLine: 1, startColumn: 3, endLine: 2, endColumn: 7 });
    expect(selectionText(lines, plan)).toBe('first\nsecond');
  });

  it('跨行已包裹时末行选区只回退 suffix 长度', () => {
    const lines = ['~~first', 'second~~'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 3, endLine: 2, endColumn: 7, empty: false },
      probeOf(lines),
      '~~',
      '~~'
    );
    expect(replay(lines, plan)).toBe('first\nsecond');
    expect(plan.selection).toEqual({ startLine: 1, startColumn: 1, endLine: 2, endColumn: 7 });
  });

  it('斜体从加粗里剥一层：只认最外侧的那一对', () => {
    const lines = ['**bold**'];
    const plan = planInlineToggle(
      { startLine: 1, startColumn: 3, endLine: 1, endColumn: 7, empty: false },
      probeOf(lines),
      '*',
      '*'
    );
    // 外侧各一个 * 命中斜体 → 剥掉，得到 *bold*
    expect(replay(lines, plan)).toBe('*bold*');
  });
});
