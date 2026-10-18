const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');

const LEGACY = {
  teams: [
    { name: 'Legacy Warriors', budget: 500 },
    { name: 'Legacy Kings', budget: 750 },
    { name: '', budget: 100 },        // invalid, skipped
    { name: 'Bad Budget', budget: 0 }, // invalid, skipped
  ],
  players: [
    { name: 'Old Star', type: 'Batsman', image: 'data:image/png;base64,AAAA' },
    { name: 'Old Bowler', type: 'Wicket Keeper', image: 'not-a-data-url' },
    { name: 'Old All', type: 'All-Rounder', image: null },
    { name: '', type: 'Batsman' }, // invalid, skipped
  ],
};

test('legacy localStorage migration path', async t => {
  await t.test('imports browser-era teams and players with mapped fields', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    const r = await app.post('/api/import-legacy', LEGACY);
    assert.equal(r.status, 200);
    assert.equal(r.data.result.importedTeams, 2, 'invalid legacy rows skipped');
    assert.equal(r.data.result.importedPlayers, 3);

    const state = r.data.state;
    const warrior = state.teams.find(t => t.name === 'Legacy Warriors');
    assert.equal(warrior.initialBudget, 500);
    assert.equal(warrior.remainingBudget, 500);
    assert.ok(warrior.id.startsWith('team_'), 'stable identifier assigned');

    const keeper = state.players.find(p => p.name === 'Old Bowler');
    assert.equal(keeper.category, 'Wicket-Keeper', 'legacy category names mapped');
    assert.equal(keeper.basePrice, 0, 'legacy players default to base price 0');
    assert.equal(keeper.status, 'available');
    assert.equal(keeper.image === undefined, true, 'public snapshot never exposes list images');

    // Authoritative store keeps the valid image and drops invalid ones.
    const stored = app.store.snapshot().players;
    const storedKeeper = stored.find(p => p.name === 'Old Bowler');
    assert.equal(storedKeeper.image, null, 'invalid image reference dropped, player kept');
    const storedStar = stored.find(p => p.name === 'Old Star');
    assert.equal(storedStar.image, 'data:image/png;base64,AAAA', 'valid image preserved');
  });

  await t.test('re-running the import does not create duplicates', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    await app.post('/api/import-legacy', LEGACY);
    const again = await app.post('/api/import-legacy', LEGACY);
    assert.equal(again.status, 200);
    assert.equal(again.data.result.importedTeams, 0);
    assert.equal(again.data.result.importedPlayers, 0);
    assert.equal(again.data.state.teams.length, 2);
    assert.equal(again.data.state.players.length, 3);
  });

  await t.test('import is rejected once the auction has started', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    await app.post('/api/teams', { name: 'T', budget: 100 });
    await app.post('/api/players', { name: 'P', category: 'Bowler', basePrice: 1 });
    await app.post('/api/auction/start');
    const r = await app.post('/api/import-legacy', LEGACY);
    assert.equal(r.status, 409);
  });

  await t.test('import requires the host token', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const r = await app.post('/api/import-legacy', LEGACY, null);
    assert.equal(r.status, 401);
  });

  await t.test('import rejects a payload with no legacy arrays', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    const r = await app.post('/api/import-legacy', { nope: true });
    assert.equal(r.status, 400);
  });

  await t.test('migrated auction can be started and settled normally', async () => {
    const app = await startTestApp();
    t.after(() => app.close());
    await app.post('/api/import-legacy', LEGACY);
    const start = await app.post('/api/auction/start');
    assert.equal(start.status, 200);

    const state = start.data.state;
    const leader = state.teams[0];
    await app.post('/api/bids', { teamId: leader.id, amount: 25 });
    const sale = await app.post('/api/sale');
    assert.equal(sale.status, 200);
    assert.equal(sale.data.state.teams.find(t => t.id === leader.id).remainingBudget, 475);
  });
});
