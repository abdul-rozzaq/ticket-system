import { adminToken, ADMIN, bearer, createTestApp, TestCtx } from './helpers';

describe('auth + users (e2e)', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  it('exposes liveness and readiness', async () => {
    expect((await ctx.http().get('/api/v1/health')).body.status).toBe('ok');
    expect((await ctx.http().get('/api/v1/health/ready')).body.db).toBe('ok');
  });

  it('rejects bad credentials with one consistent error shape', async () => {
    const r = await ctx.http().post('/api/v1/auth/login').send({ username: 'admin', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
    expect(r.body.correlationId).toBeTruthy();
    const unknown = await ctx.http().post('/api/v1/auth/login').send({ username: 'ghost', password: 'whatever' });
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS'); // same answer: no user enumeration
  });

  it('validates input with zod', async () => {
    const r = await ctx.http().post('/api/v1/auth/login').send({ username: '', password: '' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION');
  });

  it('forces the seeded admin to change the password before anything else works', async () => {
    const l = await ctx.login(ADMIN.username, ADMIN.password);
    expect(l.status).toBe(200);
    expect(l.body.user.mustChangePassword).toBe(true);

    const blocked = await ctx.http().get('/api/v1/users').set(bearer(l.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(l.accessToken))).status).toBe(200);

    const weak = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(l.accessToken))
      .send({ currentPassword: ADMIN.password, newPassword: 'short' });
    expect(weak.status).toBe(400);

    const ok = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(l.accessToken))
      .send({ currentPassword: ADMIN.password, newPassword: 'A-brand-new-pass-1' });
    expect(ok.status).toBe(200);
    expect((await ctx.http().get('/api/v1/users').set(bearer(ok.body.accessToken))).status).toBe(200);
    // the old refresh token died with the password change
    expect((await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken })).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const t = await adminToken(ctx);
    expect(t).toBeTruthy();
    const l = await ctx.login(ADMIN.username, 'Changed-pass-12345');
    const r1 = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(l.refreshToken);
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(r1.body.accessToken))).status).toBe(200);

    // replay of the first token => theft assumed => whole family revoked
    const replay = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken });
    expect(replay.status).toBe(401);
    const afterReplay = await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(afterReplay.status).toBe(401);
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'auth.refresh_reuse' } });
    expect(audit.length).toBeGreaterThanOrEqual(1); // the replayed token and the already-revoked successor are both flagged
  });

  it('only one of two concurrent refreshes with the same token wins', async () => {
    await adminToken(ctx);
    const l = await ctx.login(ADMIN.username, 'Changed-pass-12345');
    const [a, b] = await Promise.all([
      ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken }),
      ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('logout revokes the refresh token family', async () => {
    await adminToken(ctx);
    const l = await ctx.login(ADMIN.username, 'Changed-pass-12345');
    expect((await ctx.http().post('/api/v1/auth/logout').send({ refreshToken: l.refreshToken })).status).toBe(204);
    expect((await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: l.refreshToken })).status).toBe(401);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await ctx.login(ADMIN.username, 'wrong-password')).status).toBe(401);
    }
    const locked = await ctx.login(ADMIN.username, ADMIN.password);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('LOCKED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.locked' } })).toBeGreaterThan(0);
  });

  it('enforces roles: STAFF cannot manage users; admin can create, update, reset and deactivate', async () => {
    const admin = await adminToken(ctx);
    const created = await ctx
      .http()
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ username: 'Ali', displayName: 'Ali', password: 'Temp-password-1', role: 'STAFF' });
    expect(created.status).toBe(201);
    expect(created.body.username).toBe('ali');
    expect(created.body.passwordHash).toBeUndefined();
    expect(created.body.mustChangePassword).toBe(true);

    const dup = await ctx.http().post('/api/v1/users').set(bearer(admin)).send({ username: 'ali', displayName: 'x', password: 'Temp-password-1' });
    expect(dup.status).toBe(409);

    // staff logs in, must change the password, then is still forbidden from admin routes
    const s = await ctx.login('ali', 'Temp-password-1');
    const changed = await ctx
      .http()
      .post('/api/v1/auth/change-password')
      .set(bearer(s.accessToken))
      .send({ currentPassword: 'Temp-password-1', newPassword: 'Staff-new-pass-1' });
    const forbidden = await ctx.http().get('/api/v1/users').set(bearer(changed.body.accessToken));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');

    // deactivation kills access immediately (even with a still-valid access token)
    const id = created.body.id as string;
    expect((await ctx.http().patch(`/api/v1/users/${id}`).set(bearer(admin)).send({ isActive: false })).status).toBe(200);
    expect((await ctx.http().get('/api/v1/auth/me').set(bearer(changed.body.accessToken))).status).toBe(401);
    expect((await ctx.login('ali', 'Staff-new-pass-1')).status).toBe(401);

    // admin reset puts the user back into forced-change state
    await ctx.http().patch(`/api/v1/users/${id}`).set(bearer(admin)).send({ isActive: true });
    expect((await ctx.http().post(`/api/v1/users/${id}/reset-password`).set(bearer(admin)).send({ newPassword: 'Reset-pass-12345' })).status).toBe(204);
    const again = await ctx.login('ali', 'Reset-pass-12345');
    expect(again.body.user.mustChangePassword).toBe(true);
  });

  it('refuses to let an admin lock themselves out', async () => {
    const admin = await adminToken(ctx);
    const me = (await ctx.http().get('/api/v1/auth/me').set(bearer(admin))).body;
    const r = await ctx.http().patch(`/api/v1/users/${me.id}`).set(bearer(admin)).send({ isActive: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SELF_LOCKOUT');
  });

  it('issues a one-time Telegram link code that is stored hashed', async () => {
    const admin = await adminToken(ctx);
    const u = await ctx.http().post('/api/v1/users').set(bearer(admin)).send({ username: 'vali', displayName: 'Vali', password: 'Temp-password-1' });
    const code = await ctx.http().post(`/api/v1/users/${u.body.id}/telegram-code`).set(bearer(admin));
    expect(code.body.code).toMatch(/^[A-Z2-9]{8}$/);
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.body.id } });
    expect(row.telegramLinkHash).toBeTruthy();
    expect(row.telegramLinkHash).not.toContain(code.body.code);

    const { UsersService } = await import('../src/users/users.service');
    const users = ctx.app.get(UsersService);
    expect(await users.linkTelegram('WRONGCODE', 111n)).toBeNull();
    expect((await users.linkTelegram(code.body.code, 111n))?.telegramLinked).toBe(true);
    expect(await users.linkTelegram(code.body.code, 222n)).toBeNull(); // single use
  });

  it('requires a token for protected routes', async () => {
    expect((await ctx.http().get('/api/v1/users')).status).toBe(401);
    expect((await ctx.http().get('/api/v1/users').set(bearer('garbage'))).status).toBe(401);
  });
});
