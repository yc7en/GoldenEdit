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
  /** 该块的源码，用于 lazy 渲染与调试 */
  source: string;
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
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}
