import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';

import { highlightCode } from './highlight';

describe('highlightCode', () => {
  it('已注册语言输出 .hljs-* token', () => {
    const out = highlightCode('const x = 1;', 'javascript');
    expect(out).toContain('hljs-keyword');
    expect(out).toContain('hljs-number');
  });

  it('语言别名（js / py / yml / html / c++）也能命中', () => {
    expect(highlightCode('let a = 1', 'js')).toContain('hljs-keyword');
    expect(highlightCode('def f(): pass', 'py')).toContain('hljs-keyword');
    expect(highlightCode('key: value', 'yml')).toContain('hljs-attr');
    expect(highlightCode('<p>hi</p>', 'html')).toContain('hljs-tag');
    expect(highlightCode('int main() {}', 'c++')).toContain('hljs-type');
  });

  it('未标注语言 / 未注册语言返回空串，交给 markdown-it 转义原文', () => {
    expect(highlightCode('plain text', '')).toBe('');
    expect(highlightCode('some code', 'not-a-language')).toBe('');
  });

  it('高亮产物会转义 HTML，不会注入标签', () => {
    const out = highlightCode('const x = "<img src=x>";', 'js');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('超长 / 异常输入不会抛错', () => {
    expect(() => highlightCode('{'.repeat(20000), 'json')).not.toThrow();
  });

  it('接在 MarkdownIt 的 highlight 选项上，默认 fence 输出带 token 的 HTML', () => {
    const md = new MarkdownIt({ html: false, highlight: highlightCode });
    const html = md.render('```js\nconst x = 1;\n```\n');
    expect(html).toContain('language-js');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-number');
  });

  it('未标注语言的围栏仍输出转义后的原文', () => {
    const md = new MarkdownIt({ html: false, highlight: highlightCode });
    const html = md.render('```\n<b>x</b>\n```\n');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
