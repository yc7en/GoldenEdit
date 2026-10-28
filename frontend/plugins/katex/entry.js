function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(['math', 'katex', 'latex'], (info, code) => {
      return `<div class="ge-katex ge-katex--block" data-math="${escapeAttr(code)}" data-display="true"></div>`;
    });

    ctx.onDelimiter('inline', (text) => {
      return `<span class="ge-katex ge-katex--inline" data-math="${escapeAttr(text)}" data-display="false"></span>`;
    });
  } else if (ctx.env.scope === 'main') {
    ctx.onMount('.ge-katex', async (el, _, ctx) => {
      const math = el.getAttribute('data-math');
      if (math === null) return;
      const displayMode = el.getAttribute('data-display') === 'true';
      const cfg = ctx.config || {};
      try {
        const katex = await ctx.libs.load('katex');
        katex.render(math, el, {
          displayMode,
          throwOnError: Boolean(cfg.throwOnError),
        });
      } catch {
        el.textContent = math;
        el.classList.add('katex-error');
      }
    });
  }
}
