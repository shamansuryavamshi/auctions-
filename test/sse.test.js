const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, seededAuction, TEST_TOKEN } = require('./helpers');

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Broadcasts are one frame per commit, so clients may need to step past
// intermediate frames to reach the state they are waiting for.
async function waitFor(sse, predicate, message, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(message);
    const frame = await withTimeout(sse.next(), remaining, message);
    if (frame.type === 'snapshot' && predicate(frame.data)) return frame.data;
  }
}

function sseReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  return {
    async next() {
      for (;;) {
        const idx = buf.indexOf('\n\n');
        if (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith(':')) continue; // heartbeat comment
          const lines = frame.split('\n');
          const ev = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));
          if (ev && ev.includes('snapshot') && dataLine) {
            return { type: 'snapshot', data: JSON.parse(dataLine.slice(5).trim()) };
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return { type: 'eof' };
        buf += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

test('server-sent events', async t => {
  await t.test('clients receive an initial authoritative snapshot, then updates', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    const res = await fetch(`${app.base}/api/events`);
    const sse = sseReader(res);

    const first = await withTimeout(sse.next(), 3000, 'no initial snapshot');
    assert.equal(first.type, 'snapshot');
    assert.equal(first.data.sequence, 0);
    assert.equal(first.data.auction.status, 'setup');
    assert.deepEqual(first.data.teams, []);

    const seeded = await seededAuction(app);

    const live = await waitFor(sse, d => d.auction.status === 'live', 'auction never reached live');
    assert.ok(live.sequence > first.data.sequence, 'sequence advances on commit');
    assert.equal(live.teams.length, 3);
    assert.equal(live.currentPlayer.name, 'Player One', 'snapshot carries the current lot');

    await app.post('/api/bids', { teamId: seeded.teams[0].id, amount: 55 });
    const bidState = await waitFor(sse, d => d.auction.currentBid && d.auction.currentBid.amount === 55, 'bid never broadcast');
    assert.equal(bidState.auction.currentBid.teamName, 'Alpha', 'leading team name included');

    await sse.cancel();
  });

  await t.test('two connected clients observe the same state', async () => {
    const app = await startTestApp();
    t.after(() => app.close());

    const r1 = await fetch(`${app.base}/api/events`);
    const r2 = await fetch(`${app.base}/api/events`);
    const a = sseReader(r1);
    const b = sseReader(r2);
    await withTimeout(a.next(), 3000, 'client A initial timeout');
    await withTimeout(b.next(), 3000, 'client B initial timeout');

    await app.post('/api/teams', { name: 'Broadcast', budget: 10 });
    const snapA = await withTimeout(a.next(), 3000, 'client A update timeout');
    const snapB = await withTimeout(b.next(), 3000, 'client B update timeout');
    assert.equal(snapA.data.sequence, snapB.data.sequence, 'identical version for both clients');
    assert.ok(snapA.data.teams.some(t => t.name === 'Broadcast'));

    await a.cancel();
    await b.cancel();
  });

  await t.test('heartbeats keep the connection alive', async () => {
    const app = await startTestApp({ heartbeatMs: 50 });
    t.after(() => app.close());

    const res = await fetch(`${app.base}/api/events`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const started = Date.now();
    let sawHeartbeat = false;
    while (Date.now() - started < 3000 && !sawHeartbeat) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes(': hb')) sawHeartbeat = true;
    }
    await reader.cancel();
    assert.equal(sawHeartbeat, true, 'heartbeat comment received');
  });

  void TEST_TOKEN;
});
