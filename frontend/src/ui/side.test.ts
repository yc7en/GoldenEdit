import { describe, expect, it } from 'vitest';
import {
  SIDE_DEFAULT,
  SIDE_MAX,
  SIDE_MIN,
  clampSideWidth,
  dragWidth,
  sameWidth,
} from './side';

describe('clampSideWidth', () => {
  it('区间内原样返回', () => {
    expect(clampSideWidth(240)).toBe(240);
  });

  it('低于下限抬到下限', () => {
    expect(clampSideWidth(60)).toBe(SIDE_MIN);
    expect(clampSideWidth(-500)).toBe(SIDE_MIN);
  });

  it('高于上限压到上限', () => {
    expect(clampSideWidth(1200)).toBe(SIDE_MAX);
  });

  it('非有限数回落默认宽度而不是 0', () => {
    expect(clampSideWidth(NaN)).toBe(SIDE_DEFAULT);
    expect(clampSideWidth(Infinity)).toBe(SIDE_DEFAULT);
  });

  it('取整，避免亚像素宽度写进设置', () => {
    expect(clampSideWidth(233.6)).toBe(234);
  });
});

describe('dragWidth', () => {
  it('起点加位移', () => {
    expect(dragWidth(208, 40)).toBe(248);
    expect(dragWidth(300, -40)).toBe(260);
  });

  it('拖过头仍停在区间内', () => {
    expect(dragWidth(208, -1000)).toBe(SIDE_MIN);
    expect(dragWidth(208, 1000)).toBe(SIDE_MAX);
  });
});

describe('sameWidth', () => {
  it('夹取后相等即视为没变', () => {
    // 停在左边界后再往左拖，值没变，不该触发落盘
    expect(sameWidth(180, 120)).toBe(true);
    expect(sameWidth(240, 240.2)).toBe(true);
  });

  it('真的变了要写盘', () => {
    expect(sameWidth(240, 300)).toBe(false);
  });
});
