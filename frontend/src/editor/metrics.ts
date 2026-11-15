/**
 * 编辑区的字号与行高换算（§8.1 区域缩放）。
 *
 * 单独成模块而不是写在 `index.ts` 里：状态栏要显示缩放比例，但它不能进
 * 编辑器的 bundle——一旦 import 了 `editor/index.ts`，Monaco 会被整块拉进主页面
 * 的同步 chunk。这里只放纯函数与常量，任何模块都可以安全引用。
 */

/** 默认字号（px）：与 `settings.rs`、`store.ts` 的默认值、设置页回退值保持一致 */
export const BASE_FONT_SIZE = 13;

/**
 * 行高 / 字号。Monaco 的 `lineHeight` 是**绝对值**，不会跟着 `fontSize` 变——
 * 只改字号会让大字号下的正文挤在一起甚至上下行重叠，所以两者必须一起算。
 */
export const LINE_HEIGHT_RATIO = 1.6;

/** 字号 → 行高（px）。取整避免 Monaco 在半像素上做额外换算 */
export function lineHeightFor(fontSize: number): number {
  return Math.round(fontSize * LINE_HEIGHT_RATIO);
}

/** 字号 → 相对默认字号的缩放百分比（状态栏展示用，13px = 100%） */
export function zoomPercent(fontSize: number, base = BASE_FONT_SIZE): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(base) || base <= 0) {
    return 100;
  }
  return Math.round((fontSize / base) * 100);
}
