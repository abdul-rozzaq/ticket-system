// The UI (shared by the injected dock and the Chrome side panel) talks to Telegram only via a Bridge.
// Dock: direct calls into the content script. Side panel: chrome.tabs.sendMessage to the content script.
import type { ChatInfo, FeatureStatus, ParsedMessage } from '../shared/types';
import type { InsertOptions, InsertResult, StrategyId } from '../telegram/composer';
import type { SelfTestRow } from '../telegram/dom';

export interface HealthEntry { status: FeatureStatus; note: string }

export interface Bridge {
  mode: 'dock' | 'sidepanel';
  getChat(): Promise<ChatInfo | null>;
  subscribeChat(cb: (c: ChatInfo | null) => void): () => void;
  insert(text: string, opts?: InsertOptions): Promise<InsertResult>;
  readMessages(limit: number): Promise<ParsedMessage[]>;
  selfTest(): Promise<SelfTestRow[]>;
  domReport(): Promise<string>;
  testInsert(strategy: StrategyId | 'all'): Promise<InsertResult[]>;
  health(): Promise<Record<string, HealthEntry>>;
  replyToMessage(messageId: string | null): Promise<boolean>;
  copy(text: string): Promise<boolean>;
  navigate(chatId: string): Promise<void>;
}

export const NO_TAB_ERROR = 'Telegram Web yorlig\'i faol emas';
