import type MarkdownIt from 'markdown-it';

/** manifest.json 结构。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  match?: {
    fence?: string[];
    container?: string[];
    delimiter?: { inline?: string; block?: string };
  };
  entry: string;
  style?: string;
  config?: Record<string, ConfigField>;
}

export interface ConfigField {
  type: 'boolean' | 'select' | 'number' | 'string';
  default: unknown;
  options?: string[];
  label?: string;
}

/** 插件注册函数签名：每个插件的 renderer.js 导出 register(md, ctx)。 */
export type PluginRegister = (md: MarkdownIt, ctx: PluginContext) => void;

/** 传给插件的运行时上下文。 */
export interface PluginContext {
  /** 当前插件配置（已与用户设置合并）。 */
  config: Record<string, unknown>;
  /** 预览 DOM 更新后，对匹配节点执行异步挂载。 */
  onMount: (selector: string, fn: (el: HTMLElement, code: string, config: Record<string, unknown>) => void) => void;
  /** 事件总线：文档切换、主题切换。 */
  bus: {
    on: (event: string, fn: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
  };
}

/** 已加载插件的运行时记录。 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  register: PluginRegister;
  enabled: boolean;
}
