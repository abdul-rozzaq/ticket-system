import { describe, expect, it } from 'vitest';
import {
  chunkText,
  draftOutcome,
  detectLang,
  isRelevant,
  matchStats,
  queryStems,
  squash,
  textSimilarity,
} from '../src/text-utils';

describe('queryStems', () => {
  it('lowercases, folds apostrophes, drops stop words/numbers/short words, cuts to 5 chars, dedupes', () => {
    expect(queryStems('Assalomu alaykum! Webhook ulanmadi, lidlar tushmayapti 123')).toEqual([
      'webho',
      'ulanm',
      'lidla',
      'tushm',
    ]);
    expect(queryStems("qo'ng'iroq yozuvlari yo'q")).toEqual(['qongi', 'yozuv']);
    expect(queryStems('нет записей звонков, спасибо')).toEqual(['запис', 'звонк']);
    expect(queryStems('webhook webhookni WEBHOOKLAR')).toEqual(['webho']);
  });
  it('ignores mask placeholders and caps the length', () => {
    expect(queryStems('parol: [PAROL] sip registratsiya')).toEqual(['parol', 'sip', 'regis']);
    expect(
      queryStems(
        Array.from({ length: 50 }, (_, i) => `soz${String.fromCharCode(97 + (i % 26))}${i}x`).join(' '),
        5,
      ),
    ).toHaveLength(5);
    expect(queryStems('')).toEqual([]);
  });
});

describe('detectLang', () => {
  it('tells russian from uzbek', () => {
    expect(detectLang('Не работает вебхук')).toBe('ru');
    expect(detectLang('Webhook ulanmadi, lidlar tushmayapti')).toBe('uz');
    expect(detectLang('123 !!!')).toBe('uz');
  });
});

describe('relevance guard', () => {
  const stems = ['webho', 'ulanm', 'lidla', 'tushm'];
  it('needs 2+ matches for 3+ stems (one common word is not enough)', () => {
    expect(isRelevant(matchStats(stems, 'Webhook ulanmadi lidlar tushmayapti'), 4)).toBe(true);
    expect(isRelevant(matchStats(stems, 'webhook sozlamalari'), 4)).toBe(false); // 1 of 4
    expect(isRelevant(matchStats(stems, 'webhook ulanmadi'), 4)).toBe(true); // 2 of 4
  });
  it('a single content word is never enough; two words must both match', () => {
    expect(isRelevant(matchStats(['ishla'], 'telefon ishlamayapti'), 1)).toBe(false);
    expect(isRelevant(matchStats(['sip', 'regis'], 'SIP registratsiya'), 2)).toBe(true);
    expect(isRelevant(matchStats(['sip', 'regis'], 'SIP telefon'), 2)).toBe(false);
    expect(isRelevant({ matched: 0, ratio: 0 }, 0)).toBe(false);
  });
});

describe('chunkText', () => {
  it('keeps short text in one chunk and trims', () => {
    expect(chunkText('  Salom.  ')).toEqual(['Salom.']);
    expect(chunkText('')).toEqual([]);
  });
  it('splits long text on sentence boundaries, never exceeding the max, covering all content', () => {
    const sentence = 'Bu muhim jumla va u hal qilish usulini tushuntiradi.';
    const text = Array.from({ length: 40 }, () => sentence).join(' ');
    const chunks = chunkText(text, 300, 40);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
    expect(chunks.join(' ')).toContain('hal qilish usulini');
    // overlap: each chunk after the first starts with material from the previous one
    expect(chunks[1].slice(0, 15)).toBeTruthy();
  });
  it('hard-splits a single huge sentence', () => {
    const chunks = chunkText('x'.repeat(2000), 500, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });
});

describe('textSimilarity / squash', () => {
  it('identical up to case, spacing and punctuation => 1', () => {
    expect(textSimilarity('Webhook manzilini tekshiring.', '  webhook   MANZILINI tekshiring ')).toBe(1);
    expect(squash('  Ha,  BOR ')).toBe('ha, bor');
  });
  it('partial edits score between, unrelated text scores near 0', () => {
    const s = textSimilarity(
      'Webhook manzili https bilan boshlanishi kerak',
      'Webhook manzili https bilan boshlanishini tekshiring, rahmat',
    );
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.9);
    expect(textSimilarity('Webhook manzili', 'Ertaga uchrashamiz')).toBeLessThan(0.1);
    expect(textSimilarity('', '')).toBe(1);
  });
});

describe('draftOutcome', () => {
  const draft =
    "Murojaatingiz bo'yicha: Sozlamalar → Integratsiyalar → Webhooks bo'limida manzil https bilan boshlanishini va faol ekanini tekshiring. Server 200 javob qaytarishi kerak.\nHurmat bilan, Ali.";
  it('identical up to case, spacing and punctuation => UNCHANGED', () => {
    expect(draftOutcome(draft, `  ${draft.toUpperCase()}  `)).toBe('UNCHANGED');
  });
  it('a trimmed or reworded message that still comes from the draft => EDITED', () => {
    expect(
      draftOutcome(
        draft,
        'Assalomu alaykum! Webhook manzili https bilan boshlanishini va faol ekanini tekshiring, rahmat.',
      ),
    ).toBe('EDITED');
    expect(
      draftOutcome(draft, draft.replace('Server 200 javob qaytarishi kerak.', 'Natijani yozib yuboring.')),
    ).toBe('EDITED');
  });
  it('unrelated messages and tiny overlaps are not counted', () => {
    expect(draftOutcome(draft, 'Ertaga ofisda uchrashamiz')).toBeNull();
    expect(draftOutcome(draft, 'tekshiring')).toBeNull(); // one shared word is not evidence
    expect(draftOutcome(draft, 'Faol bilan va')).toBeNull();
  });
});
