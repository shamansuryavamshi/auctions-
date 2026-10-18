const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');

test('setup validation', async t => {
  const app = await startTestApp();
  t.after(() => app.close());

  await t.test('rejects team with no name', async () => {
    const r = await app.post('/api/teams', { name: '   ', budget: 100 });
    assert.equal(r.status, 400);
  });

  await t.test('rejects zero, negative and fractional budgets', async () => {
    assert.equal((await app.post('/api/teams', { name: 'T0', budget: 0 })).status, 400);
    assert.equal((await app.post('/api/teams', { name: 'T1', budget: -5 })).status, 400);
    assert.equal((await app.post('/api/teams', { name: 'T2', budget: 10.5 })).status, 400);
  });

  await t.test('rejects duplicate team names (case-insensitive)', async () => {
    assert.equal((await app.post('/api/teams', { name: 'Lakers', budget: 100 })).status, 200);
    assert.equal((await app.post('/api/teams', { name: 'lakers', budget: 100 })).status, 400);
  });

  await t.test('rejects player without name/category, bad category, bad base price, bad image', async () => {
    assert.equal((await app.post('/api/players', { name: '', category: 'Batsman', basePrice: 0 })).status, 400);
    assert.equal((await app.post('/api/players', { name: 'X', category: 'Nope', basePrice: 0 })).status, 400);
    assert.equal((await app.post('/api/players', { name: 'X', category: 'Batsman', basePrice: -1 })).status, 400);
    assert.equal((await app.post('/api/players', { name: 'X', category: 'Batsman', basePrice: 0, image: 'http://evil/x.png' })).status, 400);
  });

  await t.test('rejects duplicate player names', async () => {
    assert.equal((await app.post('/api/players', { name: 'Virat', category: 'Batsman', basePrice: 10 })).status, 200);
    assert.equal((await app.post('/api/players', { name: 'virat', category: 'Bowler', basePrice: 10 })).status, 400);
  });

  await t.test('cannot start an empty auction', async () => {
    const fresh = await startTestApp();
    try {
      const r = await fresh.post('/api/auction/start');
      assert.equal(r.status, 409);
      assert.ok(r.data.error.details.length >= 2, 'reports missing teams and players');
    } finally {
      await fresh.close();
    }
  });

  await t.test('cannot start with teams but no players (and vice versa)', async () => {
    const a = await startTestApp();
    const b = await startTestApp();
    try {
      await a.post('/api/teams', { name: 'Only Team', budget: 100 });
      assert.equal((await a.post('/api/auction/start')).status, 409);

      await b.post('/api/players', { name: 'Lonely', category: 'Bowler', basePrice: 1 });
      assert.equal((await b.post('/api/auction/start')).status, 409);
    } finally {
      await a.close();
      await b.close();
    }
  });

  await t.test('readiness endpoint reflects the state of the setup', async () => {
    const fresh = await startTestApp();
    try {
      let r = await fresh.get('/api/auction/readiness');
      assert.equal(r.data.ready, false);
      await fresh.post('/api/teams', { name: 'T', budget: 50 });
      await fresh.post('/api/players', { name: 'P', category: 'Batsman', basePrice: 1 });
      r = await fresh.get('/api/auction/readiness');
      assert.equal(r.data.ready, true);
    } finally {
      await fresh.close();
    }
  });

  await t.test('valid setup starts the auction and puts the first player on the block', async () => {
    const fresh = await startTestApp();
    try {
      await fresh.post('/api/teams', { name: 'T', budget: 100 });
      await fresh.post('/api/players', { name: 'First', category: 'Batsman', basePrice: 10 });
      await fresh.post('/api/players', { name: 'Second', category: 'Bowler', basePrice: 10 });
      const r = await fresh.post('/api/auction/start');
      assert.equal(r.status, 200);
      assert.equal(r.data.state.auction.status, 'live');
      assert.equal(r.data.state.currentPlayer.name, 'First');
      assert.equal(r.data.state.currentPlayer.status, 'in_progress');

      const again = await fresh.post('/api/auction/start');
      assert.equal(again.status, 409, 'cannot start twice');
    } finally {
      await fresh.close();
    }
  });

  await t.test('rejects malformed JSON and unknown endpoints', async () => {
    const res = await fetch(`${app.base}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-token': 'test-host-token-123' },
      body: '{ not json',
    });
    assert.equal(res.status, 400);
    assert.equal((await app.get('/api/nope')).status, 404);
  });
});
