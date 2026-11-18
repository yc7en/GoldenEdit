/**
 * 思维导图插件：把 Markdown 大纲渲染成 markmap 风格的分支图。
 *
 * 与 mermaid / score 同一套双环境分工（ARCHITECTURE §5.5）：
 * - Worker：只产出带源码的占位容器，不碰 DOM 也不解析；
 * - 主线程：`onMount` 里解析、排版、注入 SVG。
 *
 * 判 L2 的理由是**测量**而不是 DOM：markmap 要先用 canvas 量出每个节点的文字宽度
 * 才排得出层级间距，Worker 里没有 canvas，也拿不到容器宽度。
 *
 * 只取 markmap 的 parse + render 两个包，**不用 @markmap/view**：view 带缩放、
 * 平移与折叠交互，那套手势会和预览区的滚动抢事件；静态 SVG 还能跟着 innerHTML
 * 一起被导出与打印（§9.5）。要交互的读者去 VS Code 里开 markmap 更合适。
 */

/** 围栏语言名：`markmap` 是通用叫法，`mindmap` 更直观 */
const FENCES = ['markmap', 'mindmap'];

/** 画布四周留白（px）：节点文字贴着卡片边缘会显得局促 */
const PAD = 12;

/**
 * 缩放下限。整张图压到 60% 以下文字就没法读了，宁可让容器横向滚动——
 * 5 层以上的深图缩到 40% 时，中文基本糊成一团。
 */
const MIN_SCALE = 0.6;

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 占位 HTML（Worker 侧）。必须是纯函数：不碰 DOM、不读模块级可变状态。
 * 空围栏直接给提示，不交给 markmap——它对空输入会画出一个空节点，比提示更费解。
 */
export function placeholder(code) {
  const src = String(code ?? '');
  if (!src.trim()) {
    return '<div class="ge-markmap ge-markmap--empty">围栏内是空的：这里写 Markdown 大纲（标题与列表）</div>';
  }
  return `<div class="ge-markmap" data-code="${escapeAttr(src)}"><div class="ge-markmap__loading">正在排版思维导图…</div></div>`;
}

/** 错误卡片：源码一并显示，用户才改得动 */
export function errorHtml(message, code) {
  return (
    `<div class="ge-markmap__error">思维导图渲染失败：${escapeAttr(message).split('\n')[0]}</div>` +
    `<pre class="ge-markmap__source">${escapeAttr(code)}</pre>`
  );
}

/** 容器内容盒宽度。clientWidth 含左右 padding，直接用会让缩放算大一圈 */
function contentWidth(el) {
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const w = Math.round(el.clientWidth - pad);
  return w > 0 ? w : 0;
}

/** 图元的包围盒往外扩一圈留白，得到 viewBox */
export function viewBoxOf(bounds, pad = PAD) {
  return {
    x: (bounds?.x ?? 0) - pad,
    y: (bounds?.y ?? 0) - pad,
    width: Math.max(1, (bounds?.width ?? 0) + pad * 2),
    height: Math.max(1, (bounds?.height ?? 0) + pad * 2),
  };
}

/**
 * 缩放比：只缩不放，且不低于 MIN_SCALE。
 * 容器量不到宽度（0）时按 1 处理，让图以自然尺寸出现、交给卡片横向滚动，
 * 而不是因为一次量宽失败把整张图压成一条缝。
 */
export function scaleFor(natural, container) {
  if (!(natural > 0) || !(container > 0)) return 1;
  return Math.min(1, Math.max(MIN_SCALE, container / natural));
}

function num(v) {
  return String(Math.round(v * 100) / 100);
}

/**
 * 画布测量器按需创建一次：它内部缓存「字体 + 文本 → 宽度」，
 * 每张图重建一份等于把缓存丢掉，长文档里几十张图会白量几千次。
 */
let measurer = null;

/** 主题：拿内置 classic，但字体换成容器实际字体——测量与渲染必须是同一套 */
export function themeFor(R, el) {
  const base = R.classicTheme;
  let family = '';
  try {
    family = getComputedStyle(el).fontFamily || '';
  } catch {
    family = '';
  }
  if (!family) return base;
  return { ...base, font: { ...base.font, family } };
}

/**
 * 渲染成 SVG 字符串。
 *
 * 拆成独立导出函数是为了能在 node 里单测「尺寸与缩放」这类算术，
 * 不必真跑一遍 markmap（它要 canvas）。
 */
export async function renderSvg(lib, code, el) {
  const { parse } = lib.parse;
  const R = lib.render;

  const { root } = parse(code);
  if (!measurer) measurer = R.createCanvasMeasurer();

  const result = await R.renderTreeAsync(root, { measurer, theme: themeFor(R, el) });
  const box = viewBoxOf(result.bounds);
  const scale = scaleFor(box.width, contentWidth(el));

  // interactive:false —— 静态卡片不需要命中区域，省掉一层透明矩形
  const body = R.primitivesToSVG(result.primitives, { interactive: false });
  return (
    `<svg class="ge-markmap__svg" role="img" viewBox="${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)}"` +
    ` width="${num(box.width * scale)}" height="${num(box.height * scale)}">` +
    `<title>思维导图</title>${body}</svg>`
  );
}

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(FENCES, (_info, code) => placeholder(code));
    return;
  }

  if (ctx.env.scope !== 'main') return;

  ctx.onMount('.ge-markmap', async (el, _payload, ctx) => {
    const code = el.getAttribute('data-code');
    if (!code) return;

    // 先摘掉 data-code：重复挂载时不会拿同一份源码画两遍
    el.removeAttribute('data-code');

    let lib;
    try {
      lib = await ctx.libs.load('markmap');
    } catch (err) {
      // 库加载失败不是语法问题，交给管线显示可重试的挂载错误
      throw new Error(`思维导图库加载失败：${(err && err.message) || err}`);
    }

    try {
      el.innerHTML = await renderSvg(lib, code, el);
      el.classList.add('ge-markmap--ready');
    } catch (err) {
      el.innerHTML = errorHtml((err && err.message) || String(err), code);
    }
  });
}
