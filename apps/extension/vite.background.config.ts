import { defineConfig } from 'vite';

// Build 3/3: background service worker as ONE ES module file. MV3 service workers forbid
// dynamic import(), and the Anthropic SDK contains lazy imports, so everything is inlined.
export default defineConfig(({ mode }) => ({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    lib: { entry: 'src/background/index.ts', formats: ['es'], fileName: () => 'background.js' },
    rollupOptions: { output: { codeSplitting: false } as Record<string, unknown> },
  },
}));
