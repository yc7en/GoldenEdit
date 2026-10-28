import { defineConfig, type Plugin } from 'vite';

/**
 * 预览外壳跑在 `sandbox="allow-scripts"` 的 iframe 里，文档的源是 opaque（null）。
 * Vite 默认给产物插件加 `crossorigin`，浏览器会把这类请求按跨域处理并做 CORS 校验，
 * 校验失败时不会执行脚本 —— 表现就是「外壳白屏、一句报错都没有」。
 * 这里去掉该属性，让资源按普通同源请求加载。
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'ge-strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/g, '');
    },
  };
}

/**
 * 预览外壳（L3）的独立构建。
 * 输出到 dist-preview/，由本地预览服务以 /p/{token}/shell/ 提供服务，
 * 绝不打包进主页面——L3 必须是独立源（ARCHITECTURE §2.1 铁律 3）。
 */
export default defineConfig({
  root: 'frontend/preview-shell',
  base: './',
  clearScreen: false,
  plugins: [stripCrossorigin()],
  // Worker 里有动态 import（插件 entry.js），必须是 ES 格式
  worker: { format: 'es' },
  build: {
    outDir: '../../dist-preview',
    emptyOutDir: false,
    target: 'chrome110',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
