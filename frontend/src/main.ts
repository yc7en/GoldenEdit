import './styles/tokens.css';
import './styles/app.css';

import * as api from './bridge';
import type { LayoutMode } from './bridge/types';
import { EditorHost } from './editor';
import { openExportDialog } from './export/dialog';
import { bench, benchCurrent, settle, type BenchRow } from './perf';
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
import { escapeHtml, mountShell, closeModal, openModal, setPreviewCollapsed, toast } from './ui/shell';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/**
 * 绑定点击。元素缺失时只告警不抛错——否则一个拼错的 id 会让整个 boot() 中断，
 * 表现为「窗口能开、预览永远是空的」，排查成本远高于一条 warning。
 */
function bind(id: string, handler: () => void): void {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[shell] 缺少元素 #${id}，跳过绑定`);
    return;
  }
  el.addEventListener('click', handler);
}

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
  const ws = $('workspace');
  const hidden = collapse ?? !ws.classList.contains('preview-hidden');
  // 手动开合时退出「仅预览」，否则预览收起后再点开还是看不见编辑区
  if (hidden) ws.classList.remove('layout-preview');
  applyLayout(hidden ? 'editor' : ws.classList.contains('layout-preview') ? 'preview' : 'split');
}

/**
 * 三布局（§8.2）：分栏 / 仅编辑 / 仅预览。
 * `persist` 为 false 时只改 DOM——用于「切标签时按记忆复原」，避免写回自己。
 */
function applyLayout(mode: LayoutMode, persist = true): void {
  const ws = $('workspace');
  ws.classList.toggle('layout-preview', mode === 'preview');
  setPreviewCollapsed(mode === 'editor');
  editorHost.layout();
  if (persist) store.persistDocState({ layout: mode, previewHidden: mode === 'editor' });
}

function setLayout(mode: LayoutMode): void {
  applyLayout(mode);
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
    setLayout,
    runPerf: () => {
      void (async () => {
        try {
          const row = await benchCurrent(preview);
          if (!row) {
            toast('先打开一篇文档再做性能自检', 'err');
            return;
          }
          const text = `${row.name} · ${row.kb}KB · ${row.blocks} 块 · 内核 ${row.kernelMs}ms · 墙钟 ${row.wallMs}ms`;
          store.pushLog('info', `性能自检：${text}`);
          toast(text);
        } catch (err) {
          toast(`性能自检失败：${(err as Error).message}`, 'err');
        }
      })();
    },
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
          setLayout('split');
          return;
        case '2':
          e.preventDefault();
          setLayout('editor');
          return;
        case '3':
          e.preventDefault();
          setLayout('preview');
          return;
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

/** 草稿恢复提示：磁盘内容与上次未保存的草稿不一致时问一次（§10.3） */
function wireDrafts(): void {
  bus.on('draft', (payload) => {
    const p = payload as { rel: string; at: number };
    const when = new Date(p.at).toLocaleString();
    const card = openModal(`
      <div class="modal__title">发现未保存的修改</div>
      <div class="modal__sub">${escapeHtml(p.rel)} 在 ${escapeHtml(when)} 有一份草稿，比磁盘上的内容新。要恢复吗？</div>
      <div class="modal__foot">
        <span class="grow"></span>
        <button class="btn" id="draftDrop" data-close="modal">丢弃草稿</button>
        <button class="btn btn--gold" id="draftKeep">恢复草稿</button>
      </div>`);
    card.querySelector('#draftKeep')?.addEventListener('click', () => {
      store.restoreDraft(p.rel);
      editorHost.refreshFromStore();
      closeModal();
      pushActiveDoc();
    });
    card.querySelector('#draftDrop')?.addEventListener('click', () => {
      store.clearDraft(p.rel);
      closeModal();
    });
  });
}

/** 打开宿主转来的绝对路径：在工作区里直接开，否则先切工作区（§9.7） */
async function openExternalPath(path: string): Promise<void> {
  const normalized = path.replace(/\\/g, '/');
  const info = store.vault;
  if (info) {
    const root = info.root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      await store.openFile(normalized.slice(root.length + 1));
      return;
    }
  }
  const dir = normalized.replace(/\/[^/]*$/, '');
  await store.openVaultPath(dir, true);
  await store.openFile(normalized.slice(normalized.lastIndexOf('/') + 1));
}

function wireOpenFile(): void {
  void api.on('app:open-file', (payload) => {
    void openExternalPath(payload.path).catch((err) =>
      toast(`打开失败：${(err as Error).message}`, 'err')
    );
  });
}

