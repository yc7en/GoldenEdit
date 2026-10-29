/**
 * 预览区命令（ARCHITECTURE §8.3）。
 *
 * 预览在 iframe 里，剪贴板写入只能在宿主做——外壳把选中文本随右键消息带上来，
 * 这里负责落进系统剪贴板。
 */

import { copyText } from './files';
import { registerCommands, type CommandArg } from './registry';
import { bus } from '../store';

export function registerPreviewCommands(): void {
  registerCommands([
    {
      id: 'preview.copy',
      title: '复制',
      group: '剪贴板',
      when: ['preview'],
      source: 'system',
      enabled: (arg?: CommandArg) => Boolean(arg?.text),
      run: async (arg?: CommandArg) => {
        const text = arg?.text ?? '';
        if (!text) return;
        const ok = await copyText(text);
        bus.emit('toast', {
          text: ok ? '已复制预览文本' : '复制失败：剪贴板不可用',
          kind: ok ? 'ok' : 'err',
        });
      },
    },
  ]);
}
