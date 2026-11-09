import { describe, expect, it } from 'vitest';

import { assetBaseOf, assetUrl } from './assets';

const BASE = 'http://127.0.0.1:5123/p/tok123/';

describe('assetBaseOf', () => {
  it('从外壳地址取出资源前缀', () => {
    expect(assetBaseOf('http://127.0.0.1:5123/p/tok123/shell/')).toBe(BASE);
  });

  it('不认识的形态不接管', () => {
    expect(assetBaseOf('http://127.0.0.1:5123/')).toBe('');
    expect(assetBaseOf('')).toBe('');
  });
});

describe('assetUrl', () => {
  it('相对当前文档目录解析', () => {
    expect(assetUrl(BASE, 'docs/trade', 'image/a.jpg')).toBe(`${BASE}asset?p=docs%2Ftrade%2Fimage%2Fa.jpg`);
  });

  it('工作区根目录下的文档直接取相对路径', () => {
    expect(assetUrl(BASE, '', 'image/a.jpg')).toBe(`${BASE}asset?p=image%2Fa.jpg`);
  });

  it('以 / 开头按工作区根解析', () => {
    expect(assetUrl(BASE, 'docs/trade', '/image/a.jpg')).toBe(`${BASE}asset?p=image%2Fa.jpg`);
  });

  it('归一 . 与 .. 段', () => {
    expect(assetUrl(BASE, 'docs/trade', './image/../image/a.jpg')).toBe(
      `${BASE}asset?p=docs%2Ftrade%2Fimage%2Fa.jpg`
    );
  });

  it('越出工作区时原样返回', () => {
    expect(assetUrl(BASE, 'docs', '../../secret.png')).toBe('../../secret.png');
  });

  it('绝对地址与数据 URI 不接管', () => {
    for (const src of [
      'https://example.com/a.png',
      'data:image/png;base64,AAA',
      '//cdn.example.com/a.png',
      'C:/pics/a.png',
    ]) {
      expect(assetUrl(BASE, 'docs', src)).toBe(src);
    }
  });

  it('去掉查询串与锚点，已编码的路径不二次编码', () => {
    expect(assetUrl(BASE, '', 'image/a%20b.png?v=2#x')).toBe(`${BASE}asset?p=image%2Fa%20b.png`);
  });

  it('反斜杠按分隔符处理', () => {
    expect(assetUrl(BASE, 'docs', 'image\\a.jpg')).toBe(`${BASE}asset?p=docs%2Fimage%2Fa.jpg`);
  });

  it('中文与空格正常编码', () => {
    expect(assetUrl(BASE, '', '图 片/a.jpg')).toBe(`${BASE}asset?p=${encodeURIComponent('图 片/a.jpg')}`);
  });
});
