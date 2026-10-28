function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const LANGS = [
  'js',
  'javascript',
  'ts',
  'typescript',
  'json',
  'html',
  'css',
  'rust',
  'rs',
  'python',
  'py',
  'sh',
  'bash',
  'shell',
  'yaml',
  'yml',
  'sql',
  'xml',
  'markdown',
  'md',
  'c',
  'cpp',
  'go',
  'java',
];

export function register(md, ctx) {
  if (ctx.env.scope === 'worker') {
    ctx.onFence(LANGS, (info, code) => {
      const lang = info.split(/\s+/)[0] || 'text';
      return `<div class="ge-codebar">
        <div class="ge-codebar__header">
          <span class="ge-codebar__lang">${escapeHtml(lang)}</span>
          <button class="ge-codebar__copy" type="button" data-code="${escapeAttr(code)}">复制</button>
        </div>
        <pre class="ge-codebar__pre"><code>${escapeHtml(code)}</code></pre>
      </div>`;
    });
  } else if (ctx.env.scope === 'main') {
    ctx.onMount('.ge-codebar__copy', (btn) => {
      btn.onclick = async () => {
        const code = btn.getAttribute('data-code') || '';
        try {
          await window.navigator.clipboard.writeText(code);
          const orig = btn.textContent;
          btn.textContent = '已复制!';
          window.setTimeout(() => {
            btn.textContent = orig;
          }, 1500);
        } catch {
          btn.textContent = '失败';
          window.setTimeout(() => {
            btn.textContent = '复制';
          }, 1500);
        }
      };
    });
  }
}
