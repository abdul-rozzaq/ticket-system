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
      DEMO_PASSWORD: '',
      SERVICE_TOKEN: '',
      SEED_ADMIN_PASSWORD: '',
      DEMO_MODE: 'false',
    });
    expect(env.DEMO_PASSWORD).toBeUndefined();
    expect(env.SERVICE_TOKEN).toBeUndefined();
    expect(env.SEED_ADMIN_PASSWORD).toBeUndefined();
  });

  it('still validates values that are set', () => {
    expect(() => loadEnv({ ...base, DEMO_PASSWORD: 'short' })).toThrow(/DEMO_PASSWORD/);
    expect(() => loadEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
  });
});
