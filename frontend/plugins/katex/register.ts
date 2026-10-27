import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../src/plugins/types';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export const manifest: PluginManifest = {
  id: 'katex',
  name: 'KaTeX 公式',
  version: '1.0.0',
  entry: 'register.ts',
  match: { delimiter: { inline: '$...$', block: '$$...$$' } },
  config: {
    delimiters: { type: 'select', default: 'dollars', options: ['dollars', 'brackets'], label: '定界符' },
  },
};

export const register: PluginRegister = (md: MarkdownIt, ctx) => {
  const delimiters = (ctx.config.delimiters as 'dollars' | 'brackets') || 'dollars';
  md.use(texmath as any, {
    engine: katex,
    delimiters,
    katexOptions: { throwOnError: false, errorColor: '#cc0000' },
  });
};

export default { manifest, register };
