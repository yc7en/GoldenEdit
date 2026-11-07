/**
 * 区域开关按钮的状态推导（§8.1 区域保留）。
 *
 * 抽成纯函数是因为它同时驱动按钮的 on 态、disabled 态与 title 文案，
 * 且有三条触发路径（点按钮、快捷键、双击分隔条）——写在事件处理里，
 * 三处迟早漂移成「按钮亮着但点了没反应」。
 *
 * 规则（用户确认，2026-11-07）：左栏不受限；编辑区与预览区至少保留一个，
 * 因为两者是内容的唯一承载。
 */

export interface LayoutFlags {
  /** 编辑区被隐藏（`layout-preview`，即「仅预览」布局） */
  editorHidden: boolean;
  /** 预览被隐藏（`preview-hidden`，即「仅编辑」布局） */
  previewHidden: boolean;
}

export interface PaneButtonState {
  /** 区域当前是否可见 */
  on: boolean;
  /** 关闭它是否被「至少保留一个」规则挡住 */
  disabled: boolean;
  title: string;
}

export interface PaneButtons {
  editor: PaneButtonState;
  preview: PaneButtonState;
}

const EDITOR_TITLE = '编辑区 (Ctrl+Shift+E)';
const PREVIEW_TITLE = '预览面板 (Ctrl+Shift+V)';
const EDITOR_LOCKED = '预览面板已收起，编辑区不能同时关闭';
const PREVIEW_LOCKED = '编辑区已收起，预览面板不能同时关闭';

/**
 * 两个 hidden 标志在正常流程下互斥（`applyLayout` 一次只落一种布局），
 * 但旧版 `ui-state.json` 或手动改 DOM 可能留下双 true 的脏态——那时内容区
 * 会完全消失。这里按保守方向解读：编辑区优先视为可见，预览视为已关。
 */
export function derivePaneButtons(flags: LayoutFlags): PaneButtons {
  const dirtyBoth = flags.editorHidden && flags.previewHidden;
  const editorVisible = !flags.editorHidden || dirtyBoth;
  const previewVisible = !flags.previewHidden && !dirtyBoth;

  const locked = (selfVisible: boolean, otherVisible: boolean): boolean =>
    selfVisible && !otherVisible;

  const editor: PaneButtonState = {
    on: editorVisible,
    disabled: locked(editorVisible, previewVisible),
    title: locked(editorVisible, previewVisible) ? EDITOR_LOCKED : EDITOR_TITLE,
  };
  const preview: PaneButtonState = {
    on: previewVisible,
    disabled: locked(previewVisible, editorVisible),
    title: locked(previewVisible, editorVisible) ? PREVIEW_LOCKED : PREVIEW_TITLE,
  };
  return { editor, preview };
}
