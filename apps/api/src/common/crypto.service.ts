import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_ENV, Env } from '../config/env';

/**
 * AES-256-GCM envelope for secrets at rest (userbot session, AI keys, bot token).
 * Format: `v1.<iv>.<tag>.<ciphertext>` (each part base64url). A fresh random 96-bit IV per message.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_ENV) env: Env) {
    this.key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(envelope: string): string {
    const [v, iv, tag, ct] = envelope.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** Deterministic hash for lookup tokens (refresh tokens, link codes). Tokens are high-entropy, so no salt is needed. */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Short human-typeable one-time code, e.g. for linking a Telegram account. */
  randomCode(length = 8): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    const bytes = randomBytes(length);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }

  safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