function wirePluginChanges(): void {
  void api.on('plugins:changed', () => {
    void (async () => {
      try {
        await store.refreshPlugins();
        const n = store.settings.plugins.enabled.length;
        toast(`插件目录已变更，重新加载 ${store.plugins.length} 个插件（启用 ${n} 个）`);
      } catch (err) {
        store.pushLog('error', `插件重扫失败：${(err as Error).message}`);
      }
    })();
  });
}

async function boot(): Promise<void> {  mountShell({
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
  wireDrafts();
  wireOpenFile();
  wirePluginChanges();

  bind('btnPalette', openPalette);
  bind('navPlugins', () => showPage('plugins'));
  bind('navExport', () => openExportDialog(preview));
  bind('btnSettings', () => showPage('settings'));

  bus.on('settings', applyTheme);
  bus.on('plugins', () => preview.rebuild(store.settings, store.plugins));
  bus.on('active', () => {
    showPage('main');
    const tab = store.activeTab;
    $('emptyState').hidden = Boolean(tab);
    if (!tab) return;
    const state = store.docState(tab.rel);
    applyRatio(state.ratio ?? 0.46);
    // 布局记忆：旧版本只存 previewHidden，这里按它推导，兼容已有 ui-state.json
    const layout: LayoutMode = state.layout ?? (state.previewHidden ? 'editor' : 'split');
    applyLayout(layout, false);
    if (state.width !== undefined) {
      preview.setWidth(state.width);
      document.querySelectorAll('#widthPresets .seg').forEach((s) => {
        s.classList.toggle('seg--on', Number((s as HTMLElement).dataset.width) === state.width);
      });
    }
    pushActiveDoc();
    renderRecentIfEmpty();
  });
  bus.on('doc-text', () => {
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

  // 启动参数里的文件：双击 .md 关联打开、`goldenedit a.md` 都走这里
  try {
    const pending = await api.takePendingOpen();
    if (pending) await openExternalPath(pending);
  } catch (err) {
    toast(`打开启动参数失败：${(err as Error).message}`, 'err');
  }

  // 性能探针：scripts/perf-check.mjs 通过它驱动真实渲染管线（§13.1）
  (window as unknown as Record<string, unknown>).__ge = {
    bench: (text: string, name?: string) => bench(preview, text, name),
    settle: () => settle(preview),
    store,
  };

  await maybeRunPerfSuite();
}

/**
 * 进程内性能验收：只有带着 `GE_PERF_MANIFEST` 启动时才走这条路（§13.1）。
 * 走的是和用户完全相同的渲染管线，不额外开调试端口。
 */
async function maybeRunPerfSuite(): Promise<void> {
  let plan: api.PerfPlan | null = null;
  try {
    plan = await api.perfPlan();
  } catch (err) {
    toast(`性能验收清单读取失败：${(err as Error).message}`, 'err');
    return;
  }
  if (!plan) return;

  const rows: (BenchRow & { budget: number })[] = [];
  let error: string | null = null;
  try {
    // 先确认外壳已经握手：没就绪时每个样本都要空等到超时，脚本只会报「超时」
    await preview.pushAndWait('# settle\n', 20_000);
    for (const sample of plan.samples) {
      // 每档前把预览打回空白：上一档遗留的懒填充会把这一档的首屏时间撑大
      await settle(preview);
      const row = await bench(preview, sample.text, sample.name);
      rows.push({ ...row, budget: sample.budget });
      store.pushLog(
        'info',
        `性能验收 ${sample.name}：墙钟 ${row.wallMs}ms / 预算 ${sample.budget}ms（内核 ${row.kernelMs}ms）`
      );
    }
  } catch (err) {
    // 失败也要把原因写回去，否则脚本只能报「超时」，看不出卡在哪
    error = (err as Error).message;
  }

  try {
    await api.perfReport(
      plan.out,
      JSON.stringify({
        rows,
        error,
        // 失败时把现场一起带回去：脚本只报「超时」时根本看不出是哪一环挂了
        diag: {
          server: store.previewServer?.origin ?? null,
          vault: store.vault?.root ?? null,
          tabs: store.tabs.length,
          logs: store.logs.slice(-12),
        },
      })
    );
  } catch (err) {
    toast(`性能结果写入失败：${(err as Error).message}`, 'err');
  }
}

function renderRecentIfEmpty(): void {
  if (store.tabs.length === 0) bus.emit('vault');
}

void boot();
