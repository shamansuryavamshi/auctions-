const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction } = require('./helpers');

// Regression suite for audit P0 #2: team removal must never change
// which team receives a player or pays for it (no positional references).
test('P0 regression: team identity is stable after removal/archival', async t => {
  const app = await startTestApp();
  t.after(() => app.close());
  const seeded = await seededAuction(app);
  const [alpha, beta, gamma] = seeded.teams;

  const state0 = (await app.get('/api/state')).data;
  assert.equal(state0.teams[0].id, alpha.id, 'ids are stable identifiers');

  await t.test('removing an earlier team does not redirect the sale', async () => {
    // Alpha is first in the array; Gamma (third) is the current leader.
    const r1 = await app.post('/api/bids', { teamId: gamma.id, amount: 100 });
    assert.equal(r1.status, 200);

    // Remove the team that sits BEFORE the leader in the array (the old
    // index-based code would shift the leader's slot).
    const rm = await app.del(`/api/teams/${alpha.id}`);
    assert.equal(rm.status, 200);
    assert.equal(rm.data.result.archived, true, 'mid-auction removal archives instead of deleting');

    const sale = await app.post('/api/sale');
    assert.equal(sale.status, 200);

    const state = sale.data.state;
    const sold = state.players.find(p => p.name === 'Player One');
    assert.equal(sold.teamId, gamma.id, 'sale credited to Gamma by id, not by position');

    const g = state.teams.find(t => t.id === gamma.id);
    const b = state.teams.find(t => t.id === beta.id);
    const a = state.teams.find(t => t.id === alpha.id);
    assert.equal(g.remainingBudget, 300 - 100, 'only Gamma paid');
    assert.equal(b.remainingBudget, 200, 'Beta untouched');
    assert.equal(a.status, 'archived', 'Alpha archived, retained for audit');
    assert.equal(a.remainingBudget, 100, 'Alpha budget untouched');
  });

  await t.test('a team with purchases is archived, never deleted', async () => {
    // Gamma now owns a player, so removal must archive.
    const rm = await app.del(`/api/teams/${gamma.id}`);
    assert.equal(rm.status, 200);
    assert.equal(rm.data.result.archived, true);

    const state = rm.data.state;
    const g = state.teams.find(t => t.id === gamma.id);
    assert.ok(g, 'archived team still present with its history');
    assert.equal(g.status, 'archived');
    assert.equal(g.playersBought.length, 1, 'purchase history intact');
    assert.equal(g.remainingBudget, 200);

    const again = await app.del(`/api/teams/${gamma.id}`);
    assert.equal(again.status, 409, 'cannot archive twice');

    const archivedBid = await app.post('/api/bids', { teamId: gamma.id, amount: 50 });
    assert.equal(archivedBid.status, 409, 'archived team cannot bid');
  });

  await t.test('sale proceeds correctly after a mid-auction removal of an unpurchased team', async () => {
    const app2 = await startTestApp();
    try {
      const s = await seededAuction(app2);
      const [a1, a2, a3] = s.teams;

      await app2.post('/api/bids', { teamId: a2.id, amount: 70 });
      const rm = await app2.del(`/api/teams/${a1.id}`);
      assert.equal(rm.data.result.archived, true, 'mid-auction removal always archives');

      const sale = await app2.post('/api/sale');
      assert.equal(sale.status, 200);
      const state = sale.data.state;
      assert.equal(state.teams.find(t => t.id === a2.id).remainingBudget, 200 - 70);
      assert.equal(state.teams.find(t => t.id === a3.id).remainingBudget, 300);
    } finally {
      await app2.close();
    }
  });

  void beta;
});
