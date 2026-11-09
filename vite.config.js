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

// Vendor chunks for the multi-page build (not the single-entry service worker build).
// Rolldown (Vite 8) only accepts the function form of manualChunks, and unlike the old
// object form it doesn't pull in a package's dependencies, so d3 is matched explicitly.
const CHUNKS = [
  // Bootstrap CSS separately from its JS: the options page only needs the CSS.
  ['bootstrap-css', /[\\/]node_modules[\\/]bootstrap[\\/]dist[\\/]css[\\/]/],
  ['tabulator', /[\\/]node_modules[\\/]tabulator-tables[\\/]/],
  ['billboard', /[\\/]node_modules[\\/](billboard\.js|d3-[^\\/]+|internmap)[\\/]/],
  ['bootstrap', /[\\/]node_modules[\\/](bootstrap|@popperjs[\\/]core)[\\/]/],
  // Shared app code (gsc pipeline, icons, scheduling). Rolldown pulls a group's dependencies
  // into the same chunk, so JSZip + PapaParse (only used via/alongside this code) land here too.
  ['lib', /[\\/]src[\\/]lib[\\/]/],
];

function manualChunks(id) {
  return CHUNKS.find(([, re]) => re.test(id))?.[0];
}

function splitChunksPlugin() {
  return {
    name: 'split-chunks',
    configResolved(config) {
      const opts = config.build?.rolldownOptions ?? config.build?.rollupOptions;
      const input = opts?.input;
      const isMultiEntry = input && typeof input === 'object' && Object.keys(input).length > 1;
      if (isMultiEntry && opts.output) {
        opts.output.manualChunks = manualChunks;
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
    // Chrome supports <link rel="modulepreload"> natively; no polyfill chunk needed.
    modulePreload: { polyfill: false },
  },
});
