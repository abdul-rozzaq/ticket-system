// Typed wrapper around chrome.storage.local. Two keys: settings (UI preferences) and diag (self-test results).
// The server session is stored separately by the background worker (see server/session.ts).
import { defaultFlags } from './features';
import type { DiagState, Settings } from './types';

export const KEYS = { settings: 'tp_settings', diag: 'tp_diag' } as const;

export const defaultSettings = (): Settings => ({
  flags: defaultFlags(),
  panelMode: 'dock',
  uiZoom: 100,
  dock: { x: null, y: 80, w: 360, h: 560, collapsed: false, tab: 'ticket' },
});

export const defaultDiag = (): DiagState => ({ insertWinner: {}, lastInsertReport: null, featureStatus: {} });

export function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  const s = raw ?? {};
  return { ...d, ...s, flags: { ...d.flags, ...(s.flags ?? {}) }, dock: { ...d.dock, ...(s.dock ?? {}) } };
}

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(KEYS.settings);
  return mergeSettings(r[KEYS.settings] as Partial<Settings> | undefined);
}
export async function setSettings(s: Settings) {
  await chrome.storage.local.set({ [KEYS.settings]: s });
}
export async function patchSettings(p: Partial<Settings>) {
  await setSettings({ ...(await getSettings()), ...p });
}

export async function getDiag(): Promise<DiagState> {
  const r = await chrome.storage.local.get(KEYS.diag);
  return { ...defaultDiag(), ...((r[KEYS.diag] ?? {}) as Partial<DiagState>) };
}
export async function patchDiag(p: Partial<DiagState>) {
  await chrome.storage.local.set({ [KEYS.diag]: { ...(await getDiag()), ...p } });
}

export function onStorageChange(cb: (key: string) => void): () => void {
  const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    for (const k of Object.keys(changes)) cb(k);
  };
  chrome.storage.onChanged.addListener(l);
  return () => chrome.storage.onChanged.removeListener(l);
}
