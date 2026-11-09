/**
 * 文档内图片等 vault 资源的地址解析（对应 §9.4 的 `/asset` 路由）。
 *
 * 预览 iframe 的文档源固定是 `http://127.0.0.1:{port}/p/{token}/shell/`，
 * Markdown 里 `![](image/a.jpg)` 这类相对路径会被浏览器按这个地址解析，
 * 落到外壳静态资源上必然 404。所以渲染时统一改写成 `/p/{token}/asset?p={rel}`，
 * 由 Rust 侧按工作区根目录定位文件并做越界校验——校验只在一处，前端不重复实现。
 */

/** 带 scheme（`http:`、`data:`、`C:`）或协议相对（`//`）的地址：原样保留 */
const SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** 外壳地址 → 资源路由前缀。不是 `/p/{token}/shell/` 形态时返回空串，表示不接管 */
export function assetBaseOf(shellBaseUrl: string): string {
  const m = /^(.*\/p\/[^/]+\/)shell\/$/i.exec(shellBaseUrl);
  return m ? m[1] : '';
}

/** 已百分号编码的地址先还原一次再统一编码，避免 `%20` 被编码成 `%2520` */
function decodeOnce(s: string): string {
  if (!s.includes('%')) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 把 Markdown 里的资源地址解析成可直接访问的 URL。
 *
 * - 绝对地址（含数据 URI、Windows 盘符路径）原样返回，不冒充 vault 路径；
 * - 以 `/` 开头按工作区根目录解析，其余按当前文档所在目录解析；
 * - 路径越出工作区、或解析结果为空时原样返回，让 404 暴露问题，
 *   不在这里悄悄换成一个「看起来能用」的错地址。
 */
export function assetUrl(assetBase: string, dir: string, src: string): string {
  const raw = src.trim();
  if (!assetBase || !raw || raw.startsWith('#') || SCHEME.test(raw)) return src;

  // 本地文件上的查询串 / 锚点没有意义，去掉再解析
  const path = decodeOnce(raw.split(/[?#]/)[0]).replace(/\\/g, '/');
  const stack: string[] = [];
  const head = path.startsWith('/') ? [] : dir.split('/');
  for (const seg of [...head, ...path.split('/')]) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return src;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  if (stack.length === 0) return src;
  return `${assetBase}asset?p=${encodeURIComponent(stack.join('/'))}`;
}
