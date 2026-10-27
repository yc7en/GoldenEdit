import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../../src/plugins/types';

/**
 * heading-number：标题多级编号 1.1.1 + [TOC] 目录。
 */
export const manifest: PluginManifest = {
  id: 'heading-number',
  name: '标题编号与目录',
  version: '1.0.0',
  entry: 'register.ts',
  config: {
    startLevel: { type: 'number', default: 1, label: '起始级别' },
    maxLevel: { type: 'number', default: 6, label: '最大级别' },
    separator: { type: 'string', default: '.', label: '分隔符' },
    tocTitle: { type: 'string', default: '目录', label: '目录标题' },
  },
};

export const register: PluginRegister = (md: MarkdownIt, ctx) => {
  const startLevel = Number(ctx.config.startLevel ?? 1);
  const maxLevel = Number(ctx.config.maxLevel ?? 6);
  const sep = String(ctx.config.separator ?? '.');
  const tocTitle = String(ctx.config.tocTitle ?? '目录');

  const counters: number[] = [];
  const headings: Array<{ level: number; text: string; id: string }> = [];

  md.core.ruler.push('reset-counters', () => {
    counters.length = 0;
    headings.length = 0;
  });

  const oldOpen = md.renderer.rules.heading_open!;
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const level = Number(token.tag.slice(1));
    if (level < startLevel || level > maxLevel) return oldOpen(tokens, idx, options, env, self);

    // 更新计数器
    counters[level] = (counters[level] ?? 0) + 1;
    counters.length = level + 1;
    for (let i = level + 1; i < counters.length; i++) counters[i] = 0;

    const num = counters.slice(startLevel, level + 1).join(sep);
    const inline = tokens[idx + 1];
    const text = inline?.content ?? '';
    const id = `h-${headings.length}`;
    headings.push({ level, text, id });

    token.attrSet('id', id);
    token.attrSet('data-num', num);
    inline.content = `${num} ${text}`;
    return oldOpen(tokens, idx, options, env, self);
  };

  // [TOC] / [[toc]] 占位
  md.block.ruler.before('paragraph', 'toc', (state, startLine) => {
    const line = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]).trim();
    if (line !== '[toc]' && line !== '[[toc]]') return false;
    if (state.sCount[startLine] < 0) return false;
    const token = state.push('toc_block', 'nav', 0);
    token.block = true;
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });

  md.renderer.rules.toc_block = () => {
    if (!headings.length) return '';
    const items = headings
      .map((h) => `<li class="ge-toc__l${h.level}"><a href="#${h.id}">${h.text}</a></li>`)
      .join('\n');
    return `<nav class="ge-toc"><div class="ge-toc__title">${tocTitle}</div><ul>${items}</ul></nav>`;
  };
};
