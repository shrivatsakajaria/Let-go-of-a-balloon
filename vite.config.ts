import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), debug: resolve(__dirname, 'debug.html') },
    },
  },
});
