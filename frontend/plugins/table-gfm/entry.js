export function register(md, ctx) {
  if (ctx.env.scope !== 'worker') return;

  // 单遍重建 token 表，不要对 tokens 做 splice：
  // splice 是 O(n)，每张表一次，8MB 文档 7800 张表 × 73 万 token 会把解析拖到 3 秒以上
  // （真机实测：改成重建后 3.2s → 0.35s）。
  ctx.onCoreRule((state) => {
    const tokens = state.tokens;
    const out = [];
    for (const token of tokens) {
      if (token.type === 'table_open') {
        const open = new state.Token('html_inline', '', 0);
        open.content = '<div class="ge-table-wrapper">';
        out.push(open, token);
        continue;
      }
      out.push(token);
      if (token.type === 'table_close') {
        const close = new state.Token('html_inline', '', 0);
        close.content = '</div>';
        out.push(close);
      }
    }
    state.tokens = out;
  });
}
