import { parseCallback } from '@tp/shared';
import { renderCard, escapeHtml, type CardInput } from './card';
import { localParts, startOfLocalDay } from './local-time';

const base = (o: Partial<CardInput['ticket']> = {}, rest: Partial<CardInput> = {}): CardInput => ({
  ticket: {
    number: 123,
    status: 'NEW',
    urgency: 'HIGH',
    summary: 'Webhook ishlamayapti',
    systemType: 'AMOCRM',
    category: 'webhook',
    openedAt: new Date('2026-03-02T05:07:00Z'),
    needsReview: false,
    solutionNote: null,
    assigneeName: null,
    ...o,
  },
  company: 'Orient Motors',
  firstText: 'Webhook ulanmadi, lidlar tushmayapti',
  chatKey: 'c:1234567890',
  staff: [
    { id: '4875fbba-2771-459c-aaa7-2fc6ca442a6e', name: 'Ali', openCount: 3 },
    { id: '07d74055-4f68-4a06-b3c0-593993233eb2', name: 'Vali', openCount: 0 },
    { id: 'aaaaaaaa-2771-459c-aaa7-2fc6ca442a6e', name: 'Sardor', openCount: 1 },
  ],
  suggestedId: '07d74055-4f68-4a06-b3c0-593993233eb2',
  ...rest,
});

const buttons = (k: ReturnType<typeof renderCard>['keyboard']) => k.flat();

describe('renderCard', () => {
  it('unassigned card: badge, number, company, summary, quoted text, time, recommendation', () => {
    const c = renderCard(base());
    expect(c.text).toContain('🔴 <b>#123</b> · Orient Motors · AmoCRM');
    expect(c.text).toContain('<i>Webhook ishlamayapti</i>');
    expect(c.text).toContain('«Webhook ulanmadi, lidlar tushmayapti»');
    expect(c.text).toContain('10:07'); // 05:07Z in Tashkent
    expect(c.text).toContain('💡 Tavsiya: Vali');
  });

  it('unassigned keyboard: row 1 is "Men olaman", then one button per staff member with their load, then snooze + link', () => {
    const k = renderCard(base()).keyboard;
    expect(k[0]).toEqual([{ text: '🙋 Men olaman', callback: 'k:123' }]);
    const staff = buttons(k).filter((b) => b.callback?.startsWith('a:'));
    expect(staff.map((b) => b.text)).toEqual(['👤 Ali (3)', '👤 Vali (0)', '👤 Sardor (1)']);
    expect(parseCallback(staff[0].callback)).toMatchObject({
      action: 'assign',
      ticketNumber: 123,
      userShort: '4875fbba',
    });
    const last = k[k.length - 1];
    expect(last[0]).toEqual({ text: '⏭ Keyinroq', callback: 's:123' });
    expect(last[1]).toEqual({ text: '🔗 Chatni ochish', url: 'https://t.me/c/1234567890/1' });
  });

  it('every callback is valid and within Telegram’s 64-byte limit', () => {
    for (const card of [
      renderCard(base()),
      renderCard(base({ assigneeName: 'Ali', status: 'IN_PROGRESS' })),
      renderCard(base({}, { reassignMenu: true })),
    ]) {
      for (const b of buttons(card.keyboard)) {
        if (b.callback) {
          expect(b.callback.length).toBeLessThanOrEqual(64);
          expect(parseCallback(b.callback)).not.toBeNull();
        }
      }
    }
  });

  it('assigned card: "taken by", reassign / done / wait / link, no staff buttons', () => {
    const c = renderCard(base({ assigneeName: 'Ali', status: 'IN_PROGRESS' }));
    expect(c.text).toContain('✅ Ali tomonidan olindi');
    expect(buttons(c.keyboard).map((b) => b.text)).toEqual([
      "Boshqaga o'tkazish",
      "✅ Hal bo'ldi",
      '⏳ Kutilmoqda',
      '🔗 Chatni ochish',
    ]);
    expect(buttons(c.keyboard).some((b) => b.callback === 'k:123')).toBe(false);
  });

  it('waiting card has no "wait" button; closed card has no action buttons and shows the solution', () => {
    const w = renderCard(base({ assigneeName: 'Ali', status: 'WAITING_CLIENT' }));
    expect(w.text).toContain('Mijoz kutilmoqda');
    expect(buttons(w.keyboard).some((b) => b.callback === 'w:123')).toBe(false);
    const c = renderCard(base({ assigneeName: 'Ali', status: 'CLOSED', solutionNote: 'https qilindi' }));
    expect(c.text).toContain('Yopilgan: https qilindi');
    expect(buttons(c.keyboard).every((b) => !b.callback)).toBe(true);
  });

  it('reassign menu lists staff then a back button', () => {
    const k = renderCard(
      base({ assigneeName: 'Ali', status: 'IN_PROGRESS' }, { reassignMenu: true }),
    ).keyboard;
    expect(buttons(k).map((b) => b.callback?.[0])).toEqual(['a', 'a', 'a', 'b']);
  });

  it('masks secrets and escapes HTML in everything that came from a customer', () => {
    const c = renderCard(
      base(
        { summary: '<b>hack</b> & co' },
        {
          firstText: 'parol: Hunter22secret, token sk-ant-api03-abcdefghijklmnopqrstuv <script>x</script>',
          company: 'A&B <Co>',
        },
      ),
    );
    expect(c.text).not.toContain('Hunter22secret');
    expect(c.text).not.toContain('abcdefghijklmnopqrstuv');
    expect(c.text).toContain('[PAROL]');
    expect(c.text).not.toContain('<script>');
    expect(c.text).toContain('&lt;script&gt;');
    expect(c.text).toContain('A&amp;B &lt;Co&gt;');
    expect(c.text).toContain('&lt;b&gt;hack&lt;/b&gt;');
    expect(escapeHtml('a<b>&')).toBe('a&lt;b&gt;&amp;');
  });

  it('masks secrets that were copied into the summary too', () => {
    const c = renderCard(base({ summary: 'login admin parol: Hunter22secret' }));
    expect(c.text).not.toContain('Hunter22secret');
  });

  it('trims long texts and flags low-confidence AI', () => {
    const c = renderCard(base({ needsReview: true }, { firstText: 'x'.repeat(2000) }));
    expect(c.text.length).toBeLessThan(900);
    expect(c.text).toContain('⚠️');
  });

  it('omits the chat link for basic groups', () => {
    const c = renderCard(base({}, { chatKey: 'g:555' }));
    expect(buttons(c.keyboard).some((b) => b.url)).toBe(false);
  });
});

describe('local time helpers', () => {
  it('computes local date, hour and weekday in a zone', () => {
    const p = localParts(new Date('2026-03-02T05:07:09Z'), 'Asia/Tashkent'); // Monday 10:07 local
    expect(p).toMatchObject({ date: '2026-03-02', hour: 10, minute: 7, second: 9, weekday: 1 });
    expect(localParts(new Date('2026-03-01T20:00:00Z'), 'Asia/Tashkent')).toMatchObject({
      date: '2026-03-02',
      hour: 1,
    }); // crosses midnight
  });
  it('finds the start of the local day', () => {
    const start = startOfLocalDay(new Date('2026-03-02T05:07:09.500Z'), 'Asia/Tashkent');
    expect(start.toISOString()).toBe('2026-03-01T19:00:00.000Z'); // midnight Tashkent
  });
});
