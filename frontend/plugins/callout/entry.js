const ICONS = {
  note: 'ℹ️',
  info: 'ℹ️',
  tip: '💡',
  important: '💡',
  warn: '⚠️',
  warning: '⚠️',
  danger: '🛑',
  caution: '🛑',
  success: '✅',
  quote: '💬',
  question: '❓',
  abstract: '📋',
};

const TITLES = {
  note: '注意',
  info: '信息',
  tip: '提示',
  important: '重要',
  warn: '警告',
  warning: '警告',
  danger: '危险',
  caution: '警示',
  success: '成功',
  quote: '引用',
  question: '疑问',
  abstract: '摘要',
};

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export function register(md, ctx) {
  if (ctx.env.scope !== 'worker') return;

  const names = [
    'note',
    'tip',
    'warn',
    'warning',
    'danger',
    'caution',
    'success',
    'info',
    'quote',
    'question',
    'abstract',
    'important',
  ];

  ctx.onContainer(names, (name, body, attrs) => {
    const norm = name.toLowerCase();
    const type =
      norm === 'warning'
        ? 'warn'
        : norm === 'caution'
        ? 'danger'
        : norm === 'important'
        ? 'tip'
        : norm === 'info'
        ? 'note'
        : norm;
    const icon = ICONS[norm] || '💡';
    const title = attrs.title || TITLES[norm] || (norm.charAt(0).toUpperCase() + norm.slice(1));
    const content =
      md && typeof md.render === 'function' ? md.render(body) : `<p>${escapeHtml(body)}</p>`;

    return `<div class="ge-callout ge-callout--${type}">
      <div class="ge-callout__header">
        <span class="ge-callout__icon">${icon}</span>
        <span class="ge-callout__title">${escapeHtml(title)}</span>
      </div>
      <div class="ge-callout__body">${content}</div>
    </div>`;
  });
}
