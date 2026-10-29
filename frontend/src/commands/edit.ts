/**
 * 编辑区系统命令（ARCHITECTURE §8.3）。
 *
 * 复制 / 剪切 / 粘贴不自己碰剪贴板，一律转调 Monaco 的 action：
 * 这样不需要新增剪贴板依赖，也不会在 WebView2 里撞上「读剪贴板需要权限」的墙。
 */

import { registerCommands } from './registry';

export interface EditActions {
  /** 触发 Monaco 内置 action，如 editor.action.clipboardCopyAction */
  trigger: (action: string) => void;
  /** 有选区才能复制 / 剪切 */
  hasSelection: () => boolean;
}

export function registerEditCommands(a: EditActions): void {
  const editorWhen = ['editor'] as const;

  registerCommands([
    {
      id: 'edit.copy',
      title: '复制',
      group: '剪贴板',
      when: [...editorWhen],
      default: 'Ctrl+C',
      source: 'system',
      // 键位交给 Monaco：它已经处理得很好，抢过来只是多一层失败点（§8.4）
      native: true,
      enabled: () => a.hasSelection(),
      run: () => a.trigger('editor.action.clipboardCopyAction'),
    },
    {
      id: 'edit.cut',
      title: '剪切',
      group: '剪贴板',
      when: [...editorWhen],
      default: 'Ctrl+X',
      source: 'system',
      native: true,
      enabled: () => a.hasSelection(),
      run: () => a.trigger('editor.action.clipboardCutAction'),
    },
    {
      id: 'edit.paste',
      title: '粘贴',
      group: '剪贴板',
      when: [...editorWhen],
      default: 'Ctrl+V',
      source: 'system',
      native: true,
      run: () => a.trigger('editor.action.clipboardPasteAction'),
    },
  ]);
}
