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
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
});
