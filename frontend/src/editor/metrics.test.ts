import { describe, expect, it } from 'vitest';
import { BASE_FONT_SIZE, LINE_HEIGHT_RATIO, lineHeightFor, zoomPercent } from './metrics';

describe('lineHeightFor', () => {
  it('默认字号下的行高与重构前的 13/21 一致，不改变既有观感', () => {
    expect(BASE_FONT_SIZE).toBe(13);
    expect(lineHeightFor(BASE_FONT_SIZE)).toBe(21);
  });

  it('行高严格随字号增长，放大后不会挤在一起', () => {
    let prev = 0;
    for (let size = 10; size <= 28; size += 1) {
      const lh = lineHeightFor(size);
      // 行高必须始终大于字号，否则上下行会重叠
      expect(lh).toBeGreaterThan(size);
      expect(lh).toBeGreaterThan(prev);
      prev = lh;
    }
  });

  it('最大字号下的行高留足行间距', () => {
    expect(lineHeightFor(28)).toBe(Math.round(28 * LINE_HEIGHT_RATIO));
    expect(lineHeightFor(28)).toBe(45);
  });
});

describe('zoomPercent', () => {
  it('默认字号是 100%', () => {
    expect(zoomPercent(BASE_FONT_SIZE)).toBe(100);
  });

  it('按比例四舍五入，与预览倍率同为百分比语义', () => {
    expect(zoomPercent(10)).toBe(77);
    expect(zoomPercent(20)).toBe(154);
    expect(zoomPercent(28)).toBe(215);
  });

  it('非法输入回落到 100%，不把 NaN 显示到状态条', () => {
    expect(zoomPercent(Number.NaN)).toBe(100);
    expect(zoomPercent(0)).toBe(100);
    expect(zoomPercent(-3)).toBe(100);
    expect(zoomPercent(13, 0)).toBe(100);
  });
});
