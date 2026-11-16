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
  /** 行内标记开关：有选区就包裹 / 剥掉，无选区插入成对标记并把光标停在中间 */
  wrapInline: (prefix: string, suffix?: string) => void;
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

    /* 行内格式：只有编辑区有焦点时才响应，避免在文件树里按 Ctrl+B 改文档 */
    {
      id: 'edit.bold',
      title: '加粗',
      group: '格式',
      when: [...editorWhen],
      default: 'Ctrl+B',
      source: 'system',
      run: () => a.wrapInline('**'),
    },
    {
      id: 'edit.italic',
      title: '斜体',
      group: '格式',
      when: [...editorWhen],
      default: 'Ctrl+I',
      source: 'system',
      run: () => a.wrapInline('*'),
    },
    {
      id: 'edit.strikethrough',
      title: '删除线',
      group: '格式',
      when: [...editorWhen],
      default: 'Ctrl+~',
      source: 'system',
      run: () => a.wrapInline('~~'),
    },
  ]);
}
