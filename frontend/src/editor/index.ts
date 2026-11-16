import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

import { highlightRanges } from '../../shared/highlight';
import { bus, store } from '../store';
import { EDITOR_THEMES, resolveMode, type Mode } from '../theme/tokens';
import { findFences, rangeToMonaco } from './fences';
import { BASE_FONT_SIZE, lineHeightFor } from './metrics';

/** 与 settings.rs / store.ts 的默认值保持一致；用户可在设置页改成任意 CSS 字体栈 */
export const DEFAULT_FONT_FAMILY = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace";

// Monaco 靠 Worker 做语法分析。Tauri 的 CSP 会拦默认的 blob worker，
// 所以这里用 Vite 打包出的独立 worker 文件（同时 CSP 里也放行了 blob:）。
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

/**
 * Monaco 的 Markdown token 带 `.md` 后缀（monarch 的 tokenPostfix），且只产出
 * `keyword` / `strong` / `emphasis` / `variable` / `string.link` 这类简化名，
 * 不是 TextMate 的 `markup.*` scope —— 写 `markup.heading` 在这套 tokenizer 里
 * 永远匹配不上。这里后缀写全，同时避免污染围栏里嵌入语言的同名 token。
 */
const TOKEN_RULES: Record<Mode, monaco.editor.ITokenThemeRule[]> = {
  dark: [
    // 标题、列表符号、表格分隔行共用 keyword.md，无法再细分
    { token: 'keyword.md', foreground: 'aad94c', fontStyle: 'bold' },
    { token: 'strong.md', foreground: 'f07178', fontStyle: 'bold' },
    { token: 'emphasis.md', foreground: 'f07178', fontStyle: 'italic' },
    { token: 'variable.md', foreground: 'f29668' },
    { token: 'string.link.md', foreground: '39bae6' },
    { token: 'string.target.md', foreground: '39bae6' },
    { token: 'comment.md', foreground: '95e6cb', fontStyle: 'italic' },
    { token: 'comment.content.md', foreground: '5a6673', fontStyle: 'italic' },
    { token: 'string.md', foreground: '95e6cb' },
    { token: 'variable.source.md', foreground: 'bfbdb6' },
    { token: 'keyword.table.header.md', foreground: '39bae6' },
    { token: 'keyword.table.left.md', foreground: '5a6673' },
    { token: 'keyword.table.middle.md', foreground: '5a6673' },
    { token: 'keyword.table.right.md', foreground: '5a6673' },
    { token: 'meta.separator.md', foreground: '5a6673' },
    { token: 'tag.md', foreground: '39bae6' },
    { token: 'attribute.name.html.md', foreground: 'ffb454' },
    { token: 'string.html.md', foreground: 'aad94c' },
    { token: 'string.escape.md', foreground: '95e6cb' },
  ],
  light: [
    { token: 'keyword.md', foreground: '86b300', fontStyle: 'bold' },
    { token: 'strong.md', foreground: 'f07171', fontStyle: 'bold' },
    { token: 'emphasis.md', foreground: 'f07171', fontStyle: 'italic' },
    { token: 'variable.md', foreground: 'f2a191' },
    { token: 'string.link.md', foreground: '55b4d4' },
    { token: 'string.target.md', foreground: '55b4d4' },
    { token: 'comment.md', foreground: '4cbf99', fontStyle: 'italic' },
    { token: 'comment.content.md', foreground: 'adaeb1', fontStyle: 'italic' },
    { token: 'string.md', foreground: '4cbf99' },
    { token: 'variable.source.md', foreground: '5c6166' },
    { token: 'keyword.table.header.md', foreground: '55b4d4' },
    { token: 'keyword.table.left.md', foreground: 'adaeb1' },
    { token: 'keyword.table.middle.md', foreground: 'adaeb1' },
    { token: 'keyword.table.right.md', foreground: 'adaeb1' },
    { token: 'meta.separator.md', foreground: 'adaeb1' },
    { token: 'tag.md', foreground: '55b4d4' },
    { token: 'attribute.name.html.md', foreground: 'eba400' },
    { token: 'string.html.md', foreground: '86b300' },
    { token: 'string.escape.md', foreground: '4cbf99' },
  ],
};

/** 围栏高亮只算视口 ± 这么多行：大文档下成本与窗口大小成正比，不与文档长度成正比 */
const HIGHLIGHT_MARGIN_LINES = 80;

