import { describe, expect, it } from 'vitest';

import { parseFrontmatter, renderFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('没有头部时原样返回正文', () => {
    const text = '# Heading\n\nBody';
    const r = parseFrontmatter(text);
    expect(r.body).toBe(text);
    expect(r.data).toEqual({});
    expect(r.lines).toBe(0);
    expect(r.error).toBeNull();
    expect(renderFrontmatter(r)).toBe('');
  });

  it('完整解析标量、数组、嵌套对象、注释与多行文本', () => {
    const text = [
      '---',
      'title: 设计评审纪要',
      'date: 2026-11-09',
      'draft: false',
      'weight: 3.5',
      'author: null',
      'tags: [设计, 前端, 评审]',
      '# 这是注释',
      'meta:',
      '  owner: Leo',
      '  links:',
      '    - a',
      '    - b',
      'desc: |',
      '  第一行',
      '  第二行',
      '---',
      '# 正文',
    ].join('\n');
    const r = parseFrontmatter(text);
    expect(r.error).toBeNull();
    expect(r.data.title).toBe('设计评审纪要');
    expect(r.data.date).toBe('2026-11-09');
    expect(r.data.draft).toBe(false);
    expect(r.data.weight).toBe(3.5);
    expect(r.data.author).toBeNull();
    expect(r.data.tags).toEqual(['设计', '前端', '评审']);
    expect(r.data.meta).toEqual({ owner: 'Leo', links: ['a', 'b'] });
    expect(r.data.desc).toBe('第一行\n第二行\n');
  });

  it('头部用等量空行占位，正文行号与源码严格对齐', () => {
    const text = '---\ntitle: x\ntags: [a, b]\n---\n# Heading\n\nBody';
    const r = parseFrontmatter(text);
    expect(r.lines).toBe(4);
    expect(r.body.split('\n')).toEqual(['', '', '', '', '# Heading', '', 'Body']);
    // 正文首个非空行落在索引 4，对应原文第 5 行
    expect(r.body.split('\n').findIndex((l) => l.trim() !== '')).toBe(4);
  });

  it('未闭合的分隔符不吞掉正文', () => {
    const text = '---\ntitle: x\n# Heading';
    const r = parseFrontmatter(text);
    expect(r.lines).toBe(0);
    expect(r.body).toBe(text);
    expect(r.data).toEqual({});
  });

  it('兼容 CRLF 与 BOM', () => {
    const r = parseFrontmatter('\uFEFF---\r\ntitle: x\r\n---\r\n# H');
    expect(r.error).toBeNull();
    expect(r.data.title).toBe('x');
    expect(r.body.split('\n')).toEqual(['', '', '', '# H']);
  });

  it('顶层不是键值映射时报错', () => {
    const r = parseFrontmatter('---\n- a\n- b\n---\n# H');
    expect(r.error?.line).toBe(2);
    expect(r.error?.message).toContain('顶层必须是键值映射');
    expect(r.data).toEqual({});
  });

  it('YAML 语法错误不抛异常，给出头部内的源码行号', () => {
    const r = parseFrontmatter('---\ntitle: ok\nbad: [a, b\n---\n# H');
    expect(r.error).not.toBeNull();
    expect(r.error?.line).toBeGreaterThanOrEqual(2);
    expect(r.error?.message).toContain('YAML 解析失败');
    expect(r.body.split('\n')).toContain('# H');
  });

  it('过滤可能触发原型污染的键', () => {
    const r = parseFrontmatter('---\n__proto__: evil\nconstructor: bad\ntitle: ok\n---\n');
    expect(Object.keys(r.data)).toEqual(['title']);
  });

  it('空头部也是合法 frontmatter', () => {
    const r = parseFrontmatter('---\n---\n# H');
    expect(r.lines).toBe(2);
    expect(r.data).toEqual({});
    expect(renderFrontmatter(r)).toContain('（空）');
  });
});

describe('renderFrontmatter', () => {
  it('输出可折叠面板，并按类型渲染', () => {
    const r = parseFrontmatter(
      '---\ntitle: Hi\ntags: [a, b]\ndraft: false\ndate: 2026-11-09\nmeta:\n  owner: Leo\n---\n# H'
    );
    const html = renderFrontmatter(r);
    expect(html).toContain('<details class="ge-fm" open>');
    expect(html).toContain('5 项');
    expect(html).toContain('ge-fm__chip');
    expect(html).toContain('ge-fm__bool--false');
    expect(html).toContain('ge-fm__date');
    expect(html).toContain('ge-fm__sub');
  });

  it('转义字段值，避免注入 HTML', () => {
    const r = parseFrontmatter('---\ntitle: "<script>alert(1)</script>"\n---\n');
    const html = renderFrontmatter(r);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('解析失败时展示错误与原文，不生成空面板', () => {
    const r = parseFrontmatter('---\nbad: [a, b\n---\n# H');
    const html = renderFrontmatter(r);
    expect(html).toContain('ge-fm--error');
    expect(html).toContain('解析失败');
    expect(html).toContain('bad: [a, b');
  });
});
