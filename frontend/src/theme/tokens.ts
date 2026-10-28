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

export const PREVIEW_TOKENS: Record<Mode, Record<string, string>> = {
  light: {
    '--ge-bg': '#fffefb',
    '--ge-bg-subtle': '#f6f5ef',
    '--ge-fg': '#2b2a26',
    '--ge-fg-muted': '#6f6e66',
    '--ge-border': '#e3e2da',
    '--ge-accent': '#a8802f',
    '--ge-accent-fg': '#fffdf6',
    '--ge-code-bg': '#f4f3ec',
    '--ge-code-fg': '#3c3a33',
    '--ge-link': '#8a6a20',
    '--ge-note': '#4a6f8a',
    '--ge-tip': '#4a7c59',
    '--ge-warn': '#a8722a',
    '--ge-danger': '#a8443a',
    '--ge-success': '#4a7c59',
  },
  dark: {
    '--ge-bg': '#1e1e21',
    '--ge-bg-subtle': '#26262b',
    '--ge-fg': '#dcdbd4',
    '--ge-fg-muted': '#9a998f',
    '--ge-border': '#35353b',
    '--ge-accent': '#d3ab55',
    '--ge-accent-fg': '#1b1a17',
    '--ge-code-bg': '#26262b',
    '--ge-code-fg': '#d8d6cc',
    '--ge-link': '#d3ab55',
    '--ge-note': '#7aa3c0',
    '--ge-tip': '#7fae8c',
    '--ge-warn': '#d3a05c',
    '--ge-danger': '#cf7c72',
    '--ge-success': '#7fae8c',
  },
};

export function systemMode(): Mode {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveMode(pref: 'light' | 'dark' | 'system'): Mode {
  return pref === 'system' ? systemMode() : pref;
}

/** Monaco 主题：与编辑器 token 同源，避免两处各写一套颜色。 */
export const EDITOR_THEMES: Record<Mode, { base: string; colors: Record<string, string> }> = {
  dark: {
    base: 'vs-dark',
    colors: {
      'editor.background': '#1c1c1f',
      'editor.foreground': '#d7d6d0',
      'editorLineNumber.foreground': '#5a5a5f',
      'editorLineNumber.activeForeground': '#c9a24a',
      'editor.selectionBackground': '#3a3a44',
      'editor.lineHighlightBackground': '#232327',
      'editorCursor.foreground': '#c9a24a',
      'editorIndentGuide.background1': '#2c2c31',
    },
  },
  light: {
    base: 'vs',
    colors: {
      'editor.background': '#fdfcf9',
      'editor.foreground': '#2b2a26',
      'editorLineNumber.foreground': '#a9a79c',
      'editorLineNumber.activeForeground': '#a8802f',
      'editor.selectionBackground': '#efe6cf',
      'editor.lineHighlightBackground': '#f6f5ee',
      'editorCursor.foreground': '#a8802f',
      'editorIndentGuide.background1': '#e8e7e0',
    },
  },
};
