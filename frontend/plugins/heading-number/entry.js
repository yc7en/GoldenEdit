export function register(md, ctx) {
  if (ctx.env.scope !== 'worker') return;

  ctx.onCoreRule((state) => {
    const config = ctx.config || {};
    const startLevel = typeof config.startLevel === 'number' ? config.startLevel : 2;
    const counters = [0, 0, 0, 0, 0, 0, 0]; // 0 ~ 6

    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open') {
        const level = parseInt(tokens[i].tag.slice(1), 10);
        if (level >= startLevel && level <= 6) {
          counters[level]++;
          for (let k = level + 1; k <= 6; k++) {
            counters[k] = 0;
          }

          const prefix = counters.slice(startLevel, level + 1).join('.') + ' ';
          const next = tokens[i + 1];
          if (next && next.type === 'inline') {
            const numToken = new state.Token('html_inline', '', 0);
            numToken.content = `<span class="ge-heading-number">${prefix}</span>`;
            if (!next.children) next.children = [];
            next.children.unshift(numToken);
          }
        }
      }
    }
  });
}
