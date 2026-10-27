import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../../src/plugins/types';

/**
 * table-gfm：启用 GFM 表格（markdown-it 默认关闭）。
 */
export const manifest: PluginManifest = {
  id: 'table-gfm',
  name: 'GFM 表格',
  version: '1.0.0',
  entry: 'register.ts',
  config: {},
};

export const register: PluginRegister = (md: MarkdownIt) => {
  md.enable(['table', 'strikethrough']);
};
