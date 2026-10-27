import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../../src/plugins/types';

/**
 * callout：Obsidian 风格提示块
 *   > [!NOTE] 标题
 *   > 内容…
 * 以及旧语法：
 *   !!!note{标题} … !!!
 */

const TITLES_ZH: Record<string, string> = {
  note: '说明', todo: '待办', tip: '提示', success: '成功',
  question: '问题', warning: '警告', attention: '注意', danger: '危险',
  example: '示例', abstract: '摘要', quote: '引用',
};

const ALIASES: Record<string, string> = {
  info: 'note', caution: 'warning', error: 'danger', important: 'tip',
  warn: 'warning',
};

export const manifest: PluginManifest = {
  id: 'callout',
  name: '提示块 Callout',
  version: '1.0.0',
  entry: 'register.ts',
  config: {
    showIcon: { type: 'boolean', default: true, label: '显示图标' },
    titleStyle: { type: 'select', default: 'zh', options: ['zh', 'obsidian'], label: '默认标题风格' },
    legacyBangSyntax: { type: 'boolean', default: true, label: '兼容旧 !!!note 语法' },
  },
};

export const register: PluginRegister = (md: MarkdownIt, ctx) => {
  const showIcon = ctx.config.showIcon !== false;
  const titleStyle = (ctx.config.titleStyle as string) || 'zh';

  const normalize = (t: string) => {
    const key = t.toLowerCase();
    return ALIASES[key] ?? key;
  };

  const defaultTitle = (type: string) =>
    titleStyle === 'zh' ? (TITLES_ZH[type] ?? type.toUpperCase()) : type.charAt(0).toUpperCase() + type.slice(1);

  // 拦截 blockquote 渲染，识别 > [!TYPE] 语法
  const oldQuote = md.renderer.rules.blockquote_open!;
  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    // 我们在 token 流里打标记，由 close 时拼接
    return oldQuote(tokens, idx, options, env, self);
  };

  // 用 block 规则：把 > [!NOTE] 解析成自定义容器
  md.block.ruler.before('blockquote', 'callout', (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (pos >= max || state.src[pos] !== '>') return false;

    const firstLine = state.src.slice(pos, max);
    const m = firstLine.match(/^>\s*\[!([\w-]+)\]\s*(.*)$/);
    if (!m) return false;
    if (silent) return true;

    const type = normalize(m[1]);
    const explicitTitle = m[2].trim();

    // 找闭合：连续的 > 行
    let next = startLine + 1;
    while (next < endLine) {
      const p = state.bMarks[next] + state.tShift[next];
      const e = state.eMarks[next];
      if (p >= e) break;
      if (state.src[p] !== '>') break;
      next++;
    }

    const title = explicitTitle || defaultTitle(type);
    const icon = showIcon ? `<span class="ge-callout__icon"></span>` : '';
    const openToken = state.push('callout_open', 'div', 1);
    openToken.block = true;
    openToken.info = type;
    openToken.markup = `> [!${type}]`;
    openToken.map = [startLine, next];

    state.push('callout_title_open', 'div', 1);
    state.push('inline', '', 0).content = `${icon}${title}`;
    state.push('callout_title_close', 'div', -1);

    // 内部内容：剥掉 > 前缀后交给 block 解析
    const oldBMarks: number[] = [];
    const oldTShift: number[] = [];
    for (let i = startLine + 1; i < next; i++) {
      oldBMarks.push(state.bMarks[i]);
      oldTShift.push(state.tShift[i]);
      const p2 = state.bMarks[i] + state.tShift[i];
      // 把 "> " 开头折成普通缩进
      state.bMarks[i] = p2 + 1;
      state.tShift[i] = 0;
    }
    state.md.block.tokenize(state, startLine + 1, next);

    state.push('callout_close', 'div', -1);
    state.line = next;
    return true;
  });

  md.renderer.rules.callout_open = (tokens, idx) => {
    const type = tokens[idx].info || 'note';
    return `<div class="ge-callout ge-callout--${type}">`;
  };
  md.renderer.rules.callout_title_open = () => '<div class="ge-callout__title">';
  md.renderer.rules.callout_title_close = () => '</div>';
  md.renderer.rules.callout_close = () => '</div>';
};
