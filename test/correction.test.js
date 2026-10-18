const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction } = require('./helpers');

test('sale correction workflow', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seed = await seededAuction(app);
  const [alpha, beta] = seed.teams;
  const [playerOne] = seed.players;

  let saleId = null;
  let winningBidId = null;

  await t.test('setup: sell Player One to Alpha', async () => {
    const bid = await app.post('/api/bids', { teamId: alpha.id, amount: 60 });
    assert.equal(bid.status, 200);
    winningBidId = bid.data.state.auction.currentBid.bidId;
    const sale = await app.post('/api/sale');
    assert.equal(sale.status, 200);
    const saleRec = sale.data.state.sales.at(-1);
    saleId = saleRec.id;
    assert.equal(saleRec.status, 'active');
    assert.equal(saleRec.teamId, alpha.id);
    assert.equal(sale.data.state.teams.find(t => t.id === alpha.id).remainingBudget, 40);
  });

  await t.test('correction requires explicit confirmation', async () => {
    const res = await app.post(`/api/sales/${saleId}/correct`, {});
    assert.equal(res.status, 400);
    const noBody = await app.post(`/api/sales/${saleId}/correct`);
    assert.equal(noBody.status, 400);
  });

  await t.test('correction is host-only', async () => {
    const res = await app.post(`/api/sales/${saleId}/correct`, { confirm: true }, null);
    assert.equal(res.status, 401);
  });

  await t.test('unknown sale id returns 404', async () => {
    const res = await app.post('/api/sales/sale_missing/correct', { confirm: true });
    assert.equal(res.status, 404);
  });

  await t.test('correcting a sale restores budget, player and audits the event', async () => {
    const res = await app.post(`/api/sales/${saleId}/correct`, { confirm: true });
    assert.equal(res.status, 200);

    const state = res.data.state;
    const sale = state.sales.find(s => s.id === saleId);
    assert.equal(sale.status, 'corrected');
    assert.ok(sale.correctedAt);

    const team = state.teams.find(t => t.id === alpha.id);
    assert.equal(team.remainingBudget, 100); // budget fully restored

    const player = state.players.find(p => p.id === playerOne.id);
    assert.equal(player.status, 'available');
    assert.equal(player.teamId, null);
    assert.equal(player.price, null);

    const evt = state.events.find(e => e.type === 'sale_corrected');
    assert.ok(evt, 'a sale_corrected event must be recorded');
    assert.equal(evt.data.saleId, saleId);

    const stats = state.stats;
    assert.equal(stats.totalSpent, 0);
    const alphaStats = stats.teams.find(t => t.id === alpha.id);
    assert.equal(alphaStats.spent, 0);
    assert.equal(alphaStats.playersBought, 0);

    // public snapshot agrees
    const snap = await app.get('/api/state');
    assert.equal(snap.data.stats.totalSpent, 0);
    const snapTeam = snap.data.teams.find(t => t.id === alpha.id);
    assert.equal(snapTeam.playersBought.length, 0);
  });

  await t.test('double correction is rejected with 409', async () => {
    const res = await app.post(`/api/sales/${saleId}/correct`, { confirm: true });
    assert.equal(res.status, 409);
  });

  await t.test('concurrent corrections: exactly one wins', async () => {
    const bid = await app.post('/api/bids', { teamId: beta.id, amount: 45 });
    assert.equal(bid.status, 200);
    const sale = await app.post('/api/sale');
    assert.equal(sale.status, 200);
    const id = sale.data.state.sales.at(-1).id;

    const results = await Promise.all([
      app.post(`/api/sales/${id}/correct`, { confirm: true }),
      app.post(`/api/sales/${id}/correct`, { confirm: true }),
      app.post(`/api/sales/${id}/correct`, { confirm: true }),
    ]);
    const statuses = results.map(r => r.status).sort();
    assert.deepEqual(statuses, [200, 409, 409]);

    // state is consistent: budget restored exactly once
    const snap = await app.get('/api/state');
    const betaTeam = snap.data.teams.find(t => t.id === beta.id);
    assert.equal(betaTeam.remainingBudget, 200);
    assert.equal(snap.data.stats.totalSpent, 0);
  });

  await t.test('corrected player re-enters the pool and can be sold again', async () => {
    // After the concurrent correction, advance() re-selected Player One
    // (lowest-order available player) as the current lot.
    const snap = await app.get('/api/state');
    const p1 = snap.data.players.find(p => p.id === playerOne.id);
    assert.equal(p1.status, 'in_progress');

    const bid = await app.post('/api/bids', { teamId: alpha.id, amount: 50 });
    assert.equal(bid.status, 200);
    const sale = await app.post('/api/sale');
    assert.equal(sale.status, 200);
    assert.equal(sale.data.state.sales.at(-1).playerId, playerOne.id);
    assert.equal(sale.data.state.sales.at(-1).teamId, alpha.id);
  });

  await t.test('corrections remain available after the auction concludes', async () => {
    const end = await app.post('/api/auction/conclude');
    assert.equal(end.status, 200);

    const snap = await app.get('/api/state');
    assert.equal(snap.data.auction.status, 'concluded');
    const active = snap.data.sales.filter(s => s.status !== 'corrected');
    assert.equal(active.length, 1, 'the re-sale of Player One is the only active sale');

    const res = await app.post(`/api/sales/${active[0].id}/correct`, { confirm: true });
    assert.equal(res.status, 200);
    const after = await app.get('/api/state');
    assert.equal(after.data.stats.totalSpent, 0);
    const p1 = after.data.players.find(p => p.id === playerOne.id);
    assert.equal(p1.status, 'available');
  });
});

test('correction during a paused auction', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seed = await seededAuction(app);
  const [alpha] = seed.teams;

  await app.post('/api/bids', { teamId: alpha.id, amount: 55 });
  const sale = await app.post('/api/sale');
  const saleId = sale.data.state.sales.at(-1).id;

  await app.post('/api/auction/pause');
  const res = await app.post(`/api/sales/${saleId}/correct`, { confirm: true });
  assert.equal(res.status, 200);
  const snap = await app.get('/api/state');
  assert.equal(snap.data.teams.find(t => t.id === alpha.id).remainingBudget, 100);
});

test('bid history is preserved by corrections', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seed = await seededAuction(app);
  const [alpha] = seed.teams;

  await app.post('/api/bids', { teamId: alpha.id, amount: 70 });
  const sale = await app.post('/api/sale');
  const saleId = sale.data.state.sales.at(-1).id;
  const bidsBefore = sale.data.state.recentBids.length;

  await app.post(`/api/sales/${saleId}/correct`, { confirm: true });
  const snap = await app.get('/api/state');
  assert.equal(snap.data.recentBids.length, bidsBefore, 'correction must not delete bid records');
  assert.equal(snap.data.recentBids.at(-1).amount, 70);
});
