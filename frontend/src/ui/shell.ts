import * as api from '../bridge';
import { bus, store } from '../store';
import type { Entry } from '../bridge/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface ShellDeps {
  revealLine: (line: number) => void;
  togglePreview: (hidden: boolean) => void;
  ratio: () => number;
}

let deps: ShellDeps;

export function mountShell(d: ShellDeps): void {
  deps = d;
  wireGroups();
  wireTabs();
  wireSplitter();
  wireNav();
  wireTreeDelegation();
  wirePreviewToggle();

  bus.on('vault', renderVaultChrome);
  bus.on('tree', renderTree);
  bus.on('tabs', renderTabs);
  bus.on('active', () => {
    renderTabs();
    renderTree();
  });
  bus.on('outline', renderOutline);
  bus.on('commits', renderTimeline);
  bus.on('status', renderStatus);
  bus.on('render', renderStatus);
  bus.on('toast', (payload) => {
    const p = payload as { text: string; kind?: 'ok' | 'err' };
    toast(p.text, p.kind ?? 'ok');
  });

  renderVaultChrome();
  renderTabs();
  renderStatus();
}

/* ───────── 分组折叠 ───────── */

function wireGroups(): void {
  for (const id of ['grpFiles', 'grpOutline', 'grpTimeline']) {
    const group = document.getElementById(id);
    const head = group?.querySelector('.group__head') as HTMLElement | null;
    head?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('gadd')) return;
      if (!group) return;
      const closed = group.classList.toggle('closed');
      store.persistGroupState({ [id]: closed });
    });
  }
}

function applyGroupState(): void {
  const groups = store.vaultUi.groups ?? {};
  for (const [id, closed] of Object.entries(groups)) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('closed', Boolean(closed));
  }
}

/* ───────── 左栏外壳 ───────── */

function renderVaultChrome(): void {
  const vault = store.vault;
  $('vaultName').textContent = vault ? vault.name : '未打开工作区';
  $('footName').textContent = vault ? vault.name : '本地工作区';
  $('footSub').textContent = vault ? vault.root : '未打开文件夹';
  $('appVersion').textContent = `v${store.appVersion}`;
  $('emptyState').hidden = store.tabs.length > 0;
  applyGroupState();
  renderRecent();
}

function renderRecent(): void {
  const box = $('recentList');
  box.innerHTML = '';
  if (store.tabs.length > 0) return;
  const recents = store.settings.recents.slice(0, 5);
  if (recents.length === 0) return;
  const title = document.createElement('div');
  title.className = 'empty__recent-t';
  title.textContent = '最近项目';
  box.appendChild(title);
  for (const path of recents) {
    const item = document.createElement('div');
    item.className = 'empty__recent-i';
    item.textContent = path;
    item.title = path;
    item.addEventListener('click', () => {
      void store.openVaultPath(path, true);
    });
    box.appendChild(item);
  }
}

/* ───────── 标签页 ───────── */

