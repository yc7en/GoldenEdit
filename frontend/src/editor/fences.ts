/**
 * Markdown 围栏代码块定位（P26，编辑区高亮用）。
 *
 * 纯函数，输入是 Monaco `model.getLinesContent()`，输出围栏在**源码行号**上的位置
 * 与代码原文。只负责「哪几行是代码、代码里第几个字符对应编辑器第几行第几列」，
 * 不 import Monaco，方便单测覆盖。
 *
 * 与预览侧 markdown-it 的规则对齐：最多 3 个空格缩进、开栏字符 3 个以上、
 * 闭栏同字符且长度不小于开栏、闭栏后只允许空白；未闭合的围栏一直吃到文末。
 */
export interface Fence {
  /** 开栏所在行（1-based） */
  openLine: number;
  /** 闭栏所在行（1-based）；未闭合时为最后一行 */
  closeLine: number;
  /** 信息串里的第一个词，未标注为空串 */
  lang: string;
  /** 代码正文行（保留原始缩进），`join('\n')` 即交给 highlight.js 的原文 */
  lines: string[];
}

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/;

/** 语言名里的标点（如 `c++` 的 `+`、`c#`）交给 hljs 的别名表判断，这里只取第一个词 */
function langOf(info: string): string {
  return info.trim().split(/\s+/)[0] ?? '';
}

export function findFences(lines: string[]): Fence[] {
  const out: Fence[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = OPEN.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const marker = m[1];
    const char = marker[0];
    const width = marker.length;
    // 反引号围栏的信息串不允许再出现反引号（markdown-it 的规定），否则整行不算围栏
    if (char === '`' && m[2].includes('`')) {
      i += 1;
      continue;
    }
    const openLine = i + 1;
    const body: string[] = [];
    let j = i + 1;
    let closeLine = lines.length;
    const closeRe = new RegExp(`^ {0,3}${char}{${width},}\\s*$`);
    for (; j < lines.length; j += 1) {
      if (closeRe.test(lines[j])) {
        closeLine = j + 1;
        break;
      }
      body.push(lines[j]);
    }
    out.push({ openLine, closeLine, lang: langOf(m[2]), lines: body });
    // 闭栏之后继续找下一个围栏；未闭合时已经吃到文末
    i = j + 1;
  }
  return out;
}

export interface MonacoPosition {
  lineNumber: number;
  column: number;
}

export interface MonacoSpan {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** 把 code 里的字符偏移量换算成 Monaco 的 1-based 行列 */
export function offsetToPosition(fence: Fence, offset: number): MonacoPosition {
  let base = 0;
  for (let i = 0; i < fence.lines.length; i += 1) {
    const len = fence.lines[i].length;
    if (offset <= base + len) {
      return { lineNumber: fence.openLine + 1 + i, column: offset - base + 1 };
    }
    base += len + 1; // 行之间的 '\n'
  }
  const last = Math.max(0, fence.lines.length - 1);
  return {
    lineNumber: fence.openLine + 1 + last,
    column: (fence.lines[last]?.length ?? 0) + 1,
  };
}

export function rangeToMonaco(fence: Fence, start: number, end: number): MonacoSpan {
  const a = offsetToPosition(fence, start);
  const b = offsetToPosition(fence, end);
  return {
    startLineNumber: a.lineNumber,
    startColumn: a.column,
    endLineNumber: b.lineNumber,
    endColumn: b.column,
  };
}
