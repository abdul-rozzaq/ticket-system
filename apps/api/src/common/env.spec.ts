import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'j'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadEnv', () => {
  it('treats empty strings (what docker compose passes for unset ${VAR:-}) as not set', () => {
    const env = loadEnv({
      ...base,
      SERVICE_TOKEN: '',
      SEED_ADMIN_PASSWORD: '',
    });
    expect(env.SERVICE_TOKEN).toBeUndefined();
    expect(env.SEED_ADMIN_PASSWORD).toBeUndefined();
  });

  it('still validates values that are set', () => {
    expect(() => loadEnv({ ...base, SERVICE_TOKEN: 'short' })).toThrow(/SERVICE_TOKEN/);
    expect(() => loadEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });
});
