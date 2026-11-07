/**
 * 围栏代码块高亮（L1 Worker，无 DOM）。
 *
 * P26 起语言注册表与配色分桶抽到 `frontend/shared/highlight.ts`：预览的 Worker 与
 * 主窗口的 Monaco 共用同一份 highlight.js 注册，避免两边对同一个关键词的颜色分叉。
 * 这里只保留 Worker 侧的入口，MarkdownIt 的 `highlight` 钩子签名不变。
 *
 * 高亮产物只有 `.hljs-*` 类名，配色在 plugins.css 的 `--ge-hl-*` 变量里，
 * 所以切换明暗主题只需换变量、不用重解析文档（§6.6）。
 */
export { highlightCode } from '../../shared/highlight';
