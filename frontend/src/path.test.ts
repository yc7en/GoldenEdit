import { describe, expect, it } from 'vitest';

import { isInsideRoot, toPosixPath, trimSlash } from './path';

describe('toPosixPath', () => {
  it('抹平 Windows 反斜杠', () => {
    expect(toPosixPath('J:\\CODE\\GoldenEdit\\docs')).toBe('J:/CODE/GoldenEdit/docs');
  });

  it('剥掉长路径前缀，后端 canonicalize 出来的就是这个形式', () => {
    expect(toPosixPath('\\\\?\\J:\\CODE\\GoldenEdit\\docs')).toBe('J:/CODE/GoldenEdit/docs');
  });

  it('UNC 前缀还原成网络路径', () => {
    expect(toPosixPath('\\\\?\\UNC\\nas\\share\\a.md')).toBe('//nas/share/a.md');
  });

  it('正斜杠与已是干净路径的输入原样返回', () => {
    expect(toPosixPath('J:/CODE/a.md')).toBe('J:/CODE/a.md');
    expect(toPosixPath('/home/leo/a.md')).toBe('/home/leo/a.md');
  });

  it('不动大小写——切片回传时改了大小写就开不对文件', () => {
    expect(toPosixPath('\\\\?\\J:\\CODE\\README.md')).toBe('J:/CODE/README.md');
  });
});

describe('trimSlash', () => {
  it('去掉尾部斜杠', () => {
    expect(trimSlash('J:/CODE/GoldenEdit/docs/')).toBe('J:/CODE/GoldenEdit/docs');
  });

  it('盘符根本身不要被削成空串', () => {
    expect(trimSlash('J:/')).toBe('J:/');
    expect(trimSlash('/')).toBe('/');
  });
});

describe('isInsideRoot', () => {
  const root = 'J:/CODE/GoldenEdit/docs';

  it('工作区内的文件判定为在内（反斜杠输入也算）', () => {
    expect(isInsideRoot('J:\\CODE\\GoldenEdit\\docs\\demo.md', root)).toBe(true);
  });

  it('带长路径前缀的输入也算在内', () => {
    expect(isInsideRoot('\\\\?\\J:\\CODE\\GoldenEdit\\docs\\demo.md', root)).toBe(true);
  });

  it('大小写不同不影响判定', () => {
    expect(isInsideRoot('j:/code/goldenedit/DOCS/demo.md', root)).toBe(true);
  });

  it('根目录自身的尾斜杠不影响判定', () => {
    expect(isInsideRoot('J:/CODE/GoldenEdit/docs/a.md', `${root}/`)).toBe(true);
  });

  it('前缀相同但不在同一目录的路径要判在外面', () => {
    expect(isInsideRoot('J:/CODE/GoldenEdit/docs-old/a.md', root)).toBe(false);
  });

  it('上级目录判在外面', () => {
    expect(isInsideRoot('J:/CODE/GoldenEdit/README.md', root)).toBe(false);
  });

  it('root 为空时一律判在外面', () => {
    expect(isInsideRoot('J:/CODE/a.md', '')).toBe(false);
  });
});
