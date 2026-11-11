// "DOM hisobotini nusxalash": one plain-text report for fixing selectors remotely.
// Message text and names are redacted; structure, classes and data-* attributes are kept.
import type { TgVersion } from '../shared/types';
import { detectVersion, q, selfTest } from './dom';
import { readChat } from './chat';
import { readMessages } from './messages';

const MAX = 3000;
const REDACT_ATTRS = ['title', 'alt', 'aria-label', 'placeholder', 'data-text', 'href', 'src', 'srcset', 'style', 'data-entity-text'];

/** Clone an element, redact all text and sensitive attributes, drop media blobs, trim. */
export function redactedOuterHTML(el: Element | null, max = MAX): string {
  if (!el) return '(topilmadi)';
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[data-tp], script, svg, canvas, video, audio').forEach((n) => {
    if (n.tagName.toLowerCase() === 'svg') n.replaceChildren();
    else n.remove();
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const len = (t.data ?? '').trim().length;
    t.data = len ? `[${len}]` : '';
  }
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const a of REDACT_ATTRS) {
      const v = node.getAttribute(a);
      if (v == null) continue;
      if (a === 'href' && /^#-?\d+|^#@/.test(v)) node.setAttribute(a, v.replace(/\d(?=\d{3})/g, '•')); // keep shape
      else node.setAttribute(a, '…');
    }
  }
  const html = clone.outerHTML.replace(/\s{2,}/g, ' ');
  return html.length > max ? `${html.slice(0, max)}…[+${html.length - max} belgi]` : html;
}

export function buildDomReport(extra: { insertReport?: string | null; extVersion?: string } = {}): string {
  const version: TgVersion = detectVersion();
  const chat = readChat(version);
  const lines: string[] = [];
  lines.push('=== TP Assistant DOM hisoboti ===');
  lines.push(`vaqt: ${new Date().toISOString()}`);
  lines.push(`kengaytma: ${extra.extVersion ?? '?'}`);
  lines.push(`telegram: /${version}/  path=${location.pathname}  hash=${location.hash.replace(/\d(?=\d{3})/g, '•')}`);
  lines.push(`brauzer: ${navigator.userAgent}`);
  lines.push(`ekran: ${innerWidth}x${innerHeight} dpr=${devicePixelRatio}  til=${document.documentElement.lang || navigator.language}`);
  lines.push(`html.class="${document.documentElement.className}" body.class="${document.body.className}"`);
  lines.push(`chat: kind=${chat.kind} idLen=${chat.chatId?.length ?? 0} topic=${chat.topicId ?? '-'} titleFound=${!!chat.title}`);
  lines.push('');
  lines.push('--- selektorlar ---');
  for (const r of selfTest(version)) {
    lines.push(`${r.state.padEnd(9)} ${r.key.padEnd(18)} n=${r.count} ${r.selector ?? ''}${r.note ? `  (${r.note})` : ''}`);
  }
  const msgs = readMessages(10, version);
  lines.push('');
  lines.push(`--- F7 xabarlar: ${msgs.length} ta o'qildi (matnsiz) ---`);
  for (const m of msgs) {
    lines.push(`id=${m.id ?? '?'} out=${m.outgoing} sender=${m.sender ? 'bor' : 'yo\'q'} time=${m.time ?? '?'} len=${m.text.length} reply=${!!m.replyTo}`);
  }
  if (extra.insertReport) {
    lines.push('');
    lines.push('--- F6 oxirgi test ---');
    lines.push(extra.insertReport);
  }
  const bubbles = Array.from(document.querySelectorAll(version === 'a' ? '.Message, [data-message-id]' : '.bubble'));
  const sections: [string, Element | null][] = [
    ['composer', q('composer', document, version)],
    ['composerWrapper', q('composerWrapper', document, version)],
    ['chatHeader', q('chatHeader', document, version)],
    ['messageBubble (oxirgi kiruvchi)', bubbles.reverse().find((b) => !b.matches('.is-out, .own')) ?? q('messageBubble', document, version)],
    ['chatListItem', q('chatListItem', document, version)],
  ];
  for (const [name, el] of sections) {
    lines.push('');
    lines.push(`--- ${name} outerHTML ---`);
    lines.push(redactedOuterHTML(el));
  }
  return lines.join('\n');
}
