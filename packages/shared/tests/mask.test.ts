import { describe, expect, it } from 'vitest';
import { maskSensitive } from '../src/mask';

const kinds = (t: string) => maskSensitive(t).hits.map((h) => h.kind);

describe('maskSensitive', () => {
  it('masks passwords after keywords (uz/ru/en)', () => {
    expect(maskSensitive('login: admin, parol: Qwerty123!').text).toBe('login: admin, parol: [PAROL]');
    expect(maskSensitive('пароль - secret2024').text).toBe('пароль - [PAROL]');
    expect(maskSensitive('password=hunter22').text).toBe('password=[PAROL]');
    expect(maskSensitive('Parol abc12345 edi').text).toBe('Parol [PAROL] edi');
  });
  it('masks bearer tokens and JWT', () => {
    expect(maskSensitive('Authorization: Bearer abcdef123456789xyz').text).toBe(
      'Authorization: Bearer [TOKEN]',
    );
    expect(
      kinds('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
    ).toContain('TOKEN');
  });
  it('masks known API key shapes', () => {
    expect(maskSensitive('key sk-ant-api03-abcdefghijklmnopqrstuv').text).not.toContain('sk-ant');
    expect(maskSensitive('AKIAIOSFODNN7EXAMPLE').text).toBe('[API_KEY]');
    expect(maskSensitive('bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ').text).toBe('bot [TOKEN]');
  });
  it('masks long hex and base64 blobs', () => {
    expect(
      maskSensitive('hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok').text,
    ).toBe('hash [HEX] ok');
    expect(kinds('blob QWxhZGRpbjpvcGVuIHNlc2FtZQ1234567890abcdefghijklmnop==')).toContain('BASE64');
  });
  it('masks Luhn-valid cards and local-BIN cards', () => {
    expect(maskSensitive('karta 4111 1111 1111 1111').text).toBe('karta [KARTA]');
    expect(maskSensitive('karta 8600-1234-5678-9010').text).toBe('karta [KARTA]'); // local BIN, Luhn fails
    expect(maskSensitive('order 1234 5678 1234 5678').text).not.toContain('[KARTA]'); // Luhn fails, no BIN
  });
  it('masks phones', () => {
    expect(maskSensitive('tel +998 90 123 45 67').text).toBe('tel [TELEFON]');
    expect(maskSensitive('тел +7 (912) 345-67-89').text).toBe('тел [TELEFON]');
    expect(maskSensitive('raqam 90 123 45 67').text).toBe('raqam [TELEFON]');
  });
  it('masks credentials in URLs but keeps host', () => {
    expect(maskSensitive('https://admin:p4ss@pbx.example.uz/panel').text).toBe(
      'https://[LOGIN]:[PAROL]@pbx.example.uz/panel',
    );
  });
  it('leaves normal support text alone', () => {
    const t = "Webhook ulanmadi, lidlar tushmayapti. Versiya 2.3, 15:30 da sodir bo'ldi. Ticket T-1041.";
    expect(maskSensitive(t)).toEqual({ text: t, hits: [] });
  });
  it('reports every hit with its original value', () => {
    const r = maskSensitive('parol: x1y2z3 va +998901234567');
    expect(r.hits.map((h) => h.kind).sort()).toEqual(['PAROL', 'TELEFON']);
    expect(r.hits.find((h) => h.kind === 'PAROL')!.original).toContain('x1y2z3');
  });
});
