const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction } = require('./helpers');

async function joinWithCode(app, name) {
  const hostCodes = await app.post('/api/participant-codes');
  assert.equal(hostCodes.status, 200);
  const entry = hostCodes.data.result.find(r => r.name === name);
  assert.ok(entry, `expected a code for team ${name}`);
  const sess = await app.ppost('/api/participants/session', { code: entry.code });
  assert.equal(sess.status, 200);
  return { token: sess.data.token, code: entry.code, team: sess.data.team };
}

test('participant session lifecycle', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  await app.post('/api/teams', { name: 'Alpha', budget: 100 });

  await t.test('valid code returns a session token bound to that team', async () => {
    const { token, team } = await joinWithCode(app, 'Alpha');
    assert.ok(token);
    assert.equal(team.name, 'Alpha');
    const me = await app.pget('/api/participants/me', token);
    assert.equal(me.status, 200);
    assert.equal(me.data.team.name, 'Alpha');
  });

  await t.test('bidding endpoints require a participant session', async () => {
    const noToken = await app.ppost('/api/participant/bids', { amount: 50 });
    assert.equal(noToken.status, 401);
    const badToken = await app.ppost('/api/participant/bids', { amount: 50 }, 'not-a-real-token');
    assert.equal(badToken.status, 401);
  });

  await t.test('host and participant credentials are not interchangeable', async () => {
    const { token } = await joinWithCode(app, 'Alpha');
    const asHost = await app.post('/api/teams', { name: 'Sneaky', budget: 50 }, token);
    assert.equal(asHost.status, 401);
    const asParticipant = await app.ppost('/api/participant/bids', { amount: 50 }, 'test-host-token-123');
    assert.equal(asParticipant.status, 401);
  });

  await t.test('logout revokes the session', async () => {
    const { token } = await joinWithCode(app, 'Alpha');
    const out = await app.ppost('/api/participants/logout', {}, token);
    assert.equal(out.status, 200);
    const after = await app.pget('/api/participants/me', token);
    assert.equal(after.status, 401);
  });

  await t.test('participant codes never appear in public snapshots or SSE', async () => {
    const hostCodes = await app.post('/api/participant-codes');
    const alphaCode = hostCodes.data.result.find(r => r.name === 'Alpha').code;
    const snapshot = await app.get('/api/state');
    const text = JSON.stringify(snapshot.data);
    assert.ok(!text.includes(alphaCode), 'public snapshot must not contain participant codes');
    for (const team of snapshot.data.teams) {
      assert.equal(team.participantCode, undefined);
    }
  });

  await t.test('archived teams cannot obtain new sessions', async () => {
    const hostCodes = await app.post('/api/participant-codes');
    const alpha = hostCodes.data.result.find(r => r.name === 'Alpha');
    const snap = await app.get('/api/state');
    const alphaTeam = snap.data.teams.find(t => t.name === 'Alpha');
    await app.del(`/api/teams/${alphaTeam.id}`);
    const res = await app.ppost('/api/participants/session', { code: alpha.code });
    assert.equal(res.status, 401);
  });
});

test('participant code brute-force lockout', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  await app.post('/api/teams', { name: 'Alpha', budget: 100 });
  const hostCodes = await app.post('/api/participant-codes');
  const alphaCode = hostCodes.data.result.find(r => r.name === 'Alpha').code;

  for (let i = 0; i < 10; i++) {
    const r = await app.ppost('/api/participants/session', { code: 'deadbeef' });
    assert.equal(r.status, 401);
  }
  const locked = await app.ppost('/api/participants/session', { code: 'deadbeef' });
  assert.equal(locked.status, 429);
  // even a correct code is rejected while the IP is locked
  const stillLocked = await app.ppost('/api/participants/session', { code: alphaCode });
  assert.equal(stillLocked.status, 429);
});

test('participant bidding during a live auction', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seed = await seededAuction(app);
  const [alpha, beta, gamma] = seed.teams;

  await t.test('bid is credited to the session team even with a spoofed teamId', async () => {
    const { token } = await joinWithCode(app, 'Beta');
    const res = await app.ppost('/api/participant/bids', { amount: 60, teamId: alpha.id }, token);
    assert.equal(res.status, 200);
    assert.equal(res.data.state.auction.currentBid.teamId, beta.id);
    const lastBid = res.data.state.recentBids.at(-1);
    assert.equal(lastBid.teamId, beta.id);
    assert.equal(lastBid.source, 'participant');
  });

  await t.test('host bid and participant bid share one ordered history', async () => {
    const { token } = await joinWithCode(app, 'Gamma');
    const hostBid = await app.post('/api/bids', { teamId: alpha.id, amount: 70 });
    assert.equal(hostBid.status, 200);
    assert.equal(hostBid.data.state.recentBids.at(-1).source, 'host');
    const pBid = await app.ppost('/api/participant/bids', { amount: 80 }, token);
    assert.equal(pBid.status, 200);
    assert.equal(pBid.data.state.recentBids.at(-1).source, 'participant');
    assert.equal(pBid.data.state.auction.currentBid.teamId, gamma.id);
  });

  await t.test('too-low and over-budget participant bids are rejected', async () => {
    const { token } = await joinWithCode(app, 'Alpha');
    const tooLow = await app.ppost('/api/participant/bids', { amount: 85 }, token); // need 90
    assert.equal(tooLow.status, 409);
    const tooHigh = await app.ppost('/api/participant/bids', { amount: 5000 }, token);
    assert.equal(tooHigh.status, 409);
  });

  await t.test('bidding is rejected while paused', async () => {
    await app.post('/api/auction/pause');
    const { token } = await joinWithCode(app, 'Gamma');
    const res = await app.ppost('/api/participant/bids', { amount: 90 }, token);
    assert.equal(res.status, 409);
    await app.post('/api/auction/resume');
  });
});
