// Watch-mode build for both Vite configs. True HMR is not possible for MV3 content
// scripts without extra tooling; after a rebuild, press "reload" on chrome://extensions
// (or let the Extensions Reloader of your choice do it) and refresh the Telegram tab.
import { build } from 'vite';

const common = { mode: 'development', build: { watch: {} } };
await build({ ...common, configFile: 'vite.config.ts' });
await build({ ...common, configFile: 'vite.content.config.ts' });
await build({ ...common, configFile: 'vite.background.config.ts' });
console.log('[TP] watching… reload the extension after changes.');
