/**
 * vault 文件树 + 多标签页。
 * 通过 Wails 绑定调 Go 端 fs.Service；开发期无 Wails 时降级为空树。
 */

export interface FileNode {
  name: string;
  path: string;
  dir: boolean;
  files?: FileNode[];
}

interface Tab {
  path: string;
  name: string;
  dirty: boolean;
}

const tabs: Tab[] = [];
let activePath = '';

async function wails() {
  return (window as any).go;
}

export async function openVault() {
  const go = await wails();
  if (!go?.Platform?.PickVaultDir) return;
  const dir = await go.Platform.PickVaultDir();
  if (!dir) return;
  const tree: FileNode = await go.FS.ListVault(dir);
  renderTree(tree);
}

function renderTree(node: FileNode) {
  const el = document.getElementById('vault-tree')!;
  el.innerHTML = '';
  el.appendChild(renderNode(node));
}

function renderNode(node: FileNode): HTMLElement {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'vault-row';
  row.textContent = (node.dir ? '📁 ' : '📄 ') + node.name;
  row.style.paddingLeft = '8px';
  row.style.cursor = 'pointer';
  row.onclick = () => {
    if (!node.dir) openTab(node);
    else row.classList.toggle('open');
  };
  wrap.appendChild(row);
  if (node.dir && node.files) {
    const sub = document.createElement('div');
    sub.style.paddingLeft = '12px';
    node.files.forEach((f) => sub.appendChild(renderNode(f)));
    wrap.appendChild(sub);
  }
  return wrap;
}

async function openTab(node: FileNode) {
  if (!tabs.find((t) => t.path === node.path)) {
    tabs.push({ path: node.path, name: node.name, dirty: false });
  }
  activePath = node.path;
  renderTabs();
  const go = await wails();
  if (go?.FS?.ReadFile) {
    const content = await go.FS.ReadFile(node.path);
    window.dispatchEvent(new CustomEvent('ge:open-file', { detail: { path: node.path, content } }));
  }
}

function renderTabs() {
  const el = document.getElementById('tabs')!;
  el.innerHTML = '';
  tabs.forEach((t) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.path === activePath ? ' active' : '');
    tab.textContent = (t.dirty ? '● ' : '') + t.name;
    tab.onclick = () => { activePath = t.path; renderTabs(); };
    el.appendChild(tab);
  });
}

export function markDirty() {
  const t = tabs.find((x) => x.path === activePath);
  if (t) { t.dirty = true; renderTabs(); }
}

export function currentPath() { return activePath; }
