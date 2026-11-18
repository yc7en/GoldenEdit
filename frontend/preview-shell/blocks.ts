/**
 * 块切分与 key 计算（ARCHITECTURE §5.6 / §6.3）。
 * 纯函数，Worker 与主线程都可调用——不含任何 DOM 引用。
 */

export interface MdToken {
  type: string;
  tag: string;
  nesting: number;
  level: number;
  map: [number, number] | null;
  content: string;
  info: string;
  markup: string;
  hidden: boolean;
  attrs?: [string, string][] | null;
  children?: MdToken[] | null;
}

export interface Block {
  key: string;
  /** 插件 / 渲染器产出的 HTML，未包裹 */
  html: string;
  /** 1 基行号 */
  line: number;
  /** 命中的插件 id（用于诊断） */
  plugins: string[];
  /**
   * 源码行数。占位块用它估高度。
   * 刻意不下发源码：8MB 文档 5 万块时，只传 HTML 就已经是几十 MB，
   * 再带上等量源码只会让 postMessage 变成瓶颈（§6.4）。
   */
  lines: number;
  /** 是否还没渲染（视口模式下尾块按需补渲染） */
  pending?: boolean;
}

/** FNV-1a 32bit，转 base36。碰撞代价只是多渲染一次，不需要密码学强度。 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

export function blockKey(source: string, pluginIds: string[], themeMode: string): string {
  return fnv1a(`${source}\u0000${pluginIds.join(',')}\u0000${themeMode}`);
}

/**
 * 按顶层 token 切块。规则：`level === 0 && map !== null` 开启新块，
 * 其余 token（含 `*_close`）归入当前块。这样列表、表格、引用等复合结构不会被切碎。
 */
export function splitBlocks(tokens: MdToken[]): MdToken[][] {
  const groups: MdToken[][] = [];
  let current: MdToken[] | null = null;
  for (const token of tokens) {
    const startsBlock = token.level === 0 && token.map !== null && token.map !== undefined;
    if (startsBlock || current === null) {
      current = [];
      groups.push(current);
    }
    current.push(token);
  }
  return groups;
}

export function blockSource(group: MdToken[], lines: string[]): string {
  const first = group.find((t) => t.map);
  if (!first || !first.map) return group.map((t) => t.content).join('');
  const [start, end] = first.map;
  return lines.slice(start, end).join('\n');
}

export function blockLine(group: MdToken[]): number {
  const first = group.find((t) => t.map);
  return first && first.map ? first.map[0] + 1 : 1;
}

/** 插件不允许输出 data-line；这里剥掉并记一条 warn（§5.6）。 */
export function stripForbiddenAttrs(html: string): { html: string; stripped: boolean } {
  const re = /\sdata-line\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi;
  const stripped = re.test(html);
  return { html: stripped ? html.replace(re, '') : html, stripped };
}

/** 去掉 <script>，只保留样式与内联 SVG（§11）。 */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/?script\b[^>]*>/gi, '');
}

/** 单个标签（属性里的 `>` 通常被引号包住，这里够用） */
const TAG = /<[a-z][\w:-]*[^>]*>/gi;
/** 内联事件属性。HTML 标准里没有以 `on` 开头却非事件的属性名，所以按前缀剥 */
const EVENT_ATTR = /\son[a-z]{3,}\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /\s(href|src|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * 剥内联事件属性（`onerror=` / `onclick=` …）。
 *
 * 预览外壳的 CSP 是 `script-src 'self'`，没有 `'unsafe-inline'`，浏览器本来就会
 * 拒绝执行内联事件处理器；但**导出的 HTML 没有这道 CSP**（§11 承诺「导出时不携带
 * 可执行脚本」），所以剥除不能只靠 CSP。
 */
export function stripEventHandlers(html: string): string {
  if (!html || html.search(/\son[a-z]{3,}\s*=/i) < 0) return html;
  return html.replace(TAG, (tag) => tag.replace(EVENT_ATTR, ''));
}

/** 剥 `javascript:` / `vbscript:` / `data:text/html` 这类可执行地址（`data:image/*` 保留） */
export function stripDangerousUrls(html: string): string {
  if (!html || !/(javascript|vbscript)\s*:|data:text\/html/i.test(html)) return html;
  return html.replace(TAG, (tag) =>
    tag.replace(URL_ATTR, (whole, _name: string, value: string) => {
      const v = value.replace(/^["']|["']$/g, '').trim().toLowerCase();
      return /^(javascript|vbscript)\s*:|^data:text\/html/i.test(v) ? '' : whole;
    })
  );
}

/**
 * 块级输出统一净化：剥脚本、内联事件、可执行 URL。
 *
 * `html: true` 之后文档里的原始 HTML 一律原样进 DOM（表格、`<details>`、内联 SVG
 * 这些是正经用法），所以这层必须在，且要同时覆盖预览与导出——两者共用同一条渲染管线。
 */
export function sanitizeBlockHtml(html: string): string {
  return stripDangerousUrls(stripEventHandlers(stripScripts(html)));
}
