import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

import { bus, store } from '../store';
import { EDITOR_THEMES, resolveMode, type Mode } from '../theme/tokens';

// Monaco 靠 Worker 做语法分析。Tauri 的 CSP 会拦默认的 blob worker，
// 所以这里用 Vite 打包出的独立 worker 文件（同时 CSP 里也放行了 blob:）。
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const TOKEN_RULES: Record<Mode, monaco.editor.ITokenThemeRule[]> = {
  dark: [
    { token: 'markup.heading', foreground: 'd9b866', fontStyle: 'bold' },
    { token: 'markup.heading.markdown', foreground: 'd9b866', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: 'e5e2d8', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: 'cfcbbf', fontStyle: 'italic' },
    { token: 'markup.quote', foreground: '8f8d84' },
    { token: 'markup.inline', foreground: 'c9a24a' },
    { token: 'string', foreground: '9fbf8f' },
    { token: 'keyword', foreground: 'd3ab55' },
    { token: 'variable', foreground: 'd7d6d0' },
    { token: 'comment', foreground: '6b6b66', fontStyle: 'italic' },
  ],
  light: [
    { token: 'markup.heading', foreground: '8a6a20', fontStyle: 'bold' },
    { token: 'markup.heading.markdown', foreground: '8a6a20', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: '2b2a26', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: '4a4841', fontStyle: 'italic' },
    { token: 'markup.quote', foreground: '7c7a70' },
    { token: 'markup.inline', foreground: 'a8802f' },
    { token: 'string', foreground: '4a7c59' },
    { token: 'keyword', foreground: 'a8802f' },
    { token: 'comment', foreground: '9a988c', fontStyle: 'italic' },
  ],
};

export class EditorHost {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private models = new Map<string, monaco.editor.ITextModel>();
  private themeMode: Mode = 'dark';

  constructor(container: HTMLElement) {
    for (const mode of ['dark', 'light'] as Mode[]) {
      const cfg = EDITOR_THEMES[mode];
      monaco.editor.defineTheme(`golden-${mode}`, {
        base: cfg.base as 'vs' | 'vs-dark',
        inherit: true,
        rules: TOKEN_RULES[mode],
        colors: cfg.colors,
      });
    }

    this.editor = monaco.editor.create(container, {
      theme: 'golden-dark',
      language: 'markdown',
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 21,
      minimap: { enabled: false },
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderLineHighlight: 'line',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 14, bottom: 24 },
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
      contextmenu: true,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      occurrencesHighlight: 'off',
      overviewRulerLanes: 0,
      guides: { indentation: false },
    });

    this.editor.onDidChangeModelContent(() => {
      const text = this.editor.getValue();
      store.updateText(text);
      // 'render' 是「渲染完成」的回执，不能拿来当「文档变了」用：
      // 那样每次渲染完都会再推一次文档，形成无限重渲染（BugFix-261028-0010）
      bus.emit('doc-text');
    });

    this.editor.onDidChangeCursorPosition((e) => {
      store.setCursor(e.position.lineNumber, e.position.column);
    });

    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void store.save().then((ok) => {
        if (ok) store.toast('已保存');
      });
    });

    bus.on('active', () => this.syncModel());
    bus.on('settings', () => this.applyTheme());
  }

  private modelFor(rel: string, text: string): monaco.editor.ITextModel {
    let model = this.models.get(rel);
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(text, 'markdown');
      this.models.set(rel, model);
    }
    return model;
  }

  private syncModel(): void {
    const tab = store.activeTab;
    if (!tab) {
      this.editor.setModel(null);
      return;
    }
    const model = this.modelFor(tab.rel, tab.text);
    if (model.getValue() !== tab.text) model.setValue(tab.text);
    if (this.editor.getModel() !== model) this.editor.setModel(model);
    this.editor.focus();
  }

  /** 外部改动「重载」：把磁盘内容灌回模型，保留撤销栈 */
  refreshFromStore(): void {
    const tab = store.activeTab;
    if (!tab) return;
    const model = this.models.get(tab.rel);
    if (model) model.setValue(tab.text);
  }

  applyTheme(): void {
    this.themeMode = resolveMode(store.settings.theme.editor);
    monaco.editor.setTheme(`golden-${this.themeMode}`);
  }

  revealLine(line: number): void {
    this.syncModel();
    this.editor.revealLineInCenter(line);
    this.editor.setPosition({ lineNumber: line, column: 1 });
    this.editor.focus();
  }

  focus(): void {
    this.editor.focus();
  }

  layout(): void {
    this.editor.layout();
  }

  /** 导出时用同一份文本，不读 DOM */
  activeText(): string {
    return this.editor.getValue();
  }
}
