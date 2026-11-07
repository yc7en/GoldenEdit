import { describe, expect, it } from 'vitest';

import { highlightRanges } from '../../shared/highlight';
import { findFences, offsetToPosition, rangeToMonaco } from './fences';

describe('findFences', () => {
  it('识别 ```lang 与闭栏，返回 1-based 源码行号', () => {
    const lines = ['# 标题', '```js', 'const x = 1;', '```', '正文'];
    expect(findFences(lines)).toEqual([
      { openLine: 2, closeLine: 4, lang: 'js', lines: ['const x = 1;'] },
    ]);
  });

  it('~~~ 围栏、信息串带额外属性时只取第一个词', () => {
    const lines = ['~~~python title="a.py"', 'def f():', '    pass', '~~~~'];
    expect(findFences(lines)).toEqual([
      {
        openLine: 1,
        closeLine: 4,
        lang: 'python',
        lines: ['def f():', '    pass'],
      },
    ]);
  });

  it('闭栏字符必须相同、长度不得短于开栏', () => {
    const lines = ['````js', 'a', '```', 'b', '````'];
    expect(findFences(lines)).toEqual([
      { openLine: 1, closeLine: 5, lang: 'js', lines: ['a', '```', 'b'] },
    ]);
  });

  it('最多 3 个空格缩进；4 个空格是缩进代码块，不是围栏', () => {
    expect(findFences(['   ```js', 'a', '   ```'])).toHaveLength(1);
    expect(findFences(['    ```js', 'a', '    ```'])).toHaveLength(0);
  });

  it('反引号围栏的信息串里再出现反引号则不算开栏，~~~ 不受此限制', () => {
    // 第 3 行那个 ``` 会被当成新的（未闭合）开栏，这是 markdown-it 的同样行为
    const backtick = findFences(['```js `x`', 'a', '```']);
    expect(backtick.some((f) => f.openLine === 1)).toBe(false);
    expect(findFences(['~~~js `x`', 'a', '~~~'])[0]).toMatchObject({ openLine: 1, lang: 'js' });
  });

  it('未闭合的围栏一直吃到文末', () => {
    const lines = ['```go', 'a', 'b'];
    expect(findFences(lines)).toEqual([
      { openLine: 1, closeLine: 3, lang: 'go', lines: ['a', 'b'] },
    ]);
  });

  it('多个围栏互不干扰，空代码块保留空行', () => {
    const lines = ['```js', 'a', '```', '', '```py', '', '```'];
    expect(findFences(lines).map((f) => [f.openLine, f.lang, f.lines])).toEqual([
      [1, 'js', ['a']],
      [5, 'py', ['']],
    ]);
  });

  it('无语言标注时 lang 为空串', () => {
    expect(findFences(['```', 'x', '```'])[0].lang).toBe('');
  });
});

describe('offsetToPosition / rangeToMonaco', () => {
  const fence = findFences(['# h', '```js', 'const x = 1;', 'let y = 2;', '```'])[0];

  it('第 0 个字符落在开栏的下一行第 1 列', () => {
    expect(offsetToPosition(fence, 0)).toEqual({ lineNumber: 3, column: 1 });
  });

  it('跨过第一行末尾的 \\n 后落到下一行第 1 列', () => {
    const first = 'const x = 1;'.length;
    expect(offsetToPosition(fence, first)).toEqual({ lineNumber: 3, column: first + 1 });
    expect(offsetToPosition(fence, first + 1)).toEqual({ lineNumber: 4, column: 1 });
  });

  it('区间换算成合法的 Monaco 行列', () => {
    const span = rangeToMonaco(fence, 0, 5);
    expect(span).toEqual({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 6,
    });
  });

  it('超出末尾的偏移量收敛到最后一行末尾，不产生越界行列', () => {
    const pos = offsetToPosition(fence, 10000);
    expect(pos.lineNumber).toBe(4);
    expect(pos.column).toBe('let y = 2;'.length + 1);
  });
});

describe('高亮区间 → Monaco 装饰（端到端纯函数链路）', () => {
  it('关键词区间换算后都落在围栏内部，且能取回原文词', () => {
    const lines = ['# 标题', '```js', 'const a = 1;', 'let b = "x";', '```', '结尾'];
    const [fence] = findFences(lines);
    const code = fence.lines.join('\n');
    const ranges = highlightRanges(code, fence.lang);
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) {
      const span = rangeToMonaco(fence, r.start, r.end);
      expect(span.startLineNumber).toBeGreaterThanOrEqual(fence.openLine + 1);
      expect(span.endLineNumber).toBeLessThanOrEqual(fence.closeLine - 1);
      expect(span.startLineNumber).toBeLessThanOrEqual(span.endLineNumber);
      expect(code.slice(r.start, r.end).trim().length).toBeGreaterThan(0);
    }
    expect(code.slice(ranges[0].start, ranges[0].end)).toBe('const');
  });

  it('实测：2 万行文档里定位围栏的耗时（打印到测试输出）', () => {
    const lines: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      lines.push(i % 20 === 0 ? '```js' : i % 20 === 5 ? '```' : `line ${i}`);
    }
    const t0 = performance.now();
    const fences = findFences(lines);
    const ms = performance.now() - t0;
    console.log(`[P26 perf] findFences 2 万行: ${ms.toFixed(1)} ms, ${fences.length} 个围栏`);
    expect(fences.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });
});
