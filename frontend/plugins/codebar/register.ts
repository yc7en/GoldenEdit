import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../../src/plugins/types';

/**
 * codebar：代码块工具条（红黄绿圆点 + 复制按钮）+ 行内代码强调。
 */
export const manifest: PluginManifest = {
  id: 'codebar',
  name: '代码块工具条',
  version: '1.0.0',
  entry: 'register.ts',
  config: {
    bar: { type: 'boolean', default: true, label: '显示工具条' },
    copy: { type: 'boolean', default: true, label: '显示复制按钮' },
    inlineAccent: { type: 'boolean', default: true, label: '行内代码强调' },
  },
};

export const register: PluginRegister = (md: MarkdownIt, ctx) => {
  const bar = ctx.config.bar !== false;
  const copy = ctx.config.copy !== false;

  const wrap = (html: string, lang: string) => {
    if (!bar || !/^\s*<pre[\s>]/.test(html)) return html;
    const copyBtn = copy
      ? `<button type="button" class="ge-code__copy" data-copy>复制</button>` : '';
    return `<div class="ge-code" data-lang="${md.utils.escapeHtml(lang)}">`
      + `<div class="ge-code__bar"><span class="ge-code__dots"><i></i><i></i><i></i></span>${copyBtn}</div>`
      + html.trim() + `</div>`;
  };

  const prevFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const html = prevFence.call(this, tokens, idx, options, env, self);
    const lang = (tokens[idx].info || '').trim().split(/\s+/)[0];
    return wrap(html, lang);
  };

  const prevInline = md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline = (...args) => {
    const html = prevInline(...args);
    if (ctx.config.inlineAccent === false) return html;
    return html.replace(/^<code\b/, '<code class="ge-code__inline"');
  };
};
