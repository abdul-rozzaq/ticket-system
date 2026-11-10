// Server-only configuration (never imported by client components).
export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const API_PREFIX = '/api/v1';
export const ACCESS_COOKIE = 'tp_at';
export const REFRESH_COOKIE = 'tp_rt';
/** Mutating requests must carry this header: a cross-site form post cannot set it (CSRF defence in depth). */
export const CSRF_HEADER = 'x-tp-csrf';
export const CSRF_VALUE = '1';
/** API paths the panel must never expose (service-token endpoints for the userbot/bot). */
export const BLOCKED_PREFIXES = ['internal'];
export const SECURE_COOKIES = process.env.COOKIE_SECURE === 'true';
export const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 3600;
