declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it';
  interface ContainerOptions {
    validate?: (params: string) => boolean;
    render?: (tokens: unknown[], idx: number) => string;
  }
  const plugin: (md: MarkdownIt, name: string, options?: ContainerOptions) => void;
  export default plugin;
}

/** js-yaml 4.x 未随包提供类型；这里只声明 frontmatter 解析用到的最小面 */
declare module 'js-yaml' {
  interface LoadOptions {
    schema?: unknown;
    filename?: string;
    json?: boolean;
    onWarning?: (warning: unknown) => void;
  }
  const jsYaml: {
    load(input: string, options?: LoadOptions): unknown;
    JSON_SCHEMA: unknown;
    DEFAULT_SCHEMA: unknown;
  };
  export default jsYaml;
}
