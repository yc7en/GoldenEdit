import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../src/plugins/types';

export const manifest: PluginManifest = {
  id: 'mermaid',
  name: 'Mermaid 图表',
  version: '1.0.0',
  entry: 'register.ts',
  match: { fence: ['mermaid', 'mmd'] },
  config: {
    theme: { type: 'select', default: 'auto', options: ['auto', 'default', 'dark', 'forest', 'neutral', 'base'] },
    palette: { type: 'select', default: 'default', options: ['default', 'mono'] },
    securityLevel: { type: 'select', default: 'strict', options: ['strict', 'loose', 'antiscript'] },
  },
};

export const register: PluginRegister = (md: MarkdownIt, ctx) => {
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
    if (lang !== 'mermaid' && lang !== 'mmd') {
      return defaultFence.call(this, tokens, idx, options, env, self);
    }
    const src = token.content.replace(/\s+$/, '');
    const id = `mmd-${Math.random().toString(36).slice(2, 8)}`;
    return `<div class="ge-mermaid" id="${id}" data-plugin="mermaid" data-code="${encodeURIComponent(src)}"></div>`;
  };

  ctx.onMount('.ge-mermaid', async (el: HTMLElement, code: string) => {
    const src = decodeURIComponent(code);
    try {
      const mermaid = (await import('mermaid')).default;
      const cfgTheme = ctx.config.theme as string;
      const theme = cfgTheme === 'auto'
        ? (document.documentElement.dataset.previewTheme === 'dark' ? 'dark' : 'default')
        : cfgTheme;
      mermaid.initialize({
        startOnLoad: false,
        theme: theme as any,
        securityLevel: ctx.config.securityLevel as any,
      });
      const { svg } = await mermaid.render(el.id + '-svg', src);
      el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = `<pre class="ge-mermaid__error">${(e as Error).message}\n\n${src}</pre>`;
    }
  });
};

export default { manifest, register };
