import { defineConfig } from 'vite';

// Build 2/3: content script as one self-contained IIFE (no chunk imports).
export default defineConfig(({ mode }) => ({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    lib: {
      entry: 'src/content/index.tsx',
      formats: ['iife'],
      name: 'TPContent',
      fileName: () => 'content.js',
    },
  },
}));
