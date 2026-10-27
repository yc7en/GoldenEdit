import { PluginManager } from '../plugins/manager';

/**
 * 渲染管线：markdown 文本 -> HTML 字符串 -> 注入预览容器 -> 执行 onMount。
 */
export class Pipeline {
  private md: ReturnType<PluginManager['buildMarkdownIt']> | null = null;
  constructor(private manager: PluginManager) {}

  rebuild() {
    this.md = this.manager.buildMarkdownIt();
  }

  render(src: string, previewEl: HTMLElement) {
    if (!this.md) this.rebuild();
    previewEl.innerHTML = this.md!.render(src);
    this.manager.runMounts(previewEl);
  }
}
