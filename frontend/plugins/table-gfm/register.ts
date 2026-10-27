import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../src/plugins/types';

/**
 * table-gfm锛氬惎鐢?GFM 琛ㄦ牸锛坢arkdown-it 榛樿鍏抽棴锛夈€? */
export const manifest: PluginManifest = {
  id: 'table-gfm',
  name: 'GFM 琛ㄦ牸',
  version: '1.0.0',
  entry: 'register.ts',
  config: {},
};

export const register: PluginRegister = (md: MarkdownIt) => {
  md.enable(['table', 'strikethrough']);
};

export default { manifest, register };

