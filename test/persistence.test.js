const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestApp, seededAuction, makeDataDir } = require('./helpers');

test('persistence and data integrity', async t => {
  await t.test('state survives a server restart', async () => {
    const dataDir = makeDataDir();
    const app1 = await startTestApp({ dataDir });
    const seeded = await seededAuction(app1);
    await app1.post('/api/bids', { teamId: seeded.teams[0].id, amount: 75 });
    await app1.post('/api/sale');
    const before = (await app1.get('/api/state')).data;
    await app1.close();

    const app2 = await startTestApp({ dataDir });
    try {
      const after = (await app2.get('/api/state')).data;
      assert.equal(after.auction.status, before.auction.status);
      assert.equal(after.sales.length, 1);
      assert.equal(after.sales[0].price, 75);
      assert.equal(after.currentPlayer.name, 'Player Two', 'queue position preserved');
      const alpha = after.teams.find(t => t.name === 'Alpha');
      assert.equal(alpha.remainingBudget, 25, 'deduction survived restart');
      assert.equal(after.auction.sequence, before.auction.sequence, 'sequence preserved');
    } finally {
      await app2.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('a malformed main file is recovered from the last valid backup, nothing is reset', async () => {
    const dataDir = makeDataDir();
    const app1 = await startTestApp({ dataDir });
    await app1.post('/api/teams', { name: 'Keeper', budget: 555 });
    await app1.close();

    const file = path.join(dataDir, 'auction.json');
    const bak = path.join(dataDir, 'auction.json.bak');
    assert.ok(fs.existsSync(bak), 'backup exists after boot');
    fs.writeFileSync(file, '{ this is not json !!!', 'utf8');

    const app2 = await startTestApp({ dataDir });
    try {
      const state = (await app2.get('/api/state')).data;
      assert.ok(state.teams.some(t => t.name === 'Keeper'), 'data restored, not wiped');
      const corruptCopies = fs.readdirSync(dataDir).filter(f => f.includes('corrupt-'));
      assert.ok(corruptCopies.length >= 1, 'malformed file preserved for inspection');
    } finally {
      await app2.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  await t.test('a malformed file with no backup refuses to start instead of silently resetting', async () => {
    const dataDir = makeDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'auction.json');
    fs.writeFileSync(file, 'garbage', 'utf8');

    const { loadConfig } = require('../src/config');
    const { createApp } = require('../src/app');
    const config = loadConfig({ hostToken: 't', dataDir });

    await assert.rejects(() => createApp(config), /malformed/i, 'startup fails loudly');
    assert.equal(fs.readFileSync(file, 'utf8'), 'garbage', 'original file untouched');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await t.test('writes are serialized (concurrent mutations all land intact)', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    const adds = [];
    for (let i = 0; i < 8; i++) {
      adds.push(app.post('/api/teams', { name: `Concurrent ${i}`, budget: 100 + i }));
    }
    const results = await Promise.all(adds);
    results.forEach(r => assert.equal(r.status, 200));

    const state = (await app.get('/api/state')).data;
    assert.equal(state.teams.length, 8, 'no lost updates');

    const onDisk = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'auction.json'), 'utf8'));
    assert.equal(onDisk.teams.length, 8, 'file matches memory');
    assert.equal(onDisk.auction.sequence, 8, 'one sequence bump per commit');
  });
});
