// @vitest-environment jsdom
// Fake-DOM tests. The markup below is a SIMPLIFIED approximation of Telegram Web written from memory,
// so these tests only prove our parsing logic is self-consistent — NOT that it matches real Telegram.
import { describe, expect, it, beforeEach } from 'vitest';
import { parseChatHash, guessKind } from '../src/telegram/chat';
import { match, selfTest, detectVersion } from '../src/telegram/dom';
import { readMessages } from '../src/telegram/messages';
import { redactedOuterHTML } from '../src/telegram/report';

describe('parseChatHash', () => {
  it.each([
    ['#@durov', '@durov', null],
    ['#777000', '777000', null],
    ['#-1001234567890', '-1001234567890', null],
    ['#-1001234567890_42', '-1001234567890', '42'],
    ['#-1234567890?thread=7', '-1234567890', '7'],
    ['', null, null],
    ['#?tgaddr=tg%3A%2F%2Fresolve', null, null],
  ])('%s', (hash, chatId, topicId) => {
    expect(parseChatHash(hash)).toEqual({ chatId, topicId });
  });
  it('guesses chat kind', () => {
    expect(guessKind('-100123', null, '1 234 members')).toBe('group');
    expect(guessKind('-100123', null, '5 000 subscribers')).toBe('channel');
    expect(guessKind('-100123', '5')).toBe('forum-topic');
    expect(guessKind('12345', null)).toBe('private');
    expect(guessKind(null, null)).toBe('unknown');
  });
});

describe('/k/ fake DOM', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/k/#-1001234567890');
    document.body.innerHTML = `
      <div id="column-center"><div class="chat active">
        <div class="sidebar-header topbar"><div class="chat-info"><div class="top"><span class="peer-title">Orient Motors support</span></div><div class="bottom">12 members</div></div></div>
        <div class="bubbles"><div class="scrollable"><div class="bubbles-inner">
          <div class="bubble is-in" data-mid="101"><div class="bubble-content"><div class="name"><span class="peer-title">Jasur</span></div>
            <div class="message"><span class="translatable-message">Webhook ishlamayapti</span><span class="time"><span class="time-inner">10:01</span></span></div></div></div>
          <div class="bubble is-in" data-mid="102"><div class="bubble-content">
            <div class="message"><div class="reply"><div class="reply-subtitle">Webhook ishlamayapti</div></div><span class="translatable-message">parol: abc123</span><span class="time"><span class="time-inner">10:02</span></span></div></div></div>
          <div class="bubble is-out" data-mid="103"><div class="bubble-content"><div class="message"><span class="translatable-message">Tekshiryapmiz</span><span class="time"><span class="time-inner">10:03</span></span></div></div></div>
        </div></div></div>
        <div class="chat-input-container"><div class="input-message-container"><div class="input-message-input" contenteditable="true"></div><div class="input-message-input input-field-input-fake" contenteditable="true"></div></div></div>
      </div></div>`;
  });
  it('detects version and core selectors', () => {
    expect(detectVersion()).toBe('k');
    const c = match('composer');
    expect(c.el?.classList.contains('input-field-input-fake')).toBe(false);
    const rows = selfTest();
    expect(rows.find((r) => r.key === 'chatTitle')?.state).toBe('found');
    expect(rows.find((r) => r.key === 'messageBubble')?.count).toBe(3);
  });
  it('parses messages with sender carry-over, reply and time stripped', () => {
    const m = readMessages(10);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ id: '101', sender: 'Jasur', outgoing: false, text: 'Webhook ishlamayapti', time: '10:01' });
    expect(m[1]).toMatchObject({ id: '102', sender: 'Jasur', replyTo: 'Webhook ishlamayapti', text: 'parol: abc123' });
    expect(m[2]).toMatchObject({ outgoing: true, text: 'Tekshiryapmiz' });
  });
  it('redacts text in the DOM report', () => {
    const html = redactedOuterHTML(document.querySelector('.bubble[data-mid="102"]'));
    expect(html).not.toContain('abc123');
    expect(html).toContain('data-mid="102"');
    expect(html).toContain('translatable-message');
  });
});

describe('/a/ fake DOM', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/a/#-1009876543210_5');
    document.body.innerHTML = `
      <div id="MiddleColumn"><div class="MiddleHeader"><div class="ChatInfo"><div class="info"><div class="title"><h3 class="fullName">Silk Road Call</h3></div><span class="status">topic</span></div></div></div>
      <div class="MessageList">
        <div class="Message message-list-item" data-message-id="55" id="message-55"><div class="message-content"><div class="message-title"><span class="sender-title">Marina</span></div>
          <div class="text-content">Нет записей звонков<span class="MessageMeta"><span class="message-time">09:15</span></span></div></div></div>
        <div class="Message message-list-item own" data-message-id="56"><div class="message-content"><div class="text-content">Проверяем<span class="MessageMeta"><span class="message-time">09:16</span></span></div></div></div>
      </div>
      <div class="Composer"><div class="message-input-wrapper"><div id="editable-message-text" contenteditable="true"></div></div></div></div>`;
  });
  it('finds title, composer and messages', () => {
    expect(detectVersion()).toBe('a');
    expect(match('chatTitle').el?.textContent).toBe('Silk Road Call');
    expect(match('composer').el?.id).toBe('editable-message-text');
    const m = readMessages(10);
    expect(m[0]).toMatchObject({ id: '55', sender: 'Marina', text: 'Нет записей звонков', time: '09:15', outgoing: false });
    expect(m[1]).toMatchObject({ id: '56', outgoing: true, text: 'Проверяем' });
  });
});
