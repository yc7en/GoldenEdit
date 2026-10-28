import './styles/tokens.css';
import './styles/app.css';

import * as api from './bridge';
import { EditorHost } from './editor';
import { openExportDialog } from './export/dialog';
import { mountPluginsPage } from './plugins/page';
import { PreviewHost } from './preview/host';
import { mountSettingsPage } from './settings/page';
import { bus, store } from './store';
import { PREVIEW_TOKENS, resolveMode } from './theme/tokens';
import {
  closePalette,
  defaultCommands,
  isPaletteOpen,
  mountPalette,
  openPalette,
  registerCommands,
} from './ui/palette';
import { escapeHtml, mountShell, setPreviewCollapsed, toast } from './ui/shell';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let previewRatio = 0.46;
let activePage: 'main' | 'plugins' | 'settings' = 'main';

/* ───────── 主题 ───────── */

function applyTheme(): void {
  const editorMode = resolveMode(store.settings.theme.editor);
  const previewMode = resolveMode(store.settings.theme.preview);
  $('app').dataset.editorTheme = editorMode;
  editorHost.applyTheme();
  preview.setTheme(store.settings);
  document.querySelector('.pane--preview')?.setAttribute(
    'style',
    `background:${PREVIEW_TOKENS[previewMode]['--ge-bg']}`
  );
}

/* ───────── 页面切换 ───────── */

function showPage(page: 'main' | 'plugins' | 'settings'): void {
  activePage = page;
  $('page-plugins').hidden = page !== 'plugins';
  $('page-settings').hidden = page !== 'settings';
  $('tabstrip').classList.toggle('is-hidden', page !== 'main' || store.tabs.length === 0);
  $('navPlugins').classList.toggle('navrow--on', page === 'plugins');
  $('btnSettings').classList.toggle('is-on', page === 'settings');
  if (page !== 'main') closePalette();
  if (page === 'main') editorHost.layout();
}

/* ───────── 比例 ───────── */

function applyRatio(ratio: number): void {
  previewRatio = Math.min(0.8, Math.max(0.2, ratio));
  $('panePreview').style.flexBasis = `${previewRatio * 100}%`;
}

/* ───────── 预览 ───────── */

const preview = new PreviewHost($('preview') as HTMLIFrameElement, {
  onJump: (line) => editorHost.revealLine(line),
  onOutline: (items) => store.setOutline(items),
  onRendered: (info) => {
    store.setRenderInfo({
      blocks: info.blocks,
      ms: info.ms,
      plugins: info.plugins.length,
      errors: info.errors.length,
    });
    for (const err of info.errors) store.pushLog('error', `第 ${err.line} 行：${err.message}`);
  },
  onLog: (level, message) => store.pushLog(level, message),
  onOpenExternal: (url) => void api.openExternal(url),
  onPaused: (paused) => {
    const banner = $('previewStatText');
    banner.textContent = paused ? '文档较大，预览已暂停（点击恢复）' : '就绪';
  },
  onFatal: (message) => {
    store.pushLog('error', message);
    toast(message, 'err');
  },
});

function pushActiveDoc(): void {
  const tab = store.activeTab;
  if (!tab) return;
  preview.setDocPath(tab.rel, tab.name);
  preview.push(tab.text);
}

/* ───────── 编辑器 ───────── */

const editorHost = new EditorHost($('editor'));

/* ───────── 命令 ───────── */

function togglePreview(collapse?: boolean): void {
  const hidden = collapse ?? !$('workspace').classList.contains('preview-hidden');
  setPreviewCollapsed(hidden);
  store.persistDocState({ previewHidden: hidden });
  editorHost.layout();
}

function toggleOutline(): void {
  const group = $('grpOutline');
  const closed = group.classList.toggle('closed');
  store.persistGroupState({ grpOutline: closed });
  if (!closed) group.scrollIntoView({ block: 'nearest' });
}

function setPreset(preset: 'system' | 'writing' | 'light' | 'dark'): void {
  const map = {
    system: { editor: 'system', preview: 'system' },
    writing: { editor: 'dark', preview: 'light' },
    light: { editor: 'light', preview: 'light' },
    dark: { editor: 'dark', preview: 'dark' },
  } as const;
  void store.setSettingsPatch({ theme: { preset, ...map[preset] } });
}

registerCommands(
  defaultCommands({
    newFile: () => $('navNew').click(),
    openVault: () => void store.openVaultDialog(),
    save: () => void store.save(),
    closeTab: () => store.activeRel && store.closeTab(store.activeRel),
    togglePreview: () => togglePreview(),
    toggleOutline,
    openPlugins: () => showPage('plugins'),
    openExport: () => openExportDialog(preview),
    openSettings: () => showPage('settings'),
    setPreset,
  })
);

/* ───────── 启动 ───────── */

function wireWidthPresets(): void {
  const box = $('widthPresets');
  box.addEventListener('click', (e) => {
    const seg = (e.target as HTMLElement).closest('.seg') as HTMLElement | null;
    if (!seg?.dataset.width) return;
    const width = Number(seg.dataset.width);
    box.querySelectorAll('.seg').forEach((s) => s.classList.remove('seg--on'));
    seg.classList.add('seg--on');
    preview.setWidth(width);
    void store.setSettingsPatch({ preview: { width } });
    store.persistDocState({ width });
  });
}

function wireKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      togglePreview();
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      toggleOutline();
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      showPage('plugins');
      return;
    }
    if (mod && !e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault();
          void store.openVaultDialog();
          return;
        case 'e':
          e.preventDefault();
          openExportDialog(preview);
          return;
        case 'w':
          e.preventDefault();
          if (store.activeRel) store.closeTab(store.activeRel);
          return;
        case '1':
          e.preventDefault();
          setPreviewCollapsed(false);
          $('paneEditor').style.display = '';
          break;
        case '2':
          e.preventDefault();
          setPreviewCollapsed(true);
          $('paneEditor').style.display = '';
          break;
        case '3':
          e.preventDefault();
          setPreviewCollapsed(false);
          break;
        default:
          break;
      }
    }
    if (e.key === 'Escape') {
      if (isPaletteOpen()) closePalette();
      if (activePage !== 'main') showPage('main');
    }
  });
}

function wireExternalChanges(): void {
  void api.on('vault:changed', (payload) => {
    const active = store.activeRel;
    void (async () => {
      if (active && payload.paths.includes(active)) {
        const tab = store.activeTab;
        try {
          const doc = await api.readDoc(active);
          if (tab && doc.mtime !== tab.mtime && doc.text !== tab.savedText) {
            promptExternalChange(active, doc.text);
          }
        } catch {
          /* 文件可能已被删除 */
        }
      }
      const root = store.tree.get('') ?? [];
      store.tree.clear();
      store.expanded.add('');
      await store.loadDir('');
      for (const rel of [...store.expanded]) {
        if (rel) await store.loadDir(rel).catch(() => []);
      }
      if (root.length === 0) bus.emit('tree');
      bus.emit('tree');
    })();
  });
}

function promptExternalChange(rel: string, diskText: string): void {
  const modal = $('modal');
  const card = $('modalCard');
  card.innerHTML = `
    <div class="modal__title">文件已被外部修改</div>
    <div class="modal__sub">${escapeHtml(rel)} 在磁盘上变化了，你要保留哪一份？</div>
    <div class="modal__foot">
      <span class="grow"></span>
      <button class="btn" id="extKeep" data-close="modal">保留我的</button>
      <button class="btn btn--gold" id="extReload">重载磁盘版本</button>
    </div>`;
  modal.hidden = false;
  card.querySelector('#extReload')?.addEventListener('click', () => {
    const tab = store.activeTab;
    if (tab) {
      tab.text = diskText;
      tab.savedText = diskText;
      tab.dirty = false;
    }
    editorHost.refreshFromStore();
    modal.hidden = true;
    pushActiveDoc();
  });
  card.querySelector('#extKeep')?.addEventListener('click', () => {
    modal.hidden = true;
    store.setCursor(store.activeTab?.line ?? 1, store.activeTab?.col ?? 1);
  });
}

function wireDragDrop(): void {
  void api.onDragDrop((paths) => {
    const first = paths[0];
    if (!first) return;
    const lower = first.toLowerCase();
    if (/\.(md|markdown|txt)$/.test(lower)) {
      void (async () => {
        const info = store.vault;
        if (info && first.startsWith(info.root)) {
          const rel = first.slice(info.root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
          await store.openFile(rel);
        } else {
          const dir = first.replace(/[\\/][^\\/]+$/, '');
          await store.openVaultPath(dir, true);
        }
      })();
      return;
    }
    void store.openVaultPath(first, true);
  });
}

async function boot(): Promise<void> {
  mountShell({
    revealLine: (line) => {
      showPage('main');
      editorHost.revealLine(line);
    },
    togglePreview: (hidden) => togglePreview(hidden),
    ratio: () => previewRatio,
  });
  mountPalette();
  mountPluginsPage();
  mountSettingsPage();
  wireWidthPresets();
  wireKeyboard();
  wireExternalChanges();
  wireDragDrop();

  $('btnPalette').addEventListener('click', openPalette);
  $('btnPlugins').addEventListener('click', () => showPage('plugins'));
  $('navPlugins').addEventListener('click', () => showPage('plugins'));
  $('navExport').addEventListener('click', () => openExportDialog(preview));
  $('btnSettings').addEventListener('click', () => showPage('settings'));

  bus.on('settings', applyTheme);
  bus.on('plugins', () => preview.rebuild(store.settings, store.plugins));
  bus.on('active', () => {
    showPage('main');
    const tab = store.activeTab;
    $('emptyState').hidden = Boolean(tab);
    if (!tab) return;
    const state = store.docState(tab.rel);
    applyRatio(state.ratio ?? 0.46);
    if (state.previewHidden !== undefined) setPreviewCollapsed(state.previewHidden);
    if (state.width !== undefined) {
      preview.setWidth(state.width);
      document.querySelectorAll('#widthPresets .seg').forEach((s) => {
        s.classList.toggle('seg--on', Number((s as HTMLElement).dataset.width) === state.width);
      });
    }
    pushActiveDoc();
    renderRecentIfEmpty();
  });
  bus.on('render', () => {
    if (store.activeTab) preview.push(store.activeTab.text);
  });
  bus.on('vault', () => showPage('main'));

  try {
    await store.init();
  } catch (err) {
    toast(`初始化失败：${(err as Error).message}`, 'err');
  }
  await store.refreshPlugins();
  applyTheme();

  try {
    const info = await api.startPreviewServer();
    store.previewServer = info;
    preview.configure(store.settings, store.plugins);
    await preview.attach(info);
  } catch (err) {
    toast(`预览服务启动失败：${(err as Error).message}`, 'err');
    store.pushLog('error', String(err));
  }

  setPreviewCollapsed(false);
  $('emptyState').hidden = store.tabs.length > 0;
  renderRecentIfEmpty();
  applyTheme();
}

function renderRecentIfEmpty(): void {
  if (store.tabs.length === 0) bus.emit('vault');
}

void boot();
