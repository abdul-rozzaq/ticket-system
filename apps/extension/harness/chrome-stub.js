// Minimal in-memory stand-in for the chrome.* APIs used by the content script.
// ONLY for the local smoke-test harness (pnpm harness); never shipped in dist/.
(function () {
  const store = {};
  const changeListeners = [];
  const msgListeners = [];
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const ks = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of ks) if (k in store) out[k] = clone(store[k]);
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: store[k], newValue: clone(v) };
            store[k] = clone(v);
          }
          setTimeout(() => changeListeners.forEach((l) => l(changes, 'local')), 0);
        },
      },
      onChanged: { addListener: (l) => changeListeners.push(l), removeListener: () => {} },
    },
    runtime: {
      async sendMessage(msg) {
        window.__tpSent = (window.__tpSent || []).concat([msg]);
        return undefined;
      },
      onMessage: { addListener: (l) => msgListeners.push(l), removeListener: () => {} },
      getManifest: () => ({ version: '0.1.0-harness' }),
      getURL: (p) => '/dist/' + p,
    },
  };
  window.__tpStore = store;
})();
