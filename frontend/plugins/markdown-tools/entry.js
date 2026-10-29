/**
 * markdown-tools：正文区的文本命令（ARCHITECTURE §5.11 / §8.5）。
 *
 * 这个插件只在主页面生效（ctx.env.scope === 'main'）。预览侧也会 import 它，
 * 那时 scope 是 'worker'，直接返回——所以顶层代码不能有任何副作用。
 *
 * 两条产品承诺：
 * 1. 「格式化文档」只对齐表格，不碰其它任何东西；
 * 2. 待办标记用 GFM 的 `- [ ]`，日期可配（宿主注入 ctx.config.taskDateFormat）。
 */

const DEFAULT_DATE = 'YYYY年M月D日 HH:mm';

/* ───────── 显示宽度：CJK 算 2 ───────── */

const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function textWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    // 组合符与零宽字符不占列
    if (cp === 0x200b || cp === 0x200d || cp === 0xfe0f || (cp >= 0x0300 && cp <= 0x036f)) continue;
    w += WIDE.test(ch) ? 2 : 1;
  }
  return w;
}

function padTo(s, width) {
  const gap = width - textWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

/* ───────── 表格 ───────── */

function splitRow(line) {
  const trimmed = line.trim();
  let inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  if (inner.endsWith('|') && !inner.endsWith('\\|')) inner = inner.slice(0, -1);

  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      cur += '\\|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell) {
  const c = cell.replace(/\s/g, '');
  if (/^:-+:$/.test(c)) return 'center';
  if (/^:-+$/.test(c)) return 'left';
  if (/^-+:$/.test(c)) return 'right';
  return 'none';
}

function isDelimiterRow(cells) {
  return (
    cells.length > 0 &&
    cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')) && c.replace(/\s/g, '').length > 0)
  );
}

function delimiterFor(align, width) {
  const w = Math.max(3, width);
  switch (align) {
    case 'left':
      return ':' + '-'.repeat(w - 1);
    case 'right':
      return '-'.repeat(w - 1) + ':';
    case 'center':
      return ':' + '-'.repeat(w - 2) + ':';
    default:
      return '-'.repeat(w);
  }
}

/** 对一个表格块（不含缩进）重新排版，返回同样行数的数组 */
function alignBlock(block, indent) {
  const rows = block.map(splitRow);
  const cols = Math.max(...rows.map((r) => r.length));
  const aligns = [];
  for (let i = 0; i < cols; i++) aligns.push(alignOf(rows[1][i] ?? ''));

  const widths = new Array(cols).fill(3);
  for (let r = 0; r < rows.length; r++) {
    if (r === 1) continue;
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i], textWidth(rows[r][i] ?? ''));
    }
  }

  return rows.map((cells, index) => {
    const parts = [];
    for (let i = 0; i < cols; i++) {
      if (index === 1) parts.push(delimiterFor(aligns[i], widths[i]));
      else parts.push(padTo(cells[i] ?? '', widths[i]));
    }
    return `${indent}| ${parts.join(' | ')} |`;
  });
}

function isTableLine(line) {
  return /^\s*\|/.test(line);
}

function indentOf(line) {
  return (line.match(/^\s*/) ?? [''])[0];
}

/**
 * 对齐全文里的所有表格。fenced code block 内的内容一律跳过——
 * 代码块里的 `|` 不是表格，改它就是改代码。
 */
export function alignTables(lines) {
  const out = lines.slice();
  let inFence = false;
  let fenceMark = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1][0];
      } else if (fence[1][0] === fenceMark) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    if (!isTableLine(line)) continue;
    if (i + 1 >= lines.length || !isTableLine(lines[i + 1])) continue;
    const head = splitRow(line);
    const delim = splitRow(lines[i + 1]);
    if (head.length !== delim.length || !isDelimiterRow(delim)) continue;

    let end = i + 2;
    while (end < lines.length && isTableLine(lines[end])) end += 1;

    const indent = indentOf(line);
    const aligned = alignBlock(lines.slice(i, end), indent);
    for (let k = 0; k < aligned.length; k++) out[i + k] = aligned[k];
    i = end - 1;
  }

  return out;
}

/* ───────── 待办 ───────── */

