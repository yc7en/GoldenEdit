/**
 * 图表插件：吃 Mermaid 语法，用 Pele 渲染成 SVG（ARCHITECTURE §5.13）。
 *
 * 双环境分工与所有 L2 插件一致：
 * - Worker：只产出带源码的占位容器；
 * - 主线程：量到容器宽度后调 `renderAsync()` 得到 SVG 字符串。
 *
 * 判 L2 的原因是**宽度**而不是 DOM：Pele 的 render 在无 DOM 环境也能出 SVG，
 * 但 `maxWidth` 与 `autoDirection`（窄于 640px 自动换竖排）必须知道容器有多宽。
 */

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Pele 的 idPrefix 只接受字母、数字、- 和 _ */
function idPrefix(payload) {
  const raw = String((payload && payload.key) || '');
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '');
  return clean ? `ge-${clean}` : `ge-${Date.now().toString(36)}`;
}

/**
 * 容器内容盒宽度。clientWidth 会把左右 padding 算进去，
 * 那样 maxWidth 偏大 32px，窄屏下正好把最后一列挤出去。
 */
function contentWidth(el) {
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const w = Math.round(el.clientWidth - pad);
  return w > 0 ? w : 0;
}

function errorCard(code, err) {
  // PeleError 带 code / line / column / snippet；其他异常只有 message
  const isPele = err && typeof err.code === 'string' && typeof err.line === 'number';
  const where = isPele && err.line > 0 ? `第 ${err.line} 行第 ${err.column || 1} 列 · ` : '';
  const detail = String((err && err.message) || err).split('\n')[0];
  const snippet = isPele && err.snippet ? err.snippet : code;
  return (
    `<div class="ge-mermaid__error">图表语法错误：${escapeAttr(where + detail)}</div>` +
    `<pre class="ge-mermaid__source">${escapeAttr(snippet)}</pre>`
  );
}

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(['mermaid', 'mmd'], (info, code) => {
      if (!code.trim()) {
        return '<div class="ge-mermaid ge-mermaid--empty">图表内容为空</div>';
      }
      return `<div class="ge-mermaid" data-code="${escapeAttr(code)}"><div class="ge-mermaid__loading">正在渲染图表…</div></div>`;
    });
    return;
  }

  ctx.onMount('.ge-mermaid', async (el, payload, ctx) => {
    const code = el.getAttribute('data-code');
    if (!code) return;

    let pele;
    try {
      // 用 lazy 入口：文档里有哪种图才下载哪种图的分块
      pele = await ctx.libs.load('pele');
    } catch (err) {
      // 库没加载起来不是语法问题，交给管线显示「渲染失败 + 重试」，
      // 混进「语法错误」卡片会把人指错方向
      throw new Error(`图表库加载失败：${(err && err.message) || err}`);
    }

    try {
      const width = contentWidth(el);
      const { svg } = await pele.renderAsync(code, {
        maxWidth: width || undefined,
        // 每张图独立前缀，否则同一页里的 marker / 渐变 id 会互相覆盖
        idPrefix: idPrefix(payload),
        // 测量用的字体必须与 CSS 里渲染的字体一致，否则标签宽度算不准
        fontFamily: getComputedStyle(el).fontFamily || undefined,
      });
      el.innerHTML = svg;
      el.classList.add('ge-mermaid--ready');
    } catch (err) {
      el.innerHTML = errorCard(code, err);
    }
  });
}
