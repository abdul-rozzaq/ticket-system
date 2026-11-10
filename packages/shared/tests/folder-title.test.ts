import { describe, expect, it } from 'vitest';
import { folderTitle, staffFolderTitle } from '../src/folder-title';
import { t } from '../src/i18n';

describe('folderTitle', () => {
  it('keeps short titles and collapses whitespace', () => {
    expect(folderTitle('  🆕   Yangi ')).toBe('🆕 Yangi');
  });
  it('never exceeds 12 UTF-16 units and never splits an emoji', () => {
    for (const s of [
      '🔴 Kechikkan',
      '⏳ Kutilmoqda',
      '👤 Muhammadyusuf',
      '🙂🙂🙂🙂🙂🙂🙂🙂',
      'x'.repeat(40),
    ]) {
      const r = folderTitle(s);
      expect(r.length).toBeLessThanOrEqual(12);
      expect(r).not.toMatch(/[\ud800-\udbff]$/); // no dangling high surrogate
    }
    expect(folderTitle('🙂🙂🙂🙂🙂🙂🙂🙂')).toBe('🙂🙂🙂🙂🙂🙂');
  });
  it('shortens long staff names', () => {
    expect(staffFolderTitle('Ali')).toBe('👤 Ali');
    expect(staffFolderTitle('Muhammadyusuf')).toBe('👤 Muhammady');
  });
  it('the default stage titles fit as they are', () => {
    for (const k of ['stage.NEW', 'stage.WAITING', 'stage.OVERDUE'] as const)
      expect(folderTitle(t(k))).toBe(t(k));
  });
});
