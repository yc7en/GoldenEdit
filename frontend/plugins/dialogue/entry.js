/**
 * 对白容器：把「角色: 台词」的每一行排成气泡。
 *
 * 两种写法都认，但**推荐围栏**（与 mermaid / markmap / score 一致）：
 *
 * ```dialogue
 * 旁白: 某团队正在开评审会。
 * 技术主管(右): 报告，全部完成！
 * ```
 *
 * 旧的 `::: dialogue` 容器语法继续支持——存量笔记不能因为换个写法就渲染成
 * 一段带冒号的普通文本；新写法不再往文档和面板里推。
 */

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const RIGHT_SPEAKERS = new Set(['user', 'me', '用户', '我', 'right', 'b', 'client']);

/** 三种写法共用的名字：dialogue / dialog / chat */
const NAMES = ['dialogue', 'dialog', 'chat'];

function renderBody(md, body) {
  const lines = String(body ?? '').split('\n');
  const bubbles = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    const cnColonIdx = line.indexOf('：');
    const idx =
      colonIdx !== -1 && cnColonIdx !== -1
        ? Math.min(colonIdx, cnColonIdx)
        : colonIdx !== -1
        ? colonIdx
        : cnColonIdx;

    let speaker = '旁白';
    let text = line;
    if (idx !== -1 && idx < 20) {
      speaker = line.slice(0, idx).trim();
      text = line.slice(idx + 1).trim();
    }

    const isRight =
      RIGHT_SPEAKERS.has(speaker.toLowerCase()) ||
      speaker.endsWith('(右)') ||
      speaker.endsWith('[right]') ||
      line.includes('[right]');
    const cleanSpeaker = speaker.replace(/\((?:右|right)\)|\[(?:右|right)\]/gi, '').trim() || speaker;
    const side = isRight ? 'right' : 'left';
    const renderedText =
      md && typeof md.renderInline === 'function' ? md.renderInline(text) : escapeHtml(text);

    bubbles.push(
      `<div class="ge-bubble ge-bubble--${side}">
          <span class="ge-bubble__name">${escapeHtml(cleanSpeaker)}</span>
          <div class="ge-bubble__msg">${renderedText}</div>
        </div>`
    );
  }

  return `<div class="ge-dialogue">${bubbles.join('\n')}</div>`;
}

export function register(md, ctx) {
  if (ctx.env.scope !== 'worker') return;

  ctx.onContainer(NAMES, (_name, body) => renderBody(md, body));
  ctx.onFence(NAMES, (_info, code) => renderBody(md, code));
}
