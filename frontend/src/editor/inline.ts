/**
 * 行内标记（加粗 `**` / 斜体 `*` / 删除线 `~~`）的编辑计划（ARCHITECTURE §8.3）。
 *
 * 纯函数：修列号这种事（跨行只位移第一行、选区贴着行首行尾时的 clamp、
 * 已包裹时删两侧后再把选区收回文字上）全在这里算，宿主只把 `edits` 交给
 * `executeEdits`。这样三种分支都能用 node 单测覆盖，不必拉起 Monaco。
 */

export interface InlineSelection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface InlineEdit extends InlineSelection {
  text: string;
}

export interface InlinePlan {
  edits: InlineEdit[];
  selection: InlineSelection;
}

/** 宿主侧只需提供这两项读能力，正好对应 Monaco model 的同名方法 */
export interface TextProbe {
  /** 某行最大列号（行尾字符之后一位） */
  lineMaxColumn(line: number): number;
  /** 1-based 行列区间上的文本；调用方保证坐标合法 */
  textBetween(startLine: number, startColumn: number, endLine: number, endColumn: number): string;
}

export interface InlineTarget extends InlineSelection {
  empty: boolean;
}

/**
 * 计算一次开关：
 * - 空选区：插入 `prefix+suffix`，光标停在两者之间，接着敲字即可；
 * - 外侧已经是同一对标记：剥掉，选区回落到原文字上；
 * - 其余：包裹，选区跟着文字一起走。
 *
 * 跨行选区只把 `prefix` 算进第一行的位移，`suffix` 插在末行末尾不改变末行起点。
 */
export function planInlineToggle(
  target: InlineTarget,
  probe: TextProbe,
  prefix: string,
  suffix: string
): InlinePlan {
  const { startLine, startColumn, endLine, endColumn } = target;

  if (target.empty) {
    const caret = startColumn + prefix.length;
    return {
      edits: [{ startLine, startColumn, endLine, endColumn, text: `${prefix}${suffix}` }],
      selection: { startLine, startColumn: caret, endLine, endColumn: caret },
    };
  }

  // 贴行首 / 行尾时列号会越界，先 clamp：Monaco 的 Range 对 column < 1 直接抛错
  const beforeStart = Math.max(1, startColumn - prefix.length);
  const before = probe.textBetween(startLine, beforeStart, startLine, startColumn);
  const afterEnd = Math.min(probe.lineMaxColumn(endLine), endColumn + suffix.length);
  const after = probe.textBetween(endLine, endColumn, endLine, afterEnd);
  const sameLine = startLine === endLine;

  if (before === prefix && after === suffix) {
    return {
      edits: [
        { startLine: endLine, startColumn: endColumn, endLine, endColumn: afterEnd, text: '' },
        { startLine, startColumn: beforeStart, endLine: startLine, endColumn: startColumn, text: '' },
      ],
      selection: {
        startLine,
        // 只减头部：suffix 在 endColumn **之后**，删掉它不改变末端位置
        startColumn: startColumn - before.length,
        endLine,
        endColumn: sameLine ? endColumn - before.length : endColumn,
      },
    };
  }

  return {
    edits: [
      { startLine: endLine, startColumn: endColumn, endLine, endColumn, text: suffix },
      { startLine, startColumn, endLine: startLine, endColumn: startColumn, text: prefix },
    ],
    selection: {
      startLine,
      startColumn: startColumn + prefix.length,
      endLine,
      endColumn: sameLine ? endColumn + prefix.length : endColumn,
    },
  };
}
