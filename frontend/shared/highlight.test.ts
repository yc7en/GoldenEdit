import { describe, expect, it } from 'vitest';

import {
  HLJS_BUCKETS,
  bucketOf,
  highlightCode,
  highlightRanges,
  parseHighlightHtml,
} from './highlight';

describe('bucketOf', () => {
  it('把 hljs 类名映射到配色分桶，tiered scope 只看第一个 hljs- 类', () => {
    expect(bucketOf('hljs-keyword')).toBe('keyword');
    expect(bucketOf('hljs-title function_')).toBe('title');
    expect(bucketOf('hljs-built_in')).toBe('builtin');
    expect(bucketOf('language-xml')).toBeNull();
    expect(bucketOf('hljs-punctuation')).toBeNull();
  });

  it('分桶表没有重名类', () => {
    const all = Object.values(HLJS_BUCKETS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('parseHighlightHtml', () => {
  it('还原 hljs 的 5 种实体，片段拼回去等于原文', () => {
    const html = '<span class="hljs-string">&quot;&lt;a&gt;&amp;&quot;</span>&#x27;x&#x27;';
    const seg = parseHighlightHtml(html);
    expect(seg.map((s) => s.text).join('')).toBe('"<a>&"\'x\'');
    expect(seg[0].className).toBe('hljs-string');
    expect(seg[1].className).toBeNull();
  });

  it('嵌套 span 的 class 按栈回退', () => {
    const seg = parseHighlightHtml('<span class="hljs-meta">a<span class="hljs-string">b</span>c</span>');
    expect(seg.map((s) => `${s.text}:${s.className}`)).toEqual([
      'a:hljs-meta',
      'b:hljs-string',
      'c:hljs-meta',
    ]);
  });
});

describe('highlightRanges', () => {
  it('关键词 / 字符串的偏移量落在原文上（含实体转义）', () => {
    const code = 'const x = "<a>&";';
    const ranges = highlightRanges(code, 'js');
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) {
      expect(code.slice(r.start, r.end).length).toBe(r.end - r.start);
      expect(r.end).toBeLessThanOrEqual(code.length);
    }
    const kw = ranges.find((r) => r.bucket === 'keyword');
    expect(kw).toBeDefined();
    expect(code.slice(kw!.start, kw!.end)).toBe('const');
    const str = ranges.find((r) => r.bucket === 'string');
    expect(str).toBeDefined();
    expect(code.slice(str!.start, str!.end)).toBe('"<a>&"');
  });

  it('跨行字符串 / 注释也能切出区间，偏移量仍按 \\n 计', () => {
    const code = 'const a = 1;\n// 注释\nconst b = 2;';
    const ranges = highlightRanges(code, 'javascript');
    expect(ranges.some((r) => r.bucket === 'comment' && code.slice(r.start, r.end).includes('注释'))).toBe(true);
    const reconstructed = parseHighlightHtml(highlightCode(code, 'javascript')).map((s) => s.text).join('');
    expect(reconstructed).toBe(code);
  });

  it('别名与大小写：js / py / yml 都能命中', () => {
    expect(highlightRanges('let a = 1', 'js').some((r) => r.bucket === 'keyword')).toBe(true);
    expect(highlightRanges('def f(): pass', 'py').some((r) => r.bucket === 'keyword')).toBe(true);
    expect(highlightRanges('key: value', 'yml').length).toBeGreaterThan(0);
  });

  it('空语言 / 未注册语言 / 空代码返回空数组', () => {
    expect(highlightRanges('const a = 1', '')).toEqual([]);
    expect(highlightRanges('const a = 1', 'not-a-lang')).toEqual([]);
    expect(highlightRanges('', 'js')).toEqual([]);
  });

  it('逐字符对齐防线：解析结果拼不回原文时整块放弃', () => {
    // 这里用真实 hljs 输出，正常情况下必然对齐；断言它不会退化成空
    const code = '😀 const x = 1;';
    expect(highlightRanges(code, 'js').length).toBeGreaterThan(0);
  });

  it('超长输入不抛错且区间数有上限', () => {
    const code = 'const x = 1;\n'.repeat(5000);
    const ranges = highlightRanges(code, 'js');
    expect(ranges.length).toBeLessThanOrEqual(4000);
  });

  it('实测：1000 行 JS 的区间计算耗时（打印到测试输出）', () => {
    const code = 'const value = "hello"; // line\n'.repeat(1000);
    const t0 = performance.now();
    const ranges = highlightRanges(code, 'js');
    const ms = performance.now() - t0;
    console.log(`[P26 perf] highlightRanges 1000 行 JS: ${ms.toFixed(1)} ms, ${ranges.length} 段`);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});
