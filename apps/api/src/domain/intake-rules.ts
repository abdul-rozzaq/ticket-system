// Pure intake pre-filter and staff command parser (userbot side).

export type FilterReason = 'EMPTY' | 'EMOJI_ONLY' | 'TOO_SHORT' | 'ACKNOWLEDGEMENT' | 'STAFF_MESSAGE';

const ACKS = new Set(
  [
    // uz
    'rahmat',
    'rahmat katta',
    'katta rahmat',
    'raxmat',
    'ok',
    'okay',
    "xo'p",
    'xop',
    "xo'p bo'ladi",
    'tushunarli',
    'yaxshi',
    "zo'r",
    "bo'ldi",
    'tayyor',
    'salom',
    'assalomu alaykum',
    'assalomu alaykum va rahmatullohi va barakatuh',
    'hayrli kun',
    'hayrli tong',
    // ru
    'спасибо',
    'благодарю',
    'ок',
    'окей',
    'хорошо',
    'понятно',
    'ладно',
    'договорились',
    'отлично',
    'здравствуйте',
    'привет',
    'добрый день',
    // en
    'thanks',
    'thank you',
    'thx',
    'got it',
    'great',
    'cool',
    'hi',
    'hello',
  ].map(normalise),
);

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʻʼ`’‘]/g, "'")
    .replace(/[.!?,;:()"«»\-–—…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMOJI_OR_SPACE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s‍️]+$/u;

export interface PrefilterOptions {
  minChars: number;
  /** Message was sent by our own TP account. */
  fromStaff?: boolean;
  extraStopWords?: string[];
}

/** Returns null if the message may open a ticket (go on to AI), otherwise why it is skipped. */
export function prefilter(text: string | null | undefined, opts: PrefilterOptions): FilterReason | null {
  if (opts.fromStaff) return 'STAFF_MESSAGE';
  const raw = (text ?? '').trim();
  if (!raw) return 'EMPTY';
  if (EMOJI_OR_SPACE.test(raw)) return 'EMOJI_ONLY';
  const n = normalise(raw);
  const stop = new Set((opts.extraStopWords ?? []).map(normalise));
  if (ACKS.has(n) || stop.has(n)) return 'ACKNOWLEDGEMENT';
  // "rahmat 👍" / "ok 🙏": acknowledgement plus emoji
  const withoutEmoji = normalise(raw.replace(/[\p{Extended_Pictographic}\p{Emoji_Component}‍️]/gu, ''));
  if (withoutEmoji && (ACKS.has(withoutEmoji) || stop.has(withoutEmoji))) return 'ACKNOWLEDGEMENT';
  if (withoutEmoji.length < opts.minChars) return 'TOO_SHORT';
  return null;
}

export type CommandName = 'done' | 'wait' | 'note' | 'ai';
export interface ParsedCommand {
  name: CommandName;
  arg: string;
}

/**
 * Staff commands typed in customer chats: `.done [solution]`, `#done`, `.wait`, `.note text`, `.ai`.
 * Must be the first token of the message; a bare ".done" in the middle of a sentence is not a command.
 */
export function parseCommand(text: string | null | undefined): ParsedCommand | null {
  const m = /^[.#](done|wait|note|ai)(?:\s+([\s\S]*))?$/i.exec((text ?? '').trim());
  if (!m) return null;
  return { name: m[1].toLowerCase() as CommandName, arg: (m[2] ?? '').trim() };
}

/** Urgent keywords that skip the debounce and ping the on-duty person immediately (configurable list in settings). */
export const DEFAULT_URGENT_KEYWORDS = [
  "to'xtab qoldi",
  'toxtab qoldi',
  'umuman ishlamayapti',
  'срочно',
  'не работает совсем',
  'urgent',
  'ishlamay qoldi',
];

export function hasUrgentKeyword(text: string, keywords: string[] = DEFAULT_URGENT_KEYWORDS): boolean {
  const n = normalise(text);
  return keywords.some((k) => n.includes(normalise(k)));
}
