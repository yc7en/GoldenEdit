import './style.css';
import { createEditor, monaco } from './editor/setup';
import { PluginManager } from './plugins/manager';
import { Pipeline } from './preview/pipeline';

// Wails 绑定（开发期走 fetch 占位，打包后由 Wails 注入 window.go）
declare global {
  interface Window {
    go?: any;
  }
}

const manager = new PluginManager();
const pipeline = new Pipeline(manager);

const editorDom = document.getElementById('editor-mount')!;
const editor = createEditor(editorDom);
const previewEl = document.getElementById('preview-output')!;

let timer: number | undefined;
editor.onDidChangeModelContent(() => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    pipeline.render(editor.getValue(), previewEl);
  }, 200);
});

// 初始渲染示例
editor.setValue('# 欢迎使用 GoldenEdit\n\n> [!NOTE] 提示块\n> 这是一个 Obsidian 风格 callout。\n\n```mermaid\ngraph TD; A-->B;\n```\n\n行内代码 `npm install` 与公式 $E=mc^2$。');

// 主题切换：预览区独立亮/暗
const previewPane = document.getElementById('preview-pane')!;
document.getElementById('btn-preview-theme')?.addEventListener('click', () => {
  previewPane.classList.toggle('dark');
  document.documentElement.dataset.previewTheme = previewPane.classList.contains('dark') ? 'dark' : 'light';
  manager.applySettings({});
  pipeline.rebuild();
  pipeline.render(editor.getValue(), previewEl);
});

// 布局切换：分栏 / 纯编辑 / 纯预览
const app = document.getElementById('app')!;
document.getElementById('btn-layout-split')?.addEventListener('click', () => setLayout('split'));
document.getElementById('btn-layout-editor')?.addEventListener('click', () => setLayout('editor'));
document.getElementById('btn-layout-preview')?.addEventListener('click', () => setLayout('preview'));
function setLayout(mode: 'split' | 'editor' | 'preview') {
  app.dataset.layout = mode;
  document.getElementById('editor-pane')!.style.display = mode === 'preview' ? 'none' : 'flex';
  document.getElementById('preview-pane')!.style.display = mode === 'editor' ? 'none' : 'flex';
}
