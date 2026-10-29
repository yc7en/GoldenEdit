import * as api from '../bridge';
import { bus, store } from '../store';
import type { ConfigField, PluginManifest } from '../bridge/types';
import { escapeHtml, toast } from '../ui/shell';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let query = '';

export function mountPluginsPage(): void {
  $('pluginSearch').addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value.trim().toLowerCase();
    render();
  });
  $('btnInstallPlugin').addEventListener('click', () => void install());
  $('btnOpenPluginDir')?.addEventListener('click', () => {
    void api
      .openPluginsDir()
      .then(() => toast('已打开插件目录：改完文件会自动重新加载'))
      .catch((err: Error) => toast(`打开插件目录失败：${err.message}`, 'err'));
  });
  bus.on('plugins', render);
  bus.on('render', renderDiag);
  bus.on('log', renderDiag);
  render();
}

function render(): void {
  const box = $('pluginCards');
  box.innerHTML = '';
  const list = store.plugins.filter((p) => match(p, query));
  $('pluginsSub').textContent = `${store.plugins.length} 个已安装 · ${
    store.settings.plugins.enabled.length
  } 个已启用${query ? ` · 过滤出 ${list.length} 个` : ''}`;
  $('navPluginCount').textContent = String(store.settings.plugins.enabled.length);

  for (const plugin of list) {
    box.appendChild(card(plugin));
  }
  renderDiag();
}

function match(p: PluginManifest, q: string): boolean {
  if (!q) return true;
  const hay = [p.name, p.id, p.description ?? '', ...(p.match.fence ?? []), ...(p.match.container ?? [])]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function card(plugin: PluginManifest): HTMLElement {
  const enabled = store.settings.plugins.enabled.includes(plugin.id);
  const el = document.createElement('div');
  el.className = `card${enabled ? '' : ' is-off'}`;

  const triggers = [
    ...(plugin.match.fence ?? []).map((f) => `\`\`\`${f}`),
    ...(plugin.match.container ?? []).map((c) => `::: ${c}`),
    ...(plugin.match.delimiter ?? []).map((d) => (d === 'inline' ? '$…$' : `$$…$$`)),
  ].slice(0, 4);

  el.innerHTML = `
    <div class="card__top">
      <span class="card__name">${escapeHtml(plugin.name)}</span>
      <span class="card__ver">v${escapeHtml(plugin.version)}</span>
      <span class="card__src">${plugin.source.type === 'builtin' ? '内置' : '本地'}</span>
    </div>
    <div class="card__desc">${escapeHtml(plugin.description ?? '没有描述')}</div>
    <div class="card__tags">
      ${triggers.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      <span class="tag tag--${plugin.capability.toLowerCase()}">${plugin.capability}</span>
    </div>
    <div class="card__foot">
      ${
        Object.keys(plugin.config ?? {}).length
          ? '<button class="card__cfg">配置</button>'
          : '<span></span>'
      }
      ${plugin.source.type === 'local' ? '<button class="card__cfg card__rm">移除</button>' : ''}
      <label class="switch"><input type="checkbox" ${enabled ? 'checked' : ''} /><span></span></label>
    </div>
    <div class="card__form" hidden></div>
  `;

  const toggle = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
  toggle.addEventListener('change', () => {
    void store.togglePlugin(plugin.id, toggle.checked).then(() => {
      toast(`${toggle.checked ? '已启用' : '已停用'} ${plugin.name}，预览已重渲染`);
    });
  });

  const cfgBtn = el.querySelector('.card__cfg:not(.card__rm)') as HTMLButtonElement | null;
  const form = el.querySelector('.card__form') as HTMLElement;
  cfgBtn?.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden && form.childElementCount === 0) buildForm(form, plugin);
  });

  el.querySelector('.card__rm')?.addEventListener('click', () => {
    void (async () => {
      if (!window.confirm(`移除插件 ${plugin.name}？`)) return;
      try {
        await api.removePlugin(plugin.id);
        await store.refreshPlugins();
        toast('已移除');
      } catch (err) {
        toast(`移除失败：${(err as Error).message}`, 'err');
      }
    })();
  });

  return el;
}

function buildForm(form: HTMLElement, plugin: PluginManifest): void {
  const values = store.settings.plugins.config[plugin.id] ?? {};
  for (const [key, field] of Object.entries(plugin.config ?? {})) {
    form.appendChild(fieldRow(plugin, key, field, values[key] ?? field.default));
  }
}

function fieldRow(plugin: PluginManifest, key: string, field: ConfigField, current: unknown): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field';
  const label = `<span class="field__t">${escapeHtml(field.label ?? key)}</span>`;
  if (field.type === 'boolean') {
    row.innerHTML = `${label}<label class="switch"><input type="checkbox" ${
      current ? 'checked' : ''
    } /><span></span></label>`;
    row.querySelector('input')?.addEventListener('change', (e) => {
      void store.setPluginConfig(plugin.id, key, (e.target as HTMLInputElement).checked);
    });
    return row;
  }
  if (field.type === 'select') {
    row.innerHTML = `${label}<select class="select">${(field.options ?? [])
      .map((o) => `<option ${o === current ? 'selected' : ''}>${escapeHtml(o)}</option>`)
      .join('')}</select>`;
    row.querySelector('select')?.addEventListener('change', (e) => {
      void store.setPluginConfig(plugin.id, key, (e.target as HTMLSelectElement).value);
    });
    return row;
  }
  row.innerHTML = `${label}<input class="input" type="${field.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(
    String(current ?? '')
  )}" />`;
  row.querySelector('input')?.addEventListener('change', (e) => {
    const raw = (e.target as HTMLInputElement).value;
    void store.setPluginConfig(plugin.id, key, field.type === 'number' ? Number(raw) : raw);
  });
  return row;
}

function renderDiag(): void {
  const box = $('diagBody');
  const info = store.renderInfo;
  const rows = [
    `<div class="diag__row"><span>块数</span><span>${info.blocks}</span></div>`,
    `<div class="diag__row"><span>耗时</span><span>${info.ms} ms</span></div>`,
    `<div class="diag__row"><span>插件</span><span>${info.plugins}</span></div>`,
  ];
  for (const line of store.logs.slice(-12).reverse()) {
    rows.push(
      `<div class="diag__row${line.level === 'error' ? ' diag__row--err' : ''}"><span>${
        line.level === 'error' ? 'ERR' : 'LOG'
      }</span><span>${escapeHtml(line.message)}</span></div>`
    );
  }
  box.innerHTML = rows.join('');
}

async function install(): Promise<void> {
  const dir = await api.pickFolder();
  if (!dir) return;
  try {
    const plugin = await api.installPlugin(dir);
    await store.refreshPlugins();
    toast(`已安装 ${plugin.name}，可在列表里勾选启用`);
  } catch (err) {
    toast(`安装失败：${(err as Error).message}`, 'err');
  }
}
