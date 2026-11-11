// Domain types shared by content script, background, options and side panel.

export type SystemType = 'AmoCRM' | 'Bitrix24' | 'Online PBX';
export type TicketStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'CLOSED';
export type TgVersion = 'k' | 'a' | 'unknown';
export type ChatKind = 'private' | 'group' | 'channel' | 'forum-topic' | 'unknown';

export interface Staff {
  id: string;
  name: string;
}

export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  system: SystemType;
  /** Real Telegram chat id ("-100123…", "@username", "12345"). Editable in options. */
  telegramChatId: string;
  /** Lowercase substring used as a fallback match against the chat title. */
  titleHint: string;
}

export interface TicketEvent {
  at: string; // ISO
  who: string; // staff id or "client" / "system"
  type: 'created' | 'status' | 'assign' | 'note' | 'first_response' | 'solution' | 'reminder';
  text: string;
}

export interface Ticket {
  id: string;
  clientId: string;
  title: string;
  status: TicketStatus;
  assigneeId: string | null;
  createdAt: string;
  firstResponseAt: string | null;
  slaDeadline: string;
  closedAt: string | null;
  solutionNote: string | null;
  history: TicketEvent[];
  notes: string[];
}

export interface Template {
  id: string;
  category: 'salomlashuv' | 'AmoCRM' | 'Bitrix' | 'PBX' | 'yopish';
  title: string;
  body: string;
  keywords: string[];
}

export interface KbArticle {
  id: string;
  lang: 'uz' | 'ru';
  system: SystemType | 'umumiy';
  problem: string;
  solution: string;
  tags: string[];
}

export interface ChatNote {
  text: string;
  at: string;
  who: string;
}

export interface Reminder {
  id: string;
  chatId: string;
  chatTitle: string;
  at: string; // ISO
  text: string;
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

export interface LlmSettings {
  provider: 'anthropic' | 'openai';
  endpoint: string; // base URL for openai-compatible, ignored for anthropic default
  apiKey: string;
  model: string;
}

export interface Settings {
  me: string; // staff id
  flags: Record<string, boolean>;
  panelMode: 'dock' | 'sidepanel';
  /** Panel content zoom in percent (50-200). Needed because Chrome page zoom does not affect the side panel. */
  uiZoom: number;
  dock: { x: number | null; y: number; w: number; h: number; collapsed: boolean; tab: string };
  llm: LlmSettings;
  approveMaskBeforeAi: boolean;
}

export interface MockState {
  staff: Staff[];
  clients: Client[];
  tickets: Ticket[];
  templates: Template[];
  kb: KbArticle[];
  favourites: string[];
  usage: Record<string, number>;
  chatNotes: Record<string, ChatNote[]>;
  chatTags: Record<string, string[]>;
  reminders: Reminder[];
}

export interface DiagState {
  insertWinner: Partial<Record<TgVersion, string>>;
  lastInsertReport: string | null;
  llmLast: { at: string; ms: number; inputTokens: number | null; outputTokens: number | null; model: string; error: string | null } | null;
  featureStatus: Record<string, FeatureStatus>;
}
