/**
 * 系统命令（ARCHITECTURE §8.2）。
 *
 * 这一份表是菜单、命令面板、快捷键的唯一来源。加一个动作只在这里加一条，
 * 三个入口自动都能看到。
 */

import type { LayoutMode } from '../bridge/types';
import { registerCommands, type CommandDef } from './registry';

export interface SystemActions {
  openVault: () => void;
  save: () => void;
  closeTab: () => void;
  setLayout: (mode: LayoutMode) => void;
  togglePreview: () => void;
  toggleOutline: () => void;
  toggleSide: () => void;
  openPalette: () => void;
  openPlugins: () => void;
  openExport: () => void;
  openSettings: () => void;
  openKeys: () => void;
  setPreset: (preset: 'system' | 'writing' | 'light' | 'dark') => void;
  runPerf: () => void;
}

export function registerSystemCommands(a: SystemActions): void {
  const system: Pick<CommandDef, 'source' | 'when'> = { source: 'system', when: ['global'] };

  registerCommands([
    { ...system, id: 'file.open', title: '打开文件夹…', group: '文件', default: 'Ctrl+K', run: a.openVault },
    { ...system, id: 'file.save', title: '保存当前文档', group: '文件', default: 'Ctrl+S', run: a.save },
    {
      ...system,
      id: 'tab.close',
      title: '关闭当前标签',
      group: '文件',
      default: 'Ctrl+W',
      run: a.closeTab,
    },

    {
      ...system,
      id: 'palette.open',
      title: '命令面板',
      group: '视图',
      default: 'Ctrl+Shift+P',
      run: a.openPalette,
    },
    {
      ...system,
      id: 'view.split',
      title: '布局：分栏',
      group: '视图',
      default: 'Ctrl+1',
      run: () => a.setLayout('split'),
    },
    {
      ...system,
      id: 'view.editor',
      title: '布局：仅编辑',
      group: '视图',
      default: 'Ctrl+2',
      run: () => a.setLayout('editor'),
    },
    {
      ...system,
      id: 'view.preview',
      title: '布局：仅预览',
      group: '视图',
      default: 'Ctrl+3',
      run: () => a.setLayout('preview'),
    },
    {
      ...system,
      id: 'view.togglePreview',
      title: '切换预览面板',
      group: '视图',
      default: 'Ctrl+Shift+V',
      run: a.togglePreview,
    },
    {
      ...system,
      id: 'view.toggleOutline',
      title: '折叠 / 展开大纲',
      group: '视图',
      default: 'Ctrl+Shift+O',
      run: a.toggleOutline,
    },
    {
      ...system,
      id: 'view.toggleSide',
      title: '收起 / 展开左栏',
      group: '视图',
      default: 'Ctrl+B',
      run: a.toggleSide,
    },

    {
      ...system,
      id: 'page.plugins',
      title: '打开插件页',
      group: '导航',
      default: 'Ctrl+Shift+I',
      run: a.openPlugins,
    },
    { ...system, id: 'page.export', title: '导出…', group: '导航', default: 'Ctrl+E', run: a.openExport },
    { ...system, id: 'page.settings', title: '设置', group: '导航', run: a.openSettings },
    { ...system, id: 'page.keys', title: '键盘快捷方式…', group: '导航', run: a.openKeys },

    { ...system, id: 'theme.system', title: '主题：跟随系统', group: '外观', run: () => a.setPreset('system') },
    { ...system, id: 'theme.writing', title: '主题：写作模式', group: '外观', run: () => a.setPreset('writing') },
    { ...system, id: 'theme.light', title: '主题：全亮', group: '外观', run: () => a.setPreset('light') },
    { ...system, id: 'theme.dark', title: '主题：全暗', group: '外观', run: () => a.setPreset('dark') },

    { ...system, id: 'debug.perf', title: '诊断：渲染性能自检', group: '诊断', run: a.runPerf },
  ]);
}
