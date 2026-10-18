const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction } = require('./helpers');

test('bidding rules', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seeded = await seededAuction(app, { increment: 10 });
  const [alpha, beta, gamma] = seeded.teams;
  const [p1, p2] = seeded.players;

  await t.test('cannot bid before the auction starts', async () => {
    const fresh = await startTestApp();
    try {
      await fresh.post('/api/teams', { name: 'T', budget: 100 });
      await fresh.post('/api/players', { name: 'P', category: 'Bowler', basePrice: 5 });
      const r = await fresh.post('/api/bids', { teamId: 'whatever', amount: 10 });
      assert.equal(r.status, 409);
    } finally {
      await fresh.close();
    }
  });

  await t.test('first bid must reach the base price', async () => {
    const r = await app.post('/api/bids', { teamId: alpha.id, amount: 49 });
    assert.equal(r.status, 409);
    assert.match(r.data.error.message, /at least 50/, 'message names the required amount');
  });

  await t.test('bid exactly at base price is accepted', async () => {
    const r = await app.post('/api/bids', { teamId: alpha.id, amount: 50 });
    assert.equal(r.status, 200);
    assert.equal(r.data.state.auction.currentBid.amount, 50);
    assert.equal(r.data.state.auction.currentBid.teamId, alpha.id);
  });

  await t.test('subsequent bids must respect the increment', async () => {
    const below = await app.post('/api/bids', { teamId: beta.id, amount: 55 });
    assert.equal(below.status, 409, '50 + 10 = 60 required');
    const exact = await app.post('/api/bids', { teamId: beta.id, amount: 60 });
    assert.equal(exact.status, 200);
  });

  await t.test('rejects bids the team cannot afford', async () => {
    const r = await app.post('/api/bids', { teamId: alpha.id, amount: 150 }); // alpha budget 100
    assert.equal(r.status, 409);
    assert.match(r.data.error.message, /budget/i);
  });

  await t.test('rejects malformed amounts', async () => {
    assert.equal((await app.post('/api/bids', { teamId: alpha.id, amount: 1.5 })).status, 400);
    assert.equal((await app.post('/api/bids', { teamId: alpha.id, amount: -10 })).status, 400);
    assert.equal((await app.post('/api/bids', { teamId: alpha.id, amount: 'abc' })).status, 400);
    assert.equal((await app.post('/api/bids', { teamId: 'missing', amount: 70 })).status, 404);
  });

  await t.test('bids are rejected while paused and after conclusion', async () => {
    const r = await app.post('/api/bids', { teamId: gamma.id, amount: 100 });
    assert.equal(r.status, 200);

    assert.equal((await app.post('/api/auction/pause')).status, 200);
    const paused = await app.post('/api/bids', { teamId: gamma.id, amount: 200 });
    assert.equal(paused.status, 409);
    assert.match(paused.data.error.message, /paused/i);
    assert.equal((await app.post('/api/auction/resume')).status, 200);

    const after = await app.post('/api/bids', { teamId: gamma.id, amount: 300 });
    assert.equal(after.status, 200);
    assert.equal((await app.post('/api/auction/conclude')).status, 200);
    const concluded = await app.post('/api/bids', { teamId: gamma.id, amount: 400 });
    assert.equal(concluded.status, 409);
  });

  await t.test('selling while paused is rejected', async () => {
    const fresh = await startTestApp();
    try {
      await fresh.post('/api/teams', { name: 'T', budget: 100 });
      await fresh.post('/api/players', { name: 'P', category: 'Bowler', basePrice: 5 });
      await fresh.post('/api/auction/start');
      await fresh.post('/api/bids', { teamId: (await fresh.get('/api/state')).data.teams[0].id, amount: 10 });
      await fresh.post('/api/auction/pause');
      const r = await fresh.post('/api/sale');
      assert.equal(r.status, 409);
    } finally {
      await fresh.close();
    }
  });

  void p1; void p2;
});