function renderTabs(): void {
  const strip = $('tabstrip');
  strip.innerHTML = '';
  strip.classList.toggle('is-hidden', store.tabs.length === 0);
  if (store.tabs.length === 0) {
    strip.innerHTML = '<div class="tabstrip__empty">没有打开的文件</div>';
    $('emptyState').hidden = false;
    return;
  }
  $('emptyState').hidden = true;
  for (const tab of store.tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.rel === store.activeRel ? ' is-active' : ''}`;
    el.innerHTML =
      `<span class="tab__name">${escapeHtml(tab.name)}</span>` +
      (tab.dirty ? '<span class="tab__dot"></span>' : '') +
      '<button class="tab__close" title="关闭">×</button>';
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('tab__close')) {
        store.closeTab(tab.rel);
        return;
      }
      store.activate(tab.rel);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) store.closeTab(tab.rel);
    });
    strip.appendChild(el);
  }
}

function wireTabs(): void {
  $('tabstrip').addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).id === 'tabstrip') $('navNew').click();
  });
}

/* ───────── 文件树 ───────── */

function renderTree(): void {
  const box = $('fileTree');
  box.innerHTML = '';
  if (!store.vault) {
    box.innerHTML = '<div class="row row--empty">打开文件夹后显示文件</div>';
    $('fileCount').textContent = '0';
    return;
  }
  const root = store.tree.get('') ?? [];
  $('fileCount').textContent = String(root.length);
  renderLevel(root, box);
}

function renderLevel(entries: Entry[], parent: HTMLElement): void {
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const isDir = entry.kind === 'dir';
    const expanded = store.expanded.has(entry.rel);
    const row = document.createElement('div');
    const active = !isDir && entry.rel === store.activeRel;
    row.className = `row${isDir ? '' : ' row--file'}${active ? ' row--on' : ''}`;
    row.dataset.rel = entry.rel;
    row.dataset.kind = entry.kind;
    row.innerHTML = isDir
      ? `<span class="gcaret"${expanded ? '' : ' style="transform:rotate(-90deg)"'}></span>` +
        `<span class="row__name">${escapeHtml(entry.name)}</span>` +
        `<span class="row__meta">${(store.tree.get(entry.rel) ?? []).length || ''}</span>`
      : `<span class="row__name">${escapeHtml(entry.name)}</span>`;
    parent.appendChild(row);
    if (isDir && expanded) {
      const children = store.tree.get(entry.rel) ?? [];
      renderLevel(children, parent);
    }
  }
}

function wireTreeDelegation(): void {
  const box = $('fileTree');
  box.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null;
    if (!row || !row.dataset.rel) return;
    if (row.dataset.kind === 'dir') void store.toggleDir(row.dataset.rel);
    else void store.openFile(row.dataset.rel);
  });
  box.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest('.row') as HTMLElement | null;
    openTreeMenu(e.clientX, e.clientY, row?.dataset.rel ?? '', row?.dataset.kind !== 'dir');
  });

  $('btnNewFile').addEventListener('click', (e) => {
    e.stopPropagation();
    void createFilePrompt('');
  });
}

function openTreeMenu(x: number, y: number, rel: string, isFile: boolean): void {
  closeMenu();
  const parent = isFile && rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : isFile ? '' : rel;
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const items: [string, () => void][] = [
    ['新建文件', () => void createFilePrompt(parent)],
    ['新建文件夹', () => void createFolderPrompt(parent)],
  ];
  if (rel) {
    items.push(
      ['重命名', () => void renamePrompt(rel)],
      ['在资源管理器中显示', () => void api.revealInExplorer(rel)],
      ['删除', () => void deletePrompt(rel)]
    );
  }
  for (const [label, action] of items) {
    const item = document.createElement('button');
    item.className = 'ctxmenu__i';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenu();
      action();
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const close = () => closeMenu();
  setTimeout(() => {
    document.addEventListener('click', close, { once: true });
  }, 0);
}

function closeMenu(): void {
  document.querySelectorAll('.ctxmenu').forEach((el) => el.remove());
}

async function createFilePrompt(parent: string): Promise<void> {
  const name = window.prompt('新文件名（含扩展名）', 'untitled.md');
  if (!name) return;
  try {
    await store.createFile(name, parent);
  } catch (err) {
    toast(`创建失败：${(err as Error).message}`, 'err');
  }
}

async function createFolderPrompt(parent: string): Promise<void> {
  const name = window.prompt('新文件夹名', 'notes');
  if (!name) return;
  const rel = parent ? `${parent}/${name}` : name;
  try {
    await api.createEntry(rel, 'dir');
    store.tree.delete(parent);
    await store.loadDir(parent);
  } catch (err) {
    toast(`创建失败：${(err as Error).message}`, 'err');
  }
}

async function renamePrompt(rel: string): Promise<void> {
  const name = window.prompt('新名称', rel.split('/').pop() ?? rel);
  if (!name) return;
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const to = parent ? `${parent}/${name}` : name;
  try {
    await api.renameEntry(rel, to);
    store.tree.clear();
    await store.loadDir('');
    bus.emit('tree');
  } catch (err) {
    toast(`重命名失败：${(err as Error).message}`, 'err');
  }
}

async function deletePrompt(rel: string): Promise<void> {
  if (!window.confirm(`确定删除 ${rel}？（移入回收站）`)) return;
  try {
    await store.deleteEntry(rel);
    toast('已移入回收站');
  } catch (err) {
    toast(`删除失败：${(err as Error).message}`, 'err');
  }
}

/* ───────── 大纲 / 版本 ───────── */

function renderOutline(): void {
  const box = $('outlineBody');
  box.innerHTML = '';
  $('outlineCount').textContent = String(store.outline.length);
  if (store.outline.length === 0) {
    box.innerHTML = '<div class="row row--empty">当前文档没有标题</div>';
    return;
  }
  for (const item of store.outline) {
    const row = document.createElement('div');
    row.className = `olrow${item.level >= 3 ? ' olrow--3' : item.level === 2 ? ' olrow--2' : ''}`;
    row.textContent = item.text;
    row.title = item.text;
    row.addEventListener('click', () => deps.revealLine(item.line));
    box.appendChild(row);
  }
}

function renderTimeline(): void {
  const box = $('timelineBody');
  box.innerHTML = '';
  $('timelineCount').textContent = String(store.commits.length);
  if (store.commits.length === 0) {
    box.innerHTML = '<div class="row row--empty">工作区没有 git 记录</div>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'tl';
  store.commits.forEach((commit, i) => {
    const item = document.createElement('div');
    item.className = `tl__item${i === 0 ? ' tl__item--head' : ''}`;
    const date = commit.date ? new Date(commit.date) : null;
    const when = date ? `${date.getMonth() + 1}/${date.getDate()}` : '';
    item.innerHTML =
      '<span class="tl__dot"></span>' +
      `<div class="tl__top"><span class="tl__ver">${escapeHtml(commit.short)}</span><span>${when}</span></div>` +
      `<div class="tl__msg">${escapeHtml(commit.subject)}</div>`;
    item.title = `${commit.hash}\n${commit.subject}`;
    wrap.appendChild(item);
  });
  box.appendChild(wrap);
}

/* ───────── 状态条 ───────── */

function renderStatus(): void {
  const tab = store.activeTab;
  const words = store.wordCount();
  $('statWord').textContent = `${words} 字`;
  $('statRead').textContent = `${Math.max(1, Math.round(words / 400))} 分钟`;
  $('statCursor').textContent = tab ? `行 ${tab.line} · 列 ${tab.col}` : '行 1 · 列 1';
  $('statLang').textContent = tab ? 'Markdown' : '—';
  const ratioText = `${Math.round(deps.ratio() * 100)}/${100 - Math.round(deps.ratio() * 100)}`;
  $('statRatio').textContent = document
    .getElementById('workspace')!
    .classList.contains('preview-hidden')
    ? '预览已收起'
    : `分栏 ${ratioText}`;
  const info = store.renderInfo;
  const stat = $('previewStatText');
  const dot = document.querySelector('#previewStat .dot');
  if (info.errors > 0) {
    stat.textContent = `${info.errors} 个块渲染失败`;
    dot?.classList.remove('dot--ok');
    dot?.classList.add('dot--err');
  } else if (info.blocks > 0) {
    stat.textContent = `${info.plugins} 插件 · ${info.ms}ms`;
    dot?.classList.add('dot--ok');
    dot?.classList.remove('dot--err');
  } else {
    stat.textContent = '就绪';
  }
}

/* ───────── 分隔条与预览开合 ───────── */

function wireSplitter(): void {
  const splitter = $('splitter');
  const workspace = $('workspace');
  const preview = $('panePreview');

  let dragging = false;
  splitter.addEventListener('mousedown', (e) => {
    if (workspace.classList.contains('preview-hidden')) return;
    dragging = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    const ratio = 1 - (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(0.8, Math.max(0.2, ratio));
    preview.style.flexBasis = `${clamped * 100}%`;
    renderStatus();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    const ratio = parseFloat(preview.style.flexBasis || '46') / 100;
    store.persistDocState({ ratio });
  });
  splitter.addEventListener('dblclick', () => {
    deps.togglePreview(true);
  });
}

function wirePreviewToggle(): void {
  $('btnPreview').addEventListener('click', () => {
    const hidden = !$('workspace').classList.contains('preview-hidden');
    deps.togglePreview(hidden);
  });
  $('btnCollapsePreview').addEventListener('click', () => deps.togglePreview(true));
}

export function setPreviewCollapsed(hidden: boolean): void {
  const workspace = $('workspace');
  workspace.classList.toggle('preview-hidden', hidden);
  $('btnPreview').classList.toggle('is-on', !hidden);
  renderStatus();
}

/* ───────── 导航区 ───────── */

function wireNav(): void {
  $('navNew').addEventListener('click', () => {
    if (!store.vault) {
      toast('先打开一个文件夹', 'err');
      return;
    }
    const parent = store.activeTab?.rel.includes('/')
      ? store.activeTab.rel.slice(0, store.activeTab.rel.lastIndexOf('/'))
      : '';
    void createFilePrompt(parent);
  });
  $('navOpen').addEventListener('click', () => void store.openVaultDialog());
  $('emptyOpen').addEventListener('click', () => void store.openVaultDialog());
  $('emptyNew').addEventListener('click', () => $('navNew').click());
  $('vaultChip').addEventListener('click', () => void store.openVaultDialog());
}

/* ───────── toast / modal ───────── */

export function toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast${kind === 'err' ? ' toast--err' : ''}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

export function openModal(html: string): HTMLElement {
  const modal = $('modal');
  const card = $('modalCard');
  card.innerHTML = html;
  modal.hidden = false;
  card.querySelectorAll<HTMLElement>('[data-close]').forEach((el) => {
    el.addEventListener('click', closeModal);
  });
  return card;
}

export function closeModal(): void {
  $('modal').hidden = true;
  $('modalCard').innerHTML = '';
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}
