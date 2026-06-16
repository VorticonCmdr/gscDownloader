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

export default defineConfig({
  root: 'src',
  plugins: [
    webExtension({
      additionalInputs: ['crawl-stats.html'],
    }),
    copyIconsPlugin(),
  ],
  base: '',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
