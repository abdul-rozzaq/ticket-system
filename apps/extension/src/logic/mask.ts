// Sensitive-data masking applied to any text before it goes to an AI.
// Order matters: more specific patterns run first so they are not eaten by generic ones.

export interface MaskHit { kind: string; original: string }
export interface MaskResult { text: string; hits: MaskHit[] }

function luhnOk(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const LOCAL_BINS = ['8600', '9860', '5614', '6262'];

interface Rule { kind: string; re: RegExp; replace?: (m: RegExpExecArray) => string | null }

// Keyword families (uz/ru/en) that precede a secret value: "parol: x", "пароль - x", "password=x".
const SECRET_WORDS = String.raw`(?:parol|password|passwd|pwd|pass|пароль|парол|token|токен|secret|секрет|api[_-]?key|apikey|ключ|kalit|login\s*/\s*parol)`;

export const RULES: Rule[] = [
  // https://user:pass@host
  { kind: 'URL_PAROL', re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (m) => `${m[1]}[LOGIN]:[PAROL]@` },
  // Authorization: Bearer xxx
  { kind: 'TOKEN', re: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: (m) => `${m[1]} [TOKEN]` },
  // JWT
  { kind: 'TOKEN', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  // Known key prefixes: OpenAI/Anthropic sk-, GitHub, Slack, AWS, Google, Telegram bot token
  { kind: 'API_KEY', re: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g },
  { kind: 'TOKEN', re: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
  // "parol: abc123", "пароль - qwerty", "token=xyz" (value up to whitespace)
  { kind: 'PAROL', re: new RegExp(String.raw`(${SECRET_WORDS})(\s*[:=\-–—]\s*|\s+)([^\s,;]{3,})`, 'giu'),
    replace: (m) => `${m[1]}${m[2]}[PAROL]` },
  // Card-like numbers 13-19 digits, optionally grouped by space/dash: Luhn-valid, or a 16-digit number
  // with a local BIN (Uzcard 8600, Humo 9860, co-badged 5614/6262) — masked even if Luhn fails, to be safe.
  { kind: 'KARTA', re: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => {
      const d = m[0].replace(/\D/g, '');
      if (d.length < 13 || d.length > 19) return null;
      return luhnOk(d) || (d.length === 16 && LOCAL_BINS.some((b) => d.startsWith(b))) ? '[KARTA]' : null;
    } },
  // Phones: +998 90 123 45 67, 998901234567, +7 (912) 345-67-89, 90 123 45 67
  { kind: 'TELEFON', re: /(?:\+?998|\+7|\b8)[\s-]?\(?\d{2,3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|\b\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}\b/g },
  // Long hex (>=32) — hashes, keys
  { kind: 'HEX', re: /\b[a-f0-9]{32,}\b/gi },
  // Long base64-ish blobs (>=40, must contain a digit and a letter)
  { kind: 'BASE64', re: /(?<![A-Za-z0-9+/=])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g },
];

export function maskSensitive(input: string): MaskResult {
  let text = input;
  const hits: MaskHit[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    text = text.replace(rule.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray; // [match, ...groups]
      const out = rule.replace ? rule.replace(m) : `[${rule.kind}]`;
      if (out == null) return m[0];
      hits.push({ kind: rule.kind, original: m[0] });
      return out;
    });
  }
  return { text, hits };
}
