const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, TEST_TOKEN } = require('./helpers');

test('authorization boundary', async t => {
  await t.test('mutations require a valid host token', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    assert.equal((await app.post('/api/teams', { name: 'T', budget: 10 }, null)).status, 401);
    assert.equal((await app.post('/api/teams', { name: 'T', budget: 10 }, 'wrong-token')).status, 401);
    assert.equal((await app.post('/api/teams', { name: 'T', budget: 10 }, '')).status, 401);
    assert.equal((await app.post('/api/teams', { name: 'T', budget: 10 })).status, 200);
  });

  await t.test('authorization header form also works', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const res = await fetch(`${app.base}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_TOKEN}` },
      body: JSON.stringify({ name: 'Auth', budget: 10 }),
    });
    assert.equal(res.status, 200);
  });

  await t.test('read endpoints are public, SSE included', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    assert.equal((await app.get('/api/state')).status, 200);
    assert.equal((await app.get('/api/health')).status, 200);
    assert.equal((await app.get('/api/auction/readiness')).status, 200);
    const res = await fetch(`${app.base}/api/events`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    await res.body.cancel();
  });

  await t.test('the host token never appears in responses', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    await app.post('/api/teams', { name: 'Secret', budget: 99 });

    const stateRes = await fetch(`${app.base}/api/state`);
    const stateText = await stateRes.text();
    assert.equal(stateText.includes(TEST_TOKEN), false, 'token absent from /api/state');

    const healthText = await (await fetch(`${app.base}/api/health`)).text();
    assert.equal(healthText.includes(TEST_TOKEN), false, 'token absent from /api/health');

    const sseRes = await fetch(`${app.base}/api/events`);
    const reader = sseRes.body.getReader();
    const first = await reader.read();
    const sseText = new TextDecoder().decode(first.value);
    await reader.cancel();
    assert.equal(sseText.includes(TEST_TOKEN), false, 'token absent from SSE frames');
  });

  await t.test('brute-force attempts get rate limited', async () => {
    const app = await startTestApp({ authMaxFailures: 3, authLockMs: 60000 });
    t.after(() => app.close());

    assert.equal((await app.post('/api/teams', { name: 'X', budget: 1 }, 'bad-1')).status, 401);
    assert.equal((await app.post('/api/teams', { name: 'X', budget: 1 }, 'bad-2')).status, 401);
    assert.equal((await app.post('/api/teams', { name: 'X', budget: 1 }, 'bad-3')).status, 401);
    const locked = await app.post('/api/teams', { name: 'X', budget: 1 }, 'bad-4');
    assert.equal(locked.status, 429, 'locked after repeated failures');

    // Even the correct token is rejected while locked for this IP.
    const stillLocked = await app.post('/api/teams', { name: 'X', budget: 1 }, TEST_TOKEN);
    assert.equal(stillLocked.status, 429);
  });

  await t.test('SSE connections cannot mutate state', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const res = await fetch(`${app.base}/api/events`, { method: 'POST' });
    assert.equal(res.status, 404, 'POST on the SSE route is not a valid mutation path');
    await res.body?.cancel?.();
  });
});
