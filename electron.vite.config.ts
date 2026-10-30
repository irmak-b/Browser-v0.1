import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins:[{name:'bundled-filter-data',generateBundle(){this.emitFile({type:'asset',fileName:'ad-engine.bin',source:readFileSync(resolve('src/main/browser/filter-data/engine.bin'))});}}],
    build: { externalizeDeps:{exclude:['@ghostery/adblocker']}, rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', codeSplitting: false },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { minify: 'oxc', rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
