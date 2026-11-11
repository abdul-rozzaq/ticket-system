// Typed wrapper around chrome.storage.local. Three top-level keys: settings, mock, diag.
import { defaultFlags } from './features';
import { seedMockState } from '../logic/seed';
import type { DiagState, MockState, Settings } from './types';

export const KEYS = { settings: 'tp_settings', mock: 'tp_mock', diag: 'tp_diag' } as const;

export const defaultSettings = (): Settings => ({
  me: 'ali',
  flags: defaultFlags(),
  panelMode: 'dock',
  uiZoom: 100,
  dock: { x: null, y: 80, w: 360, h: 560, collapsed: false, tab: 'ticket' },
  llm: { provider: 'anthropic', endpoint: 'https://api.anthropic.com', apiKey: '', model: 'claude-opus-5-5' },
  approveMaskBeforeAi: true,
});

export const defaultDiag = (): DiagState => ({ insertWinner: {}, lastInsertReport: null, llmLast: null, featureStatus: {} });

export function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  const d = defaultSettings();
  const s = raw ?? {};
  return { ...d, ...s, flags: { ...d.flags, ...(s.flags ?? {}) }, dock: { ...d.dock, ...(s.dock ?? {}) }, llm: { ...d.llm, ...(s.llm ?? {}) } };
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

export async function getMock(): Promise<MockState> {
  const r = await chrome.storage.local.get(KEYS.mock);
  if (r[KEYS.mock]) return r[KEYS.mock] as MockState;
  const seeded = seedMockState();
  await chrome.storage.local.set({ [KEYS.mock]: seeded });
  return seeded;
}
export async function setMock(m: MockState) {
  await chrome.storage.local.set({ [KEYS.mock]: m });
}
/** Read-modify-write. Not transactional across tabs; acceptable for a 2-3 person prototype. */
export async function updateMock(fn: (m: MockState) => MockState): Promise<MockState> {
  const next = fn(await getMock());
  await setMock(next);
  return next;
}
export async function resetMock() {
  await setMock(seedMockState());
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
