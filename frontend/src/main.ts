import MarkdownIt from 'markdown-it';
import './style.css';

// 最小渲染管线占位：后续替换为 frontend/src/preview/pipeline.ts，
// 并由 plugins/manager.ts 装配各内置插件。
const md = new MarkdownIt({ html: true, linkify: true });

const editor = document.getElementById('editor-input') as HTMLTextAreaElement;
const output = document.getElementById('preview-output') as HTMLDivElement;

function render() {
  output.innerHTML = md.render(editor.value || '');
}

editor.addEventListener('input', render);
render();
