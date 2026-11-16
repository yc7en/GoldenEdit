/**
 * 主题 token（ARCHITECTURE §7）。
 * 预览侧只做 setProperty，不加载样式表变量文件；插件全部消费 --ge-* 变量。
 */

export type Mode = 'light' | 'dark';

export interface ThemePreset {
  editor: 'dark' | 'light' | 'system';
  preview: 'light' | 'dark' | 'system';
}

export const PRESETS: Record<string, ThemePreset> = {
  system: { editor: 'system', preview: 'system' },
  writing: { editor: 'dark', preview: 'light' },
  light: { editor: 'light', preview: 'light' },
  dark: { editor: 'dark', preview: 'dark' },
};

/**
 * 预览主题：取自 VS Code 扩展 `leo.markdown-extended-preview` 的预览配色接管
 * （media/preview.css §6 的 mdext-scheme-light / mdext-scheme-dark）。
 *
 * 那套色板本身就是 VS Code 默认工作台色：浅色 #ffffff/#1f1f1f，深色
 * #1e1e1e/#d4d4d4，链接走 --vscode-textLink-foreground，提示框走扩展自己的
 * admonition 调色板。所以预览区不再跟随编辑区的 Ayu，两处本来就是分离的：
 * 编辑区是写的地方，预览是读的地方，各有各的观感。
 *
 * `--ge-hl-*` 不在这里：代码块语法高亮仍与编辑区同源（ARCHITECTURE §7 要求
 * 同一个关键词两侧颜色恒等），只换界面色不换语法色。
 */
export const PREVIEW_TOKENS: Record<Mode, Record<string, string>> = {
  light: {
    '--ge-bg': '#ffffff',
    '--ge-bg-subtle': '#f3f3f3',
    '--ge-fg': '#1f1f1f',
    '--ge-fg-muted': '#6b6b6b',
    '--ge-border': '#e4e4e4',
    '--ge-accent': '#0969da',
    '--ge-accent-fg': '#ffffff',
    '--ge-code-bg': '#f3f3f3',
    '--ge-code-fg': '#1f1f1f',
    '--ge-link': '#0969da',
    '--ge-note': '#3b82f6',
    '--ge-tip': '#14b8a6',
    '--ge-warn': '#f59e0b',
    '--ge-danger': '#cd3131',
    '--ge-success': '#388a34',
  },
  dark: {
    '--ge-bg': '#1e1e1e',
    '--ge-bg-subtle': '#252526',
    '--ge-fg': '#d4d4d4',
    '--ge-fg-muted': '#9d9d9d',
    '--ge-border': '#3c3c3c',
    '--ge-accent': '#4daafc',
    '--ge-accent-fg': '#1e1e1e',
    '--ge-code-bg': '#252526',
    '--ge-code-fg': '#d4d4d4',
    '--ge-link': '#4daafc',
    '--ge-note': '#3b82f6',
    '--ge-tip': '#14b8a6',
    '--ge-warn': '#f59e0b',
    '--ge-danger': '#f48771',
    '--ge-success': '#73c991',
  },
};

export function systemMode(): Mode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveMode(pref: 'light' | 'dark' | 'system'): Mode {
  return pref === 'system' ? systemMode() : pref;
}

/**
 * Monaco 主题：配色取自 VS Code 的 Ayu Dark / Ayu Light（扩展 `teabyii.ayu`）。
 * 主题文件里的前景色多为 8 位带 alpha 的写法，这里已按编辑器背景合成成不透明值，
 * 避免 WebView 在叠色时与 VS Code 观感不一致。
 */
export const EDITOR_THEMES: Record<Mode, { base: string; colors: Record<string, string> }> = {
  dark: {
    base: 'vs-dark',
    colors: {
      'editor.background': '#10141c',
      'editor.foreground': '#bfbdb6',
      'editorLineNumber.foreground': '#41495a',
      'editorLineNumber.activeForeground': '#5c657b',
      'editor.selectionBackground': '#193155',
      'editor.inactiveSelectionBackground': '#172336',
      'editor.lineHighlightBackground': '#161a24',
      'editorCursor.foreground': '#e6b450',
      // Ayu 用 c4d6fe 的极低透明度画缩进线，合成后接近下面这组
      'editorIndentGuide.background1': '#1b1f29',
      'editorIndentGuide.activeBackground1': '#2e3542',
      'editorWhitespace.foreground': '#41495a',
      'editorWidget.background': '#141821',
      'editorWidget.border': '#1b1f29',
      'editorBracketMatch.background': '#272c38',
      'editorBracketMatch.border': '#272c38',
      'editor.findMatchBackground': '#4c4126',
      'editor.findMatchHighlightBackground': '#2e2b21',
      'editor.selectionHighlightBackground': '#1e2d25',
      'scrollbarSlider.background': '#2e3542',
      'scrollbarSlider.hoverBackground': '#3a4356',
    },
  },
  light: {
    base: 'vs',
    colors: {
      'editor.background': '#fcfcfc',
      'editor.foreground': '#5c6166',
      'editorLineNumber.foreground': '#ccd1d7',
      'editorLineNumber.activeForeground': '#9ca5b2',
      'editor.selectionBackground': '#d7e4f6',
      'editor.inactiveSelectionBackground': '#e6eef8',
      'editor.lineHighlightBackground': '#f0f1f3',
      'editorCursor.foreground': '#f29718',
      'editorIndentGuide.background1': '#eaedef',
      'editorIndentGuide.activeBackground1': '#d8dbe0',
      'editorWhitespace.foreground': '#ccd1d7',
      'editorWidget.background': '#fafafa',
      'editorWidget.border': '#eaedef',
      'editorBracketMatch.background': '#d8dbe0',
      'editorBracketMatch.border': '#d8dbe0',
      'editor.findMatchBackground': '#ffe294',
      'editor.findMatchHighlightBackground': '#feefc8',
      'editor.selectionHighlightBackground': '#e7f3e0',
      'scrollbarSlider.background': '#ccd1d7',
      'scrollbarSlider.hoverBackground': '#c2c8d0',
    },
  },
};
