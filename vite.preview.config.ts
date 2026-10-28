import { defineConfig } from 'vite';

/**
 * 预览外壳（L3）的独立构建。
 * 输出到 dist-preview/，由本地预览服务以 /p/{token}/shell/ 提供服务，
 * 绝不打包进主页面——L3 必须是独立源（ARCHITECTURE §2.1 铁律 3）。
 */
export default defineConfig({
  root: 'frontend/preview-shell',
  base: './',
  clearScreen: false,
  // Worker 里有动态 import（插件 entry.js），必须是 ES 格式
  worker: { format: 'es' },
  build: {
    outDir: '../../dist-preview',
    emptyOutDir: true,
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
