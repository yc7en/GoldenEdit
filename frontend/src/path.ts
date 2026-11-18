/**
 * 路径归一（仅供比较与拼接，不用于回传后端）。
 *
 * 后端已经在 `paths::display_path()` 里把回传路径统一成正斜杠，但另外两条来路的
 * 路径不受它管：WebView 拖放事件给的是反斜杠路径，Windows 的 `canonicalize` 还会
 * 带 `\\?\` 长路径前缀。三者混在一起做 `startsWith` 一定判错——旧代码就因为
 * 「`\\?\J:\CODE` 开头」对不上 `\\\\?\\J:\\CODE` 而把工作区内的文件当成外部文件。
 */

/** 抹平分隔符与长路径前缀，保留原有大小写（切片回传时不能改大小写） */
export function toPosixPath(p: string): string {
  return String(p ?? '')
    .replace(/^\\\\\?\\UNC\\/i, '//')
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/');
}

/** 去掉尾部斜杠（`J:/` 这类盘符根保留，否则切片长度会算错） */
export function trimSlash(p: string): string {
  const s = toPosixPath(p);
  if (s.length <= 1) return s;
  const trimmed = s.replace(/\/+$/, '');
  if (!trimmed) return '/';
  // `J:` 是盘符根被削掉斜杠的残缺形式，补回来
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}/` : trimmed;
}

/**
 * 目标是否落在 root 之内。Windows / macOS 大小写不敏感，比较时统一小写，
 * 但**返回的切片仍是原大小写**，所以调用方要自己按 `root.length` 切。
 */
export function isInsideRoot(target: string, root: string): boolean {
  const t = toPosixPath(target);
  const r = trimSlash(root);
  if (!r) return false;
  const lowerT = t.toLowerCase();
  const lowerR = r.toLowerCase();
  return lowerT === lowerR || lowerT.startsWith(`${lowerR}/`);
}
