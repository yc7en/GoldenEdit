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
 * 预览主题：与编辑区同源，都取 VS Code 扩展 `teabyii.ayu` 的 Ayu Light / Ayu Dark。
 * 语义色不是随手挑的浅深两版，而是 Ayu 自己的角色色：
 * 强调=accent 橙、链接/信息=blue、提示=teal、成功/字符串=green、警告=yellow、错误=red。
 */
export const PREVIEW_TOKENS: Record<Mode, Record<string, string>> = {
  light: {
    '--ge-bg': '#fcfcfc',
    '--ge-bg-subtle': '#f0f1f3',
    '--ge-fg': '#5c6166',
    '--ge-fg-muted': '#8a9199',
    '--ge-border': '#e7eaed',
    '--ge-accent': '#ff9940',
    '--ge-accent-fg': '#ffffff',
    '--ge-code-bg': '#f0f1f3',
    '--ge-code-fg': '#40464c',
    '--ge-link': '#399ee6',
    '--ge-note': '#399ee6',
    '--ge-tip': '#4cbf99',
    '--ge-warn': '#fa8d3e',
    '--ge-danger': '#e65050',
    '--ge-success': '#6cbf43',
  },
  dark: {
    '--ge-bg': '#10141c',
    '--ge-bg-subtle': '#161a24',
    '--ge-fg': '#bfbdb6',
    '--ge-fg-muted': '#626a73',
    '--ge-border': '#1b1f29',
    '--ge-accent': '#e6b450',
    '--ge-accent-fg': '#10141c',
    '--ge-code-bg': '#161a24',
    '--ge-code-fg': '#bfbdb6',
    '--ge-link': '#59c2ff',
    '--ge-note': '#59c2ff',
    '--ge-tip': '#95e6cb',
    '--ge-warn': '#ffb454',
    '--ge-danger': '#f07178',
    '--ge-success': '#aad94c',
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
