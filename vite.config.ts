import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./frontend/src', import.meta.url));

export default defineConfig({
  root: 'frontend',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/dist-preview/**'] },
  },
  resolve: { alias: { '@': src } },
  build: {
    outDir: '../dist',
    // 输出目录由 `npm run clean` 清理；vite 自带的 emptyOutDir 会一次性批量删除，
    // 在部分受管环境下会被安全策略拦截（本项目遇到过），因此关掉它
    emptyOutDir: false,
    target: 'chrome110',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
});
