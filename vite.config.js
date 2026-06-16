import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyIconsPlugin() {
  return {
    name: 'copy-icons',
    closeBundle() {
      const src = path.resolve(__dirname, 'src/icons');
      const dest = path.resolve(__dirname, 'dist/icons');
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    },
  };
}

function splitChunksPlugin() {
  return {
    name: 'split-chunks',
    configResolved(config) {
      const input = config.build?.rollupOptions?.input;
      const isMultiEntry = input && typeof input === 'object' && Object.keys(input).length > 1;
      if (isMultiEntry && config.build.rollupOptions.output) {
        config.build.rollupOptions.output.manualChunks = {
          tabulator: ['tabulator-tables'],
          billboard: ['billboard.js'],
          vendor: ['jszip', 'papaparse'],
          bootstrap: ['bootstrap', '@popperjs/core'],
        };
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  plugins: [
    webExtension({
      additionalInputs: ['crawl-stats.html'],
    }),
    copyIconsPlugin(),
    splitChunksPlugin(),
  ],
  base: '',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
