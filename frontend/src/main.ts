import './style.css';
import { createEditor } from './editor/setup';
import { PluginManager } from './plugins/manager';
import { Pipeline } from './preview/pipeline';
import { openVault, markDirty } from './vault/tree';
import { renderSettings } from './settings/panel';

const manager = new PluginManager();
const pipeline = new Pipeline(manager);

const editor = createEditor(document.getElementById('editor-mount')!);
const previewEl = document.getElementById('preview-output')!;
const previewPane = document.getElementById('preview-pane')!;

function doRender() {
  pipeline.rebuild();
  pipeline.render(editor.getValue(), previewEl);
}

let timer: number | undefined;
editor.onDidChangeModelContent(() => {
  markDirty();
  clearTimeout(timer);
  timer = window.setTimeout(doRender, 200);
});

// 打开文件事件（来自文件树）
window.addEventListener('ge:open-file', ((e: CustomEvent) => {
  editor.setValue(e.detail.content);
  doRender();
}) as EventListener);

// 设置变化后重建管线
window.addEventListener('ge:settings-changed', doRender);

// 工具栏
document.getElementById('btn-open-vault')!.onclick = openVault;
document.getElementById('btn-layout-split')!.onclick = () => setLayout('split');
document.getElementById('btn-layout-editor')!.onclick = () => setLayout('editor');
document.getElementById('btn-layout-preview')!.onclick = () => setLayout('preview');
document.getElementById('btn-preview-theme')!.onclick = () => {
  previewPane.classList.toggle('dark');
  document.documentElement.dataset.previewTheme = previewPane.classList.contains('dark') ? 'dark' : 'light';
  doRender();
};
document.getElementById('btn-settings')!.onclick = () => {
  renderSettings(manager);
  document.getElementById('settings-panel')!.classList.toggle('hidden');
};

function setLayout(mode: 'split' | 'editor' | 'preview') {
  document.getElementById('editor-pane')!.style.display = mode === 'preview' ? 'none' : 'flex';
  document.getElementById('preview-pane')!.style.display = mode === 'editor' ? 'none' : 'flex';
}

// 初始示例
editor.setValue('# 欢迎使用 GoldenEdit\n\n> [!NOTE] 提示块\n> 这是一个 Obsidian 风格 callout。\n\n```mermaid\ngraph TD; A-->B;\n```\n\n行内代码 `npm install` 与公式 $E=mc^2$。\n\n[TOC]\n\n## 第一章\n正文。');
doRender();
