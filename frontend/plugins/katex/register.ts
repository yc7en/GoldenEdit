import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../../src/plugins/types';

/**
 * katex：$...$ 行内 / $$...$$ 块级公式。
 */
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
  const delimiters = (ctx.config.delimiters as string) || 'dollars';
  md.use(require('markdown-it-texmath'), {
    engine: require('katex'),
    delimiters: delimiters as 'dollars',
    katexOptions: { throwOnError: false, errorColor: '#cc0000' },
  });
};
