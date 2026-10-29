import { describe, expect, it } from 'vitest';

import {
  blockKey,
  blockLine,
  blockSource,
  fnv1a,
  splitBlocks,
  stripForbiddenAttrs,
  stripScripts,
  type MdToken,
} from './blocks';

function token(partial: Partial<MdToken> & { type: string }): MdToken {
  return {
    tag: '',
    nesting: 0,
    level: 0,
    map: null,
    content: '',
    info: '',
    markup: '',
    hidden: false,
    ...partial,
  };
}

describe('fnv1a / blockKey', () => {
  it('同一输入稳定、不同输入不同', () => {
    expect(fnv1a('a')).toBe(fnv1a('a'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  it('key 同时受源码、插件集与主题影响', () => {
    const base = blockKey('# a', [], 'light');
    expect(blockKey('# a', [], 'light')).toBe(base);
    expect(blockKey('# b', [], 'light')).not.toBe(base);
    expect(blockKey('# a', ['callout@1'], 'light')).not.toBe(base);
    expect(blockKey('# a', [], 'dark')).not.toBe(base);
  });

  it('插件顺序不同视为不同 key（诊断信息参与 hash，可接受）', () => {
    expect(blockKey('x', ['a@1', 'b@1'], 'light')).not.toBe(blockKey('x', ['b@1', 'a@1'], 'light'));
  });
});

describe('splitBlocks', () => {
  it('顶层 token 开新块，闭合 token 归入当前块', () => {
    const tokens = [
      token({ type: 'heading_open', map: [0, 1], level: 0 }),
      token({ type: 'inline', map: [0, 1], level: 1 }),
      token({ type: 'heading_close', level: 0 }),
      token({ type: 'paragraph_open', map: [2, 3], level: 0 }),
      token({ type: 'inline', map: [2, 3], level: 1 }),
      token({ type: 'paragraph_close', level: 0 }),
    ];
    const groups = splitBlocks(tokens);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((t) => t.type)).toEqual(['heading_open', 'inline', 'heading_close']);
    expect(groups[1].map((t) => t.type)).toEqual(['paragraph_open', 'inline', 'paragraph_close']);
  });

  it('没有 map 的 token 不会凭空开新块', () => {
    const tokens = [
      token({ type: 'paragraph_open', map: [0, 2] }),
      token({ type: 'inline', map: [0, 2], level: 1 }),
      token({ type: 'paragraph_close', level: 0 }),
    ];
    expect(splitBlocks(tokens)).toHaveLength(1);
  });

  it('行号与源码按块的首个 map 取，1 基行号', () => {
    const lines = ['# 标题', '', '正文一', '正文二'];
    const group = [token({ type: 'paragraph_open', map: [2, 4] }), token({ type: 'inline', map: [2, 4], level: 1 })];
    expect(blockLine(group)).toBe(3);
    expect(blockSource(group, lines)).toBe('正文一\n正文二');
  });

  it('空 token 列表得到空结果（不抛错）', () => {
    expect(splitBlocks([])).toEqual([]);
  });
});

describe('安全清洗', () => {
  it('剥掉插件输出的 data-line，避免覆盖块行号', () => {
    const out = stripForbiddenAttrs('<div data-line="9" class="x">a</div>');
    expect(out.stripped).toBe(true);
    expect(out.html).toBe('<div class="x">a</div>');
  });

  it('没有 data-line 时原样返回', () => {
    const html = '<div class="x">a</div>';
    expect(stripForbiddenAttrs(html)).toEqual({ html, stripped: false });
  });

  it('去掉 script 但保留样式与内联 SVG', () => {
    const html = '<style>.a{}</style><script>alert(1)</script><svg><circle /></svg>';
    expect(stripScripts(html)).toBe('<style>.a{}</style><svg><circle /></svg>');
  });
});
