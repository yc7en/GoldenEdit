import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import markdownWorker from 'monaco-editor/esm/vs/basic-languages/markdown/markdown.worker?worker';

;(self as any).MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'markdown') return new markdownWorker();
    return new editorWorker();
  },
};

/** 创建 Monaco 编辑器实例（暗色主题）。 */
export function createEditor(dom: HTMLElement): monaco.editor.IStandaloneCodeEditor {
  monaco.editor.defineTheme('golden-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': '#1e1e1e' },
  });
  return monaco.editor.create(dom, {
    value: '',
    language: 'markdown',
    theme: 'golden-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    fontSize: 14,
    scrollBeyondLastLine: false,
  });
}

export { monaco };
