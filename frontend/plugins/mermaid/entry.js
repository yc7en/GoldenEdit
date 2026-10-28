function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let idCounter = 0;

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(['mermaid', 'mmd'], (info, code) => {
      return `<div class="ge-mermaid" data-code="${escapeAttr(code)}"><div class="ge-mermaid__loading">正在渲染图表…</div></div>`;
    });
  } else if (ctx.env.scope === 'main') {
    ctx.onMount('.ge-mermaid', async (el, _, ctx) => {
      const code = el.getAttribute('data-code');
      if (!code) return;
      try {
        const mermaid = await ctx.libs.load('mermaid');
        const cfg = ctx.config || {};
        const themeChoice = cfg.theme || 'auto';
        const actualTheme =
          themeChoice === 'auto'
            ? ctx.theme.mode === 'dark'
              ? 'dark'
              : 'default'
            : themeChoice;

        mermaid.initialize({
          startOnLoad: false,
          theme: actualTheme,
          flowchart: { curve: cfg.curve || 'basis' },
          securityLevel: 'loose',
        });

        const chartId = `ge-mermaid-${Date.now()}-${++idCounter}`;
        const { svg } = await mermaid.render(chartId, code);
        el.innerHTML = svg;
      } catch (err) {
        el.innerHTML = `<div class="ge-mermaid__error">Mermaid 语法错误：${escapeAttr(
          err.message || String(err)
        )}</div><pre class="ge-mermaid__source">${escapeAttr(code)}</pre>`;
      }
    });
  }
}
