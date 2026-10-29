import { describe, expect, it } from 'vitest';

// 插件是纯 JS（没有构建步骤），用动态 import 拿纯函数做单测；
// 静态 import 一个 .js 需要 allowJs，为此改 tsconfig 不值得。
const entryPath = '../../plugins/markdown-tools/entry.js';
type Entry = {
  textWidth: (s: string) => number;
  alignTables: (lines: string[]) => string[];
  toTask: (line: string) => string;
  markDone: (line: string, date: string) => string;
  markUndone: (line: string) => string;
  clearTask: (line: string) => string;
  formatDate: (d: Date, p: string) => string;
};

const mod = (await import(entryPath)) as unknown as Entry;

describe('textWidth', () => {
  it('CJK 计 2，ASCII 计 1', () => {
    expect(mod.textWidth('文件')).toBe(4);
    expect(mod.textWidth('docs')).toBe(4);
    expect(mod.textWidth('文件 docs')).toBe(9);
  });

  it('零宽字符不占列', () => {
    expect(mod.textWidth('a\u200bb')).toBe(2);
  });
});

describe('alignTables', () => {
  it('把用户给的例子对齐', () => {
    const before = [
      '| 文件 | 职责 |',
      '|---|----|',
      '| `docs/Features.md` | 功能清单。每条一句话，带状态标记。 |',
      '| `docs/ChangeLog.md` | 变更流水，按时间倒序。 |',
    ];
    const after = mod.alignTables(before);

    // 每行的列宽（按显示宽度，CJK 算 2）必须完全一致
    const widths = after.map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => mod.textWidth(cell))
    );
    for (const row of widths) expect(row).toEqual(widths[0]);
    expect(after[1]).toMatch(/^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/);
    expect(after[2]).toContain('`docs/Features.md`');
  });

  it('保留对齐标记', () => {
    const after = mod.alignTables(['| a | b | c |', '|:--|:-:|--:|', '| 1 | 2 | 3 |']);
    expect(after[1]).toContain(':');
    const cells = after[1]
      .slice(1, -1)
      .split('|')
      .map((s) => s.trim());
    expect(cells[0].startsWith(':')).toBe(true);
    expect(cells[1].startsWith(':') && cells[1].endsWith(':')).toBe(true);
    expect(cells[2].endsWith(':')).toBe(true);
  });

  it('fenced code block 里的管道不动', () => {
    const before = ['```', '| a | b |', '|---|---|', '```'];
    expect(mod.alignTables(before)).toEqual(before);
  });

  it('原本就对齐时是恒等变换', () => {
    const already = ['| a   | b   |', '| --- | --- |', '| 1   | 2   |'];
    expect(mod.alignTables(already)).toEqual(already);
  });

  it('中间缺分隔行的管道块不当表格', () => {
    const before = ['| a | b |', '| 1 | 2 |'];
    expect(mod.alignTables(before)).toEqual(before);
  });
});

describe('待办', () => {
  it('普通段落转成 - [ ]', () => {
    expect(mod.toTask('把衣服洗一下')).toBe('- [ ] 把衣服洗一下');
  });

  it('复用已有列表前缀', () => {
    expect(mod.toTask('- 把衣服洗一下')).toBe('- [ ] 把衣服洗一下');
    expect(mod.toTask('1. 把衣服洗一下')).toBe('1. [ ] 把衣服洗一下');
    expect(mod.toTask('  - 把衣服洗一下')).toBe('  - [ ] 把衣服洗一下');
  });

  it('已是待办时幂等', () => {
    expect(mod.toTask('- [ ] 把衣服洗一下')).toBe('- [ ] 把衣服洗一下');
    expect(mod.toTask('- [x] ~~把衣服洗一下~~ 2026年10月29日 11:12')).toBe(
      '- [ ] 把衣服洗一下'
    );
  });

  it('标记完成加删除线与日期', () => {
    expect(mod.markDone('- [ ] 把衣服洗一下', '2026年10月29日 11:12')).toBe(
      '- [x] ~~把衣服洗一下~~ 2026年10月29日 11:12'
    );
  });

  it('重复标记完成不叠加', () => {
    const once = mod.markDone('- [ ] 把衣服洗一下', '2026年10月29日 11:12');
    expect(mod.markDone(once, '2026年10月30日 09:00')).toBe(
      '- [x] ~~把衣服洗一下~~ 2026年10月30日 09:00'
    );
  });

  it('非待办行直接标记完成会先转成待办', () => {
    expect(mod.markDone('把衣服洗一下', 'D')).toBe('- [x] ~~把衣服洗一下~~ D');
  });

  it('取消完成只留删除线里的内容与列表前缀', () => {
    expect(mod.markUndone('- [x] ~~把衣服洗一下~~ 2026年10月29日 11:12')).toBe(
      '- [ ] 把衣服洗一下'
    );
    expect(mod.clearTask('- [x] ~~把衣服洗一下~~ 2026年10月29日 11:12')).toBe(
      '- 把衣服洗一下'
    );
  });
});

describe('formatDate', () => {
  it('按占位符替换', () => {
    const d = new Date(2026, 9, 29, 11, 12);
    expect(mod.formatDate(d, 'YYYY年M月D日 HH:mm')).toBe('2026年10月29日 11:12');
    expect(mod.formatDate(d, 'YYYY-MM-DD')).toBe('2026-10-29');
  });
});