export class EditorHost {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private models = new Map<string, monaco.editor.ITextModel>();
  private themeMode: Mode = 'dark';
  private hlDecorations: monaco.editor.IEditorDecorationsCollection;
  private hlTimer: ReturnType<typeof setTimeout> | null = null;

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
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: BASE_FONT_SIZE,
      // 行高必须由字号算出来：Monaco 的 lineHeight 是绝对值，写死会在放大后挤行
      lineHeight: lineHeightFor(BASE_FONT_SIZE),
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
      // 中文写作里全角标点是正文，不是"可疑字符"。Monaco 的兜底表 `_default`
      // 却把 ，；？！： 全列为「易与 ASCII 混淆」，原因见 BugFix-261116-0002：
      // 独立包拿到的 locale 是 `zh-CN` / `en`，而它的语言表只认 `zh-hans`，
      // 对不上就回落到兜底表。显式指定后按中文规则判定——真正的易混字符
      // （西里尔 а 冒充拉丁 a）与不可见字符仍会提示。
      unicodeHighlight: { allowedLocales: { 'zh-hans': true } },
    });

    this.hlDecorations = this.editor.createDecorationsCollection();

    this.editor.onDidChangeModelContent(() => {
      const text = this.editor.getValue();
      store.updateText(text);
      // 'render' 是「渲染完成」的回执，不能拿来当「文档变了」用：
      // 那样每次渲染完都会再推一次文档，形成无限重渲染（BugFix-261028-0010）
      bus.emit('doc-text');
      this.scheduleHighlight();
    });

    this.editor.onDidChangeCursorPosition((e) => {
      store.setCursor(e.position.lineNumber, e.position.column);
    });

    // Ctrl+S 交给命令表（file.save），这里不再单独 addCommand：
    // 两套绑定并存时，改键位只对其中一套生效（§8.4）

    // 高亮装饰只覆盖视口附近，滚动后要补算新进入的围栏（防抖在 scheduleHighlight）
    this.editor.onDidScrollChange(() => this.scheduleHighlight(120));

    bus.on('active', () => {
      this.syncModel();
      this.scheduleHighlight(0);
    });
    bus.on('settings', () => this.applyTheme());
    this.scheduleHighlight(0);

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
    this.scheduleHighlight(0);
  }

  /**
   * 编辑区的围栏关键词高亮（§6.6，P26）。
   *
   * 与预览共用 `shared/highlight.ts` 的语言注册与配色分桶；这里不做 HTML，
   * 而是把 token 的字符偏移量换成 Monaco 行列，用 `inlineClassName` 装饰上色。
   * 不用 Monaco 自带的 `rules` 改颜色：那是 Markdown 主题的分词器，改了会连带
   * 影响标题、粗体等所有 markup token，且无法保证与预览的 hljs 分类一致。
   */
  private scheduleHighlight(delay = 180): void {
    if (this.hlTimer !== null) clearTimeout(this.hlTimer);
    this.hlTimer = setTimeout(() => {
      this.hlTimer = null;
      this.refreshHighlight();
    }, delay);
  }

  private refreshHighlight(): void {
    const model = this.editor.getModel();
    if (!model) {
      this.hlDecorations.set([]);
      return;
    }
    const lines = model.getLinesContent();
    const fences = findFences(lines);
    if (!fences.length) {
      this.hlDecorations.set([]);
      return;
    }
    const visible = this.editor.getVisibleRanges();
    const from = visible.length
      ? Math.max(1, visible[0].startLineNumber - HIGHLIGHT_MARGIN_LINES)
      : 1;
    const to = visible.length
      ? Math.min(lines.length, visible[visible.length - 1].endLineNumber + HIGHLIGHT_MARGIN_LINES)
      : Math.min(lines.length, 200);

    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const fence of fences) {
      if (fence.closeLine < from || fence.openLine > to) continue;
      const ranges = highlightRanges(fence.lines.join('\n'), fence.lang);
      for (const r of ranges) {
        const span = rangeToMonaco(fence, r.start, r.end);
        decorations.push({
          range: new monaco.Range(
            span.startLineNumber,
            span.startColumn,
            span.endLineNumber,
            span.endColumn
          ),
          options: { inlineClassName: `ge-hl-${r.bucket}` },
        });
      }
    }
    this.hlDecorations.set(decorations);
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

  /**
   * 编辑器字号（§8.1 区域缩放）。行高随字号一起更新——Monaco 的 `lineHeight`
   * 是绝对像素值，只改 `fontSize` 会让字号超过行高后上下行挤在一起。
   * Monaco 自己处理布局失效，不用手动 layout。
   */
  setFontSize(size: number): void {
    const clamped = Math.min(28, Math.max(10, Math.round(size)));
    const lineHeight = lineHeightFor(clamped);
    const same =
      clamped === this.editor.getOption(monaco.editor.EditorOption.fontSize) &&
      lineHeight === this.editor.getOption(monaco.editor.EditorOption.lineHeight);
    if (same) return;
    this.editor.updateOptions({ fontSize: clamped, lineHeight });
  }

  fontSize(): number {
    return this.editor.getOption(monaco.editor.EditorOption.fontSize);
  }

  /** 编辑区字体栈（P25）：直接把 CSS font-family 字符串交给 Monaco，空值回落到默认 */
  setFontFamily(family: string): void {
    const value = family.trim() || DEFAULT_FONT_FAMILY;
    if (value === this.editor.getOption(monaco.editor.EditorOption.fontFamily)) return;
    this.editor.updateOptions({ fontFamily: value });
  }

  /**
   * 同步滚动（预览 → 编辑，§6.5）：只挪视口，不动光标、不抢焦点——
   * `revealLine` 会 focus 并打断输入，不能用于「跟着预览滚」。
   */
  scrollToLine(line: number): void {
    const model = this.editor.getModel();
    if (!model) return;
    const target = Math.min(Math.max(1, line), model.getLineCount());
    const top = this.editor.getTopForLineNumber(target);
    this.editor.setScrollTop(Math.max(0, top - this.editor.getOption(monaco.editor.EditorOption.lineHeight)));
  }

  /** 订阅编辑器滚动（编辑 → 预览方向用）。节流由调用方负责 */
  onDidScroll(handler: () => void): monaco.IDisposable {
    return this.editor.onDidScrollChange((e) => {
      // 只有纵向滚动才上报；横向滚动与因内容改写引起的 scrollTop 校正都跳过
      if (e.scrollTopChanged) handler();
    });
  }

  /** 首个可见行的行号（同步滚动的映射源，§6.5） */
  firstVisibleLine(): number {
    const range = this.editor.getVisibleRanges()[0];
    return range?.startLineNumber ?? 1;
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
