/**
 * 左栏宽度的纯计算部分（§8.1）。
 *
 * 抽出来是因为这段最容易出错也最容易被反复改动：越界、设置里被手改成脏值、
 * 拖到负数窗口外。放在这里就能被 vitest 直接覆盖，不必起一个浏览器。
 */

export const SIDE_MIN = 180;
export const SIDE_MAX = 420;
export const SIDE_DEFAULT = 208;

/**
 * 把任意输入夹到允许区间。
 * 非有限数（NaN / Infinity / undefined 强转）回落到默认宽度，
 * 而不是回落到 0——宽度 0 会让左栏直接消失，看起来像崩溃。
 */
export function clampSideWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDE_DEFAULT;
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(w)));
}

/** 拖动中的目标宽度：起点宽度 + 指针位移，再夹一次 */
export function dragWidth(startWidth: number, dx: number): number {
  return clampSideWidth(startWidth + dx);
}

/**
 * 设置里的宽度是否已经等于夹取后的值。
 * 用来决定松手时要不要写盘：拖动常常在边界处停下，此时值没变，不该刷一次 settings.json。
 */
export function sameWidth(a: number, b: number): boolean {
  return clampSideWidth(a) === clampSideWidth(b);
}
