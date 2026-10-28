export function register(md, ctx) {
  if (ctx.env.scope !== 'worker') return;

  ctx.onCoreRule((state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'table_open') {
        const open = new state.Token('html_inline', '', 0);
        open.content = '<div class="ge-table-wrapper">';
        tokens.splice(i, 0, open);
        i += 2;
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          i++;
        }
        if (i < tokens.length && tokens[i].type === 'table_close') {
          const close = new state.Token('html_inline', '', 0);
          close.content = '</div>';
          tokens.splice(i + 1, 0, close);
          i++;
        }
      }
    }
  });
}
