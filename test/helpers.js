const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const TEST_TOKEN = 'test-host-token-123';

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auction-test-'));
}

async function startTestApp(options = {}) {
  const ownDataDir = !options.dataDir;
  const dataDir = options.dataDir || makeDataDir();
  const config = loadConfig({
    port: 0,
    hostToken: options.hostToken !== undefined ? options.hostToken : TEST_TOKEN,
    dataDir,
    authMaxFailures: options.authMaxFailures,
    authWindowMs: options.authWindowMs,
    authLockMs: options.authLockMs,
    heartbeatMs: options.heartbeatMs,
  });

  const created = await createApp(config);
  const server = created.app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function parse(res) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data };
  }

  function get(p) {
    return fetch(base + p).then(parse);
  }

  function host(method, p, body, token = TEST_TOKEN) {
    const headers = { 'Content-Type': 'application/json' };
    if (token !== null) headers['x-host-token'] = token;
    return fetch(base + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(parse);
  }

  function participant(method, p, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-participant-token'] = token;
    return fetch(base + p, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(parse);
  }

  return {
    base,
    dataDir,
    config,
    store: created.store,
    hub: created.hub,
    sessions: created.sessions,
    server,
    get,
    host,
    post: (p, body, token) => host('POST', p, body, token),
    patch: (p, body, token) => host('PATCH', p, body, token),
    del: (p, token) => host('DELETE', p, undefined, token),
    participant,
    ppost: (p, body, token) => participant('POST', p, body, token),
    pget: (p, token) => participant('GET', p, undefined, token),
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (ownDataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Standard scenario used by several suites.
async function seededAuction(app, { increment = 10 } = {}) {
  const A = app;
  const t1 = await A.post('/api/teams', { name: 'Alpha', budget: 100 });
  const t2 = await A.post('/api/teams', { name: 'Beta', budget: 200 });
  const t3 = await A.post('/api/teams', { name: 'Gamma', budget: 300 });
  const p1 = await A.post('/api/players', { name: 'Player One', category: 'Batsman', basePrice: 50 });
  const p2 = await A.post('/api/players', { name: 'Player Two', category: 'Bowler', basePrice: 40 });
  const p3 = await A.post('/api/players', { name: 'Player Three', category: 'All-Rounder', basePrice: 30 });
  await A.post('/api/auction/config', { bidIncrement: increment });
  const start = await A.post('/api/auction/start');
  return {
    teams: [t1.data.result, t2.data.result, t3.data.result],
    players: [p1.data.result, p2.data.result, p3.data.result],
    start,
  };
}

module.exports = { startTestApp, seededAuction, makeDataDir, TEST_TOKEN };
