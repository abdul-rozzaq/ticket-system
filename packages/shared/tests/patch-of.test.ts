import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { clientGroupPatchSchema, patchOf } from '../src';

describe('patchOf', () => {
  it('does not re-apply defaults on PATCH (zod .partial() would)', () => {
    const s = z.object({
      a: z.string(),
      b: z.boolean().default(true),
      l: z.enum(['uz', 'ru']).default('uz'),
    });
    expect(s.partial().parse({ a: 'x' })).toEqual({ a: 'x', b: true, l: 'uz' }); // the trap
    expect(patchOf(s).parse({ a: 'x' })).toEqual({ a: 'x' });
    expect(patchOf(s).parse({ b: false })).toEqual({ b: false });
  });

  it('keeps validation of provided fields', () => {
    expect(() => patchOf(z.object({ l: z.enum(['uz', 'ru']).default('uz') })).parse({ l: 'en' })).toThrow();
  });

  it('client group patch leaves isActive/language/systemType alone', () => {
    expect(clientGroupPatchSchema.parse({ title: 'T' })).toEqual({ title: 'T' });
  });
});
