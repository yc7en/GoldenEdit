import { openKeysDialog } from '../commands/keysDialog';
import { bus, store } from '../store';
import { escapeHtml } from '../ui/shell';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export function mountSettingsPage(): void {
  $('themePresets').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.seg') as HTMLElement | null;
    if (!btn?.dataset.preset) return;
    const preset = btn.dataset.preset;
    const map: Record<string, { editor: 'dark' | 'light' | 'system'; preview: 'light' | 'dark' | 'system' }> = {
      system: { editor: 'system', preview: 'system' },
      writing: { editor: 'dark', preview: 'light' },
      light: { editor: 'light', preview: 'light' },
      dark: { editor: 'dark', preview: 'dark' },
    };
    const theme = { preset: preset as 'system' | 'writing' | 'light' | 'dark', ...map[preset] };
    void store.setSettingsPatch({ theme });
  });

  $('editorTheme').addEventListener('change', (e) => {
    void store.setTheme({ editor: (e.target as HTMLSelectElement).value as 'dark' | 'light' | 'system' });
  });
  $('previewTheme').addEventListener('change', (e) => {
    void store.setTheme({ preview: (e.target as HTMLSelectElement).value as 'light' | 'dark' | 'system' });
  });
  $('syncScroll').addEventListener('change', (e) => {
    void store.setSettingsPatch({ preview: { syncScroll: (e.target as HTMLInputElement).checked } });
  });

  const cssBox = $('customCss') as unknown as HTMLTextAreaElement;
  $('customCssSave').addEventListener('click', () => {
    void store
      .setSettingsPatch({ preview: { customCss: cssBox.value } })
      .then(() => store.toast(cssBox.value.trim() ? '预览样式已应用' : '已清除自定义样式'));
  });
  $('customCssClear').addEventListener('click', () => {
    cssBox.value = '';
    void store.setSettingsPatch({ preview: { customCss: '' } }).then(() => store.toast('已清除自定义样式'));
  });

  $('btnOpenKeys').addEventListener('click', () => openKeysDialog());

  bus.on('settings', render);
  render();
}

function render(): void {
  const theme = store.settings.theme;
  document.querySelectorAll('#themePresets .seg').forEach((el) => {
    el.classList.toggle('seg--on', (el as HTMLElement).dataset.preset === theme.preset);
  });
  ($('editorTheme') as HTMLSelectElement).value = theme.editor;
  ($('previewTheme') as HTMLSelectElement).value = theme.preview;
  ($('syncScroll') as HTMLInputElement).checked = store.settings.preview.syncScroll;
  const cssBox = $('customCss') as unknown as HTMLTextAreaElement;
  // 正在输入时不要把用户打的字覆盖掉
  if (document.activeElement !== cssBox) cssBox.value = store.settings.preview.customCss ?? '';
  $('dataPaths').innerHTML =
    `<div>应用数据：${escapeHtml(store.dataDir || '—')}</div>` +
    `<div>工作区：${escapeHtml(store.vault?.root ?? '未打开')}</div>`;
}
