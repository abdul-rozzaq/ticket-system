// Types shared by content script, background, options and side panel. Business data (tickets, clients, templates, KB)
// lives on the server; nothing here stores it locally.

export type TgVersion = 'k' | 'a' | 'unknown';
export type ChatKind = 'private' | 'group' | 'channel' | 'forum-topic' | 'unknown';

/** Shape the template search/variable helpers work with (built from a server template). */
export interface Template {
  id: string;
  category: string;
  title: string;
  body: string;
  keywords: string[];
}

export interface ChatInfo {
  version: TgVersion;
  /** Normalised peer id from URL, e.g. "-1001234567890", "@user", "123456". */
  chatId: string | null;
  topicId: string | null;
  title: string | null;
  kind: ChatKind;
  rawLocation: string;
}

export interface ParsedMessage {
  id: string | null;
  sender: string | null;
  outgoing: boolean;
  text: string;
  time: string | null;
  replyTo: string | null;
}

export type FeatureStatus = 'OK' | 'DEGRADED' | 'FAILED' | 'NOT_TESTED' | 'OFF';

export interface Settings {
  flags: Record<string, boolean>;
  panelMode: 'dock' | 'sidepanel';
  /** Panel content zoom in percent (50-200). Needed because Chrome page zoom does not affect the side panel. */
  uiZoom: number;
  dock: { x: number | null; y: number; w: number; h: number; collapsed: boolean; tab: string };
}

export interface DiagState {
  insertWinner: Partial<Record<TgVersion, string>>;
  lastInsertReport: string | null;
  featureStatus: Record<string, FeatureStatus>;
}
