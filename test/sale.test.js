const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction } = require('./helpers');

test('sale settlement', async t => {
  await t.test('cannot sell without a bid', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    await seededAuction(app);
    const r = await app.post('/api/sale');
    assert.equal(r.status, 409);
    assert.match(r.data.error.message, /without a valid bid/i);
  });

  await t.test('sale assigns the player, deducts exactly once, and advances the lot', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const [alpha] = seeded.teams;

    await app.post('/api/bids', { teamId: alpha.id, amount: 60 });
    const r = await app.post('/api/sale');
    assert.equal(r.status, 200);

    const state = r.data.state;
    const sold = state.players.find(p => p.name === 'Player One');
    assert.equal(sold.status, 'sold');
    assert.equal(sold.teamId, alpha.id);
    assert.equal(sold.price, 60);
    assert.equal(state.sales.length, 1);

    const team = state.teams.find(x => x.id === alpha.id);
    assert.equal(team.remainingBudget, 100 - 60);
    assert.equal(team.initialBudget, 100, 'initial budget untouched');

    assert.equal(state.currentPlayer.name, 'Player Two', 'next lot advanced');
    assert.equal(state.auction.currentBid, null, 'bid reset for the new lot');
  });

  await t.test('repeated and concurrent sale requests cannot double-sell', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const [alpha] = seeded.teams;

    await app.post('/api/bids', { teamId: alpha.id, amount: 60 });

    const [a, b, c] = await Promise.all([
      app.post('/api/sale'),
      app.post('/api/sale'),
      app.post('/api/sale'),
    ]);
    const ok = [a, b, c].filter(r => r.status === 200);
    const rejected = [a, b, c].filter(r => r.status === 409);
    assert.equal(ok.length, 1, 'exactly one sale succeeds');
    assert.equal(rejected.length, 2, 'competing requests are rejected');

    const state = (await app.get('/api/state')).data;
    assert.equal(state.sales.length, 1, 'sale recorded exactly once');
    const team = state.teams.find(x => x.id === alpha.id);
    assert.equal(team.remainingBudget, 40, 'budget deducted exactly once');

    const sequential = await app.post('/api/sale');
    assert.equal(sequential.status, 409, 'later duplicate still rejected');
  });

  await t.test('unsold marks the player without touching any budget', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);

    const before = (await app.get('/api/state')).data;
    const current = before.currentPlayer;
    const r = await app.post(`/api/players/${current.id}/unsold`);
    assert.equal(r.status, 200);

    const state = r.data.state;
    const player = state.players.find(p => p.id === current.id);
    assert.equal(player.status, 'unsold');
    assert.equal(state.sales.length, 0);
    state.teams.forEach(team => {
      assert.equal(team.remainingBudget, team.initialBudget, 'no budget moved');
    });
    assert.equal(state.currentPlayer.name, 'Player Two', 'queue advanced');
    assert.equal(state.stats.unsoldCount, 1);
  });

  await t.test('only the current player can be marked unsold', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const later = seeded.players[2];
    const r = await app.post(`/api/players/${later.id}/unsold`);
    assert.equal(r.status, 409);
  });

  await t.test('cannot sell when the winning team has been archived', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const [alpha] = seeded.teams;

    await app.post('/api/bids', { teamId: alpha.id, amount: 60 });
    const archived = await app.del(`/api/teams/${alpha.id}`);
    assert.equal(archived.status, 200);
    assert.equal(archived.data.result.archived, true, 'a leader with a bid is archived, not deleted');
    assert.equal(archived.data.state.auction.currentBid, null, 'leading bid cleared');

    const r = await app.post('/api/sale');
    assert.equal(r.status, 409, 'no valid bid remains');
  });

  await t.test('sold player cannot be removed from the pool', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const [alpha] = seeded.teams;
    await app.post('/api/bids', { teamId: alpha.id, amount: 60 });
    await app.post('/api/sale');
    const sold = (await app.get('/api/state')).data.players.find(p => p.status === 'sold');
    const r = await app.del(`/api/players/${sold.id}`);
    assert.equal(r.status, 409);
  });

  await t.test('the current player cannot be removed, only unsold', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const seeded = await seededAuction(app);
    const r = await app.del(`/api/players/${seeded.players[0].id}`);
    assert.equal(r.status, 409);
  });
});
