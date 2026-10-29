import { store } from '../store';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let commands: Command[] = [];
let filtered: Command[] = [];
let cursor = 0;

export function registerCommands(list: Command[]): void {
  commands = list;
}

export function openPalette(): void {
  const box = $('palette');
  box.hidden = false;
  const input = $('paletteInput') as HTMLInputElement;
  input.value = '';
  filtered = commands.slice();
  cursor = 0;
  render();
  input.focus();
}

export function closePalette(): void {
  $('palette').hidden = true;
}

export function isPaletteOpen(): boolean {
  return !$('palette').hidden;
}

function render(): void {
  const list = $('paletteList');
  list.innerHTML = '';
  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = `pitem${i === cursor ? ' is-on' : ''}`;
    item.innerHTML = `<span>${cmd.title}</span>${cmd.hint ? `<span class="pitem__k">${cmd.hint}</span>` : ''}`;
    item.addEventListener('click', () => exec(cmd));
    item.addEventListener('mousemove', () => {
      if (cursor !== i) {
        cursor = i;
        render();
      }
    });
    list.appendChild(item);
  });
  if (filtered.length === 0) {
    list.innerHTML = '<div class="pitem">没有匹配的命令</div>';
  }
}

function exec(cmd: Command): void {
  closePalette();
  cmd.run();
}

export function mountPalette(): void {
  const input = $('paletteInput') as HTMLInputElement;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = commands.filter((c) => `${c.title} ${c.id}`.toLowerCase().includes(q));
    cursor = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      cursor = Math.min(cursor + 1, filtered.length - 1);
      render();
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      cursor = Math.max(cursor - 1, 0);
      render();
      e.preventDefault();
    }
    if (e.key === 'Enter' && filtered[cursor]) exec(filtered[cursor]);
  });
  document.querySelector('[data-close="palette"]')?.addEventListener('click', closePalette);
}

export function defaultCommands(actions: {
  newFile: () => void;
  openVault: () => void;
  save: () => void;
  closeTab: () => void;
  togglePreview: () => void;
  toggleOutline: () => void;
  openPlugins: () => void;
  openExport: () => void;
  openSettings: () => void;
  setPreset: (preset: 'system' | 'writing' | 'light' | 'dark') => void;
  setLayout: (mode: 'split' | 'editor' | 'preview') => void;
  runPerf?: () => void;
}): Command[] {
  return [
    { id: 'file.new', title: '新建文档', hint: 'Ctrl N', run: actions.newFile },
    { id: 'file.open', title: '打开文件夹…', hint: 'Ctrl K', run: actions.openVault },
    { id: 'file.save', title: '保存当前文档', hint: 'Ctrl S', run: actions.save },
    { id: 'tab.close', title: '关闭当前标签', hint: 'Ctrl W', run: actions.closeTab },
    { id: 'view.split', title: '布局：分栏', hint: 'Ctrl 1', run: () => actions.setLayout('split') },
    { id: 'view.editor', title: '布局：仅编辑', hint: 'Ctrl 2', run: () => actions.setLayout('editor') },
    { id: 'view.preview', title: '布局：仅预览', hint: 'Ctrl 3', run: () => actions.setLayout('preview') },
    { id: 'view.toggle', title: '切换预览面板', hint: 'Ctrl+Shift+V', run: actions.togglePreview },
    { id: 'view.outline', title: '折叠 / 展开大纲', hint: 'Ctrl+Shift+O', run: actions.toggleOutline },
    { id: 'page.plugins', title: '打开插件页', run: actions.openPlugins },
    { id: 'page.export', title: '导出…', hint: 'Ctrl E', run: actions.openExport },
    { id: 'page.settings', title: '设置', run: actions.openSettings },
    { id: 'theme.system', title: '主题：跟随系统', run: () => actions.setPreset('system') },
    { id: 'theme.writing', title: '主题：写作模式', run: () => actions.setPreset('writing') },
    { id: 'theme.light', title: '主题：全亮', run: () => actions.setPreset('light') },
    { id: 'theme.dark', title: '主题：全暗', run: () => actions.setPreset('dark') },
    ...(actions.runPerf
      ? [{ id: 'debug.perf', title: '诊断：渲染性能自检', run: actions.runPerf }]
      : []),
    {
      id: 'debug.info',
      title: '诊断：查看最近日志',
      run: () => store.pushLog('info', `块 ${store.renderInfo.blocks} · ${store.renderInfo.ms}ms`),
    },
  ];
}
