import { defineConfig } from 'vite';

// Build 1/3: extension pages (options, side panel).
// The content script is built separately as a single IIFE (see vite.content.config.ts; background: vite.background.config.ts),
// because MV3 content scripts cannot be ES modules and must not import shared chunks.
export default defineConfig(({ mode }) => ({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    rollupOptions: {
      input: {
        options: 'options.html',
        sidepanel: 'sidepanel.html',
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
}));