const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function formatDate(date, pattern) {
  const p = pattern || DEFAULT_DATE;
  const pad = (n) => String(n).padStart(2, '0');
  // 先替换双字符占位符再替换单字符，否则 M 会先把 MM 拆掉
  return p
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/M/g, String(date.getMonth() + 1))
    .replace(/DD/g, pad(date.getDate()))
    .replace(/D/g, String(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/H/g, String(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/m/g, String(date.getMinutes()));
}

/** 取出删除线里的原文；没有删除线就砍掉尾部日期 */
function unwrap(text) {
  const struck = text.match(/~~([\s\S]+?)~~/);
  if (struck) return struck[1].trim();
  return text
    .replace(/\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s+\d{1,2}:\d{2}\s*$/, '')
    .replace(/\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\s*$/, '')
    .trim();
}

function taskOf(line) {
  const m = line.match(TASK);
  if (!m) return null;
  return {
    indent: m[1],
    marker: m[2],
    done: m[3].toLowerCase() === 'x',
    body: unwrap(m[4]),
  };
}

export function toTask(line) {
  const task = taskOf(line);
  if (task) return `${task.indent}${task.marker} [ ] ${task.body}`;

  const list = line.match(LIST);
  if (list) return `${list[1]}${list[2]} [ ] ${unwrap(list[3])}`;

  const indent = indentOf(line);
  const body = line.trim();
  if (!body) return line;
  return `${indent}- [ ] ${body}`;
}

export function markDone(line, date) {
  // 不是待办就先转成待办：少一步操作，也避免「点了没反应」
  const task = taskOf(line) ?? taskOf(toTask(line));
  if (!task) return line;
  return `${task.indent}${task.marker} [x] ~~${task.body}~~ ${date}`;
}

export function markUndone(line) {
  const task = taskOf(line);
  if (!task) return line;
  return `${task.indent}${task.marker} [ ] ${task.body}`;
}

export function clearTask(line) {
  const task = taskOf(line);
  if (!task) return line;
  // 保留列表前缀，只去掉复选框与附加日期（§8.5 的取舍）
  return `${task.indent}${task.marker} ${task.body}`;
}

/** 对选区逐行套一个转换函数，跳过空行 */
function mapLines(ed, fn) {
  const sel = ed.getSelection();
  const from = sel.empty ? ed.getCursorLine() : sel.startLine;
  const to = sel.empty ? ed.getCursorLine() : sel.endLine;
  const changed = [];
  for (let n = from; n <= to; n++) {
    const line = ed.getLine(n);
    if (!line.trim()) {
      changed.push(line);
      continue;
    }
    changed.push(fn(line));
  }
  if (changed.join('\n') === sourceOf(ed, from, to)) return false;
  ed.replaceLines(from, to, changed);
  return true;
}

function sourceOf(ed, from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(ed.getLine(n));
  return out.join('\n');
}

/* ───────── 入口 ───────── */

export function register(md, ctx) {
  // 预览侧（Worker / iframe）不需要编辑器命令，直接让路
  if (!ctx || !ctx.env || ctx.env.scope !== 'main' || !ctx.commands) return;

  const datePattern = ctx.config && ctx.config.taskDateFormat;

  ctx.commands.register({
    id: 'formatTable',
    title: '格式化文档',
    group: '文本',
    default: 'Shift+Alt+F',
    when: ['editor'],
    run(ed) {
      const lines = ed.getText().split('\n');
      const aligned = alignTables(lines);
      if (aligned.join('\n') === lines.join('\n')) {
        ctx.log('info', '没有需要对齐的表格');
        return;
      }
      // 只替换真正变化的那一段：整篇重写会让 diff 变成满屏红绿
      let first = -1;
      let last = -1;
      for (let i = 0; i < aligned.length; i++) {
        if (aligned[i] !== lines[i]) {
          if (first < 0) first = i;
          last = i;
        }
      }
      ed.replaceLines(first + 1, last + 1, aligned.slice(first, last + 1));
    },
  });

  ctx.commands.register({
    id: 'toggleTask',
    title: '转换为待办',
    group: '文本',
    default: 'Ctrl+Shift+T',
    when: ['editor'],
    run: (ed) => mapLines(ed, toTask),
  });

  ctx.commands.register({
    id: 'markDone',
    title: '标记为已完成',
    group: '文本',
    default: 'Ctrl+Alt+D',
    when: ['editor'],
    run: (ed) => mapLines(ed, (line) => markDone(line, formatDate(new Date(), datePattern))),
  });

  ctx.commands.register({
    id: 'markUndone',
    title: '标记为未完成',
    group: '文本',
    default: 'Ctrl+Alt+U',
    when: ['editor'],
    run: (ed) => mapLines(ed, markUndone),
  });

  ctx.commands.register({
    id: 'clearTask',
    title: '取消待办标记',
    group: '文本',
    when: ['editor'],
    run: (ed) => mapLines(ed, clearTask),
  });
}
