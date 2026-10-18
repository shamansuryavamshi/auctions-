const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');

test('final auction statistics are derived from authoritative records', async t => {
  const app = await startTestApp();
  t.after(() => app.close());

  await app.post('/api/teams', { name: 'Alpha', budget: 100 });
  await app.post('/api/teams', { name: 'Beta', budget: 200 });
  await app.post('/api/players', { name: 'Sachin', category: 'Batsman', basePrice: 50 });
  await app.post('/api/players', { name: 'Bumrah', category: 'Bowler', basePrice: 40 });
  await app.post('/api/players', { name: 'Kapil', category: 'All-Rounder', basePrice: 30 });
  await app.post('/api/auction/config', { bidIncrement: 10 });
  await app.post('/api/auction/start');

  const state1 = (await app.get('/api/state')).data;
  const alpha = state1.teams[0];
  const beta = state1.teams[1];

  // lot 1: Sachin -> Alpha for 60
  await app.post('/api/bids', { teamId: alpha.id, amount: 60 });
  await app.post('/api/sale');

  // lot 2: Bumrah -> Beta for 70
  await app.post('/api/bids', { teamId: beta.id, amount: 70 });
  await app.post('/api/sale');

  // lot 3: Kapil unsold
  const state2 = (await app.get('/api/state')).data;
  await app.post(`/api/players/${state2.currentPlayer.id}/unsold`);

  const concluded = await app.post('/api/auction/conclude');
  assert.equal(concluded.status, 200);

  const final = (await app.get('/api/state')).data;
  const s = final.stats;

  assert.equal(final.auction.status, 'concluded');
  assert.equal(s.totalPlayers, 3);
  assert.equal(s.soldCount, 2);
  assert.equal(s.unsoldCount, 1);
  assert.equal(s.availableCount, 0);
  assert.equal(s.inProgressCount, 0);
  assert.equal(s.totalSpent, 130, '60 + 70');

  const fa = s.teams.find(t => t.name === 'Alpha');
  const fb = s.teams.find(t => t.name === 'Beta');
  assert.equal(fa.initialBudget, 100);
  assert.equal(fa.remainingBudget, 40);
  assert.equal(fa.spent, 60);
  assert.equal(fa.utilization, 60);
  assert.equal(fa.playersBought, 1);

  assert.equal(fb.initialBudget, 200);
  assert.equal(fb.remainingBudget, 130);
  assert.equal(fb.spent, 70);
  assert.equal(fb.utilization, 35);
  assert.equal(fb.playersBought, 1);

  // ownership + category assignments
  const sachin = final.players.find(p => p.name === 'Sachin');
  assert.equal(sachin.status, 'sold');
  assert.equal(sachin.teamId, alpha.id);
  assert.equal(sachin.price, 60);
  assert.equal(sachin.category, 'Batsman', 'category preserved through the sale');

  const kapil = final.players.find(p => p.name === 'Kapil');
  assert.equal(kapil.status, 'unsold');
  assert.equal(kapil.teamId, null, 'unsold player is not owned');
  assert.equal(kapil.price, null);

  // purchases listed with price and category
  assert.equal(final.teams.find(t => t.id === alpha.id).playersBought[0].name, 'Sachin');
  assert.equal(final.teams.find(t => t.id === alpha.id).playersBought[0].category, 'Batsman');
  assert.equal(final.teams.find(t => t.id === alpha.id).playersBought[0].price, 60);

  // conclusion data equals a recomputation from raw records
  const rawSpent = final.sales.reduce((sum, x) => sum + x.price, 0);
  assert.equal(s.totalSpent, rawSpent);
  final.stats.teams.forEach(t => {
    const raw = final.sales.filter(x => x.teamId === t.id).reduce((sum, x) => sum + x.price, 0);
    assert.equal(t.spent, raw);
    assert.equal(t.remainingBudget, t.initialBudget - raw);
  });

  await t.test('concluding with a player still on the block resolves them as unsold', async () => {
    const app2 = await startTestApp();
    try {
      await app2.post('/api/teams', { name: 'T', budget: 100 });
      await app2.post('/api/players', { name: 'Pending', category: 'Bowler', basePrice: 5 });
      await app2.post('/api/auction/start');
      const r = await app2.post('/api/auction/conclude');
      assert.equal(r.status, 200);
      assert.equal(r.data.state.players[0].status, 'unsold');
      assert.equal(r.data.state.stats.unsoldCount, 1);
      assert.equal(r.data.state.stats.totalSpent, 0);
    } finally {
      await app2.close();
    }
  });
});
