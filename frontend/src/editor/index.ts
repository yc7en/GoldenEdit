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
      // 右键菜单完全由命令表提供（§8.3）：原生菜单是英文、且接不进命令表
      contextmenu: false,
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

    // Ctrl+S 交给命令表（file.save），这里不再单独 addCommand：
    // 两套绑定并存时，改键位只对其中一套生效（§8.4）

    bus.on('active', () => this.syncModel());
    bus.on('settings', () => this.applyTheme());

    // 右键菜单由命令表提供（§8.3）。用 Monaco 的 onContextMenu 而不是裸 DOM，
    // 因为它带得动「右键位置」——先移光标再弹菜单，操作对象才和用户点的那行一致。
    this.editor.onContextMenu((e) => {
      e.event.preventDefault();
      if (e.target.position) this.editor.setPosition(e.target.position);
      this.contextHandler?.({ x: e.event.posx, y: e.event.posy });
    });
  }

  private contextHandler: ((pos: { x: number; y: number }) => void) | null = null;

  setContextMenuHandler(fn: (pos: { x: number; y: number }) => void): void {
    this.contextHandler = fn;
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

  /** 命令系统判上下文用：编辑区是否持有文本焦点（§8.2） */
  hasTextFocus(): boolean {
    return this.editor.hasTextFocus();
  }

  /** 编辑区是否有选区（复制 / 剪切菜单项据此置灰） */
  hasSelection(): boolean {
    const sel = this.editor.getSelection();
    return Boolean(sel && !sel.isEmpty());
  }

  /** 触发 Monaco 内置 action。复制粘贴走这条路，命令系统不自己碰剪贴板（§8.3） */
  trigger(action: string): void {
    this.editor.trigger('goldenedit-command', action, null);
    this.editor.focus();
  }

  layout(): void {
    this.editor.layout();
  }

  /** 导出时用同一份文本，不读 DOM */
  activeText(): string {
    return this.editor.getValue();
  }

  /** 插件命令的受限门面（§5.11）。写操作一律走 executeEdits，保证一个命令一个 undo 单元。 */
  facade(): EditorFacade {
    const editor = this.editor;
    return {
      getText: () => editor.getValue(),
      lineCount: () => editor.getModel()?.getLineCount() ?? 0,
      getLine: (n) => {
        const model = editor.getModel();
        if (!model) return '';
        return model.getLineContent(Math.min(Math.max(1, n), model.getLineCount()));
      },
      getCursorLine: () => editor.getPosition()?.lineNumber ?? 1,
      getSelection: () => {
        const model = editor.getModel();
        const sel = editor.getSelection();
        if (!model || !sel) return { text: '', startLine: 1, endLine: 1, empty: true };
        return {
          text: model.getValueInRange(sel),
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
          empty: sel.isEmpty(),
        };
      },
      replaceLines: (from, to, lines) => {
        const model = editor.getModel();
        if (!model) return;
        const last = model.getLineCount();
        const start = Math.min(Math.max(1, from), last);
        const end = Math.min(Math.max(start, to), last);
        const range = new monaco.Range(start, 1, end, model.getLineMaxColumn(end));
        this.applyEdit(range, lines.join('\n'));
      },
      replaceSelection: (text) => {
        const sel = editor.getSelection();
        if (!sel) return;
        this.applyEdit(sel, text);
      },
      onSelectionChange: (fn) => {
        const sub = editor.onDidChangeCursorSelection(() => fn());
        return () => sub.dispose();
      },
    };
  }

  /** 单次编辑 + 前后撤销停止点：用户按一次 Ctrl+Z 就能整条回退 */
  private applyEdit(range: monaco.Range, text: string): void {
    this.editor.pushUndoStop();
    this.editor.executeEdits('goldenedit-plugin', [{ range, text, forceMoveMarkers: true }]);
    this.editor.pushUndoStop();
  }
}

export interface FacadeSelection {
  text: string;
  startLine: number;
  endLine: number;
  empty: boolean;
}

/**
 * 插件只能看到这一组方法（ARCHITECTURE §5.11）：
 * 没有文件读写、没有 DOM、没有 Monaco 实例本身——否则「插件只能改文本」这条边界形同虚设。
 */
export interface EditorFacade {
  getText(): string;
  lineCount(): number;
  getLine(n: number): string;
  getCursorLine(): number;
  getSelection(): FacadeSelection;
  replaceLines(from: number, to: number, lines: string[]): void;
  replaceSelection(text: string): void;
  onSelectionChange(fn: () => void): () => void;
}
