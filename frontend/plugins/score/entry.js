/**
 * 乐谱插件：ABC 记谱法 → 五线谱（ARCHITECTURE §5.12）。
 *
 * 为什么是 L2：abcjs 需要真实 DOM 来计算音符占位并输出 SVG，Worker 里没有 DOM。
 * 所以 Worker 侧只输出占位容器（源码塞进 data-code），主线程 onMount 再渲染。
 * 这条链路与 Mermaid 同构，不新增机制。
 */

/** 围栏语言名：`music` 最好记，`abc` 最准确，`score` 兼容直觉写法 */
const FENCES = ['music', 'abc', 'score'];

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 占位 HTML。Worker 侧用，必须是纯函数（不碰 DOM、不读模块级可变状态）。
 * 空围栏直接给提示，不交给 abcjs——它对空输入会产出一张空谱，比提示更让人困惑。
 */
export function placeholder(code) {
  const src = String(code ?? '');
  if (!src.trim()) {
    return '<div class="ge-score ge-score--empty"><div class="ge-score__hint">围栏内是空的：这里写 ABC 记谱</div></div>';
  }
  return `<div class="ge-score" data-code="${escapeAttr(src)}"><div class="ge-score__loading">正在排版乐谱…</div></div>`;
}

/** 语法错误卡片：把源码一并显示，用户才改得动 */
export function errorHtml(message, code) {
  return (
    `<div class="ge-score__error">乐谱渲染失败：${escapeAttr(message)}</div>` +
    `<pre class="ge-score__source">${escapeAttr(code)}</pre>`
  );
}

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(FENCES, (_info, code) => placeholder(code));
    return;
  }

  if (ctx.env.scope !== 'main') return;

  ctx.onMount('.ge-score', async (el, _payload, ctx) => {
    const code = el.getAttribute('data-code');
    if (!code) return;

    // 先摘掉 data-code：渲染过程若被重复触发，也不会拿同一份源码画两遍
    el.removeAttribute('data-code');

    let abcjs;
    try {
      abcjs = await ctx.libs.load('abcjs');
    } catch (err) {
      // 库加载失败交给管线处理（会显示挂载错误卡片并写诊断日志），不在这里吞掉
      throw new Error(`乐谱库加载失败：${(err && err.message) || err}`);
    }

    try {
      // 清掉「正在排版」提示；abcjs 是向容器追加，不清会留在谱子上面
      el.textContent = '';
      abcjs.renderAbc(el, code, { add_classes: true });
      const svg = el.querySelector('svg');
      if (!svg) {
        // abcjs 对语法错误常常不抛异常，只是画不出东西——不检查就会显示一片空白
        el.innerHTML = errorHtml('ABC 语法未被识别', code);
        return;
      }
      ensureViewBox(svg);
    } catch (err) {
      el.innerHTML = errorHtml((err && err.message) || String(err), code);
    }
  });
}

/**
 * 给根 svg 补 viewBox。
 *
 * abcjs 只写 width / height 属性，不写 viewBox；没有 viewBox 时 CSS 的
 * `max-width:100%; height:auto` 会让高度退化成默认 150px，谱子被压扁。
 * 补上 viewBox 之后，等比缩放才成立（这一步是实测出来的，不是保险起见）。
 */
export function ensureViewBox(svg) {
  if (svg.getAttribute('viewBox')) return;
  const w = parseFloat(svg.getAttribute('width') || '0');
  const h = parseFloat(svg.getAttribute('height') || '0');
  if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
}
