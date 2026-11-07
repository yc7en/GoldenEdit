import { describe, expect, it } from 'vitest';
import { derivePaneButtons } from './panes';

describe('derivePaneButtons（区域保留规则）', () => {
  it('分栏布局：两个按钮都开、都可用', () => {
    const r = derivePaneButtons({ editorHidden: false, previewHidden: false });
    expect(r.editor).toMatchObject({ on: true, disabled: false });
    expect(r.preview).toMatchObject({ on: true, disabled: false });
  });

  it('仅编辑布局：编辑区是唯一内容区，编辑按钮被挡住', () => {
    const r = derivePaneButtons({ editorHidden: false, previewHidden: true });
    expect(r.editor).toMatchObject({ on: true, disabled: true });
    expect(r.editor.title).toContain('不能同时关闭');
    expect(r.preview).toMatchObject({ on: false, disabled: false });
  });

  it('仅预览布局：预览按钮被挡住，编辑按钮可点（打开）', () => {
    const r = derivePaneButtons({ editorHidden: true, previewHidden: false });
    expect(r.editor).toMatchObject({ on: false, disabled: false });
    expect(r.preview).toMatchObject({ on: true, disabled: true });
    expect(r.preview.title).toContain('不能同时关闭');
  });

  it('双 true 脏态：按保守方向解读，编辑视为可见、预览视为已关，不出现两个都 disabled', () => {
    const r = derivePaneButtons({ editorHidden: true, previewHidden: true });
    expect(r.editor.disabled).toBe(true);
    expect(r.preview.on).toBe(false);
    // 至少有一个按钮能打开一个内容区，界面不会无解
    expect(r.preview.disabled).toBe(false);
  });

  it('title 正常态带快捷键提示', () => {
    const r = derivePaneButtons({ editorHidden: false, previewHidden: false });
    expect(r.editor.title).toContain('Ctrl+Shift+E');
    expect(r.preview.title).toContain('Ctrl+Shift+V');
  });
});
