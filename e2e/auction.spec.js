// Browser (Playwright/Chromium) workflow suite for the Sports Auction app.
// Serial by design: one authoritative server-side auction state machine.
// Covers the Phase 6 verification checklist: setup, start, participant join/bid,
// cross-session SSE updates, pause/resume, sale, correction, unsold, popups,
// conclusion accuracy, refresh/session recovery, SSE reconnect, authorization,
// console-error hygiene and responsive overflow checks.
const { test, expect } = require('@playwright/test');
const HOST_TOKEN = 'e2e-dev-token';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function acceptDialogs(page) {
  page.on('dialog', d => d.accept().catch(() => {}));
}

async function hostLogin(page) {
  await page.goto('/index.html');
  const modal = page.locator('#host-auth-modal');
  await expect(modal).toBeVisible();
  await page.fill('#host-token-input', HOST_TOKEN);
  await page.getByRole('button', { name: 'Unlock host controls' }).click();
  await expect(modal).toBeHidden();
}

async function addTeam(page, name, budget) {
  await page.fill('#teamNameInput', name);
  await page.fill('#teambudgetinput', String(budget));
  await page.click('#addteambdgt');
  await expect(page.locator('#teams-review')).toContainText(name);
}

async function addPlayer(page, name, category, basePrice) {
  await page.fill('#player-name', name);
  await page.selectOption('#playerCategory', category);
  await page.fill('#playerBasePrice', String(basePrice));
  await page.click('#add-player');
  await expect(page.locator('#players-review')).toContainText(name);
}

async function getCodeFor(page, teamName) {
  await page.click('#generate-codes');
  const meta = page.locator('#codes-review .review-item', { hasText: teamName })
    .first().locator('.review-meta');
  await expect(meta).toContainText(/code\s+[0-9a-f]{8}/);
  const text = await meta.textContent();
  const m = text && text.match(/code\s+([0-9a-f]{8})/i);
  if (!m) throw new Error(`No code found for ${teamName}: ${text}`);
  return m[1];
}

async function selectTeam(page, teamName) {
  const value = await page.evaluate(name => {
    const opt = [...document.querySelectorAll('#team-select option')]
      .find(o => o.textContent.startsWith(name));
    return opt ? opt.value : null;
  }, teamName);
  if (!value) throw new Error(`Team ${teamName} not in select`);
  await page.selectOption('#team-select', value);
}

// shared pages/contexts built up across serial tests
let hostPage;
let partPage;
let alphaCode;

// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  hostPage = await ctx.newPage();
  acceptDialogs(hostPage);
});

test.afterAll(async () => {
  if (hostPage) await hostPage.context().close();
});

// collected console/page errors per page, asserted clean at the end
const consoleErrors = [];
function watchErrors(page, label) {
  page.on('pageerror', e => consoleErrors.push(`${label}: pageerror: ${e.message}`));
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() !== 'error') return;
    if (text.includes('favicon')) return;
    if (/net::ERR|EventSource|Failed to load resource/.test(text)) return; // offline/network-churn noise
    consoleErrors.push(`${label}: console.error: ${text}`);
  });
}

// ---------------------------------------------------------------------------
// 1. SETUP
// ---------------------------------------------------------------------------
test('setup: host token modal, teams, players, readiness', async () => {
  watchErrors(hostPage, 'setup');
  await hostLogin(hostPage);
  await addTeam(hostPage, 'Alpha', 100);
  await addTeam(hostPage, 'Beta', 200);

  // invalid setup: no players -> cannot start
  await expect(hostPage.locator('#review-btn')).toBeDisabled();
  await expect(hostPage.locator('#readiness')).toContainText('Cannot start yet');

  await addPlayer(hostPage, 'Star', 'Batsman', 50);
  await addPlayer(hostPage, 'Swing', 'Bowler', 40);
  await addPlayer(hostPage, 'Reserve', 'All-Rounder', 30);

  await expect(hostPage.locator('#review-btn')).toBeEnabled();
  await expect(hostPage.locator('#readiness')).toContainText('Setup complete');
});

test('setup: participant codes are host-only and visible to the host', async () => {
  // public snapshot must not leak codes
  const state = await hostPage.evaluate(async () => {
    const r = await fetch('/api/state');
    return r.json();
  });
  const snapshot = JSON.stringify(state);
  alphaCode = await getCodeFor(hostPage, 'Alpha');
  expect(snapshot).not.toContain(alphaCode);
  for (const t of state.teams) expect(t.participantCode).toBeUndefined();
  await getCodeFor(hostPage, 'Beta');
});

// ---------------------------------------------------------------------------
// 2. START
// ---------------------------------------------------------------------------
test('host starts the auction and lands on the live console', async () => {
  await hostPage.click('#review-btn');
  const confirmBtn = hostPage.getByRole('button', { name: /Confirm/ });
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();
  await hostPage.waitForURL('**/live.html');
  await expect(hostPage.locator('#auction-status')).toContainText('LIVE');
  await expect(hostPage.locator('#auction-player-name')).toHaveText('Star');
});

// ---------------------------------------------------------------------------
// 3. PARTICIPANT JOIN
// ---------------------------------------------------------------------------
test('invalid participant code produces useful feedback', async ({ browser }) => {
  const ctx = await browser.newContext();
  partPage = await ctx.newPage();
  watchErrors(partPage, 'participant');
  await partPage.goto('/view.html');
  await partPage.fill('#join-code', 'definitely-not-a-code');
  await partPage.click('#join-form button[type=submit]');
  await expect(partPage.locator('#identity-msg')).toContainText(/not valid/i);
  await expect(partPage.locator('#team-panel')).toBeHidden();
});

test('participant joins with a valid team code', async () => {
  await partPage.fill('#join-code', alphaCode);
  await partPage.click('#join-form button[type=submit]');
  await expect(partPage.locator('#identity-msg')).toContainText('Joined as Alpha');
  await expect(partPage.locator('#joined-team')).toHaveText('Alpha');
  await expect(partPage.locator('#joined-budget')).toHaveText('₹100');
});

// ---------------------------------------------------------------------------
// 4. BIDDING + LIVE CROSS-SESSION UPDATES
// ---------------------------------------------------------------------------
test('participant bid is accepted and visible on the host console via SSE', async () => {
  await expect(partPage.locator('#bid-input')).toHaveAttribute('min', '50');
  await partPage.fill('#bid-input', '50');
  await partPage.click('#bid-btn');
  await expect(partPage.locator('#identity-msg')).toContainText('Bid of ₹50 placed');

  // host console updates without a reload (SSE)
  await expect(hostPage.locator('#highest-bid')).toHaveText('50');
  await expect(hostPage.locator('#leading-team')).toHaveText('Alpha');
  await expect(hostPage.locator('#lot-bid')).toHaveText('₹50');
});

test('host bid from a second session reaches the participant via SSE', async () => {
  await selectTeam(hostPage, 'Beta');
  await hostPage.fill('#bid-amount', '70');
  await hostPage.click('#place-bid');
  await expect(hostPage.locator('#highest-bid')).toHaveText('70');
  await expect(partPage.locator('#lot-bid')).toHaveText('₹70');
  await expect(partPage.locator('#lot-team')).toHaveText('Beta');
});

test('invalid and unaffordable bids are rejected with inline feedback', async () => {
  // below minimum (required is 80)
  await partPage.fill('#bid-input', '75');
  await partPage.click('#bid-btn');
  await expect(partPage.locator('#identity-msg')).toContainText(/Bid must be at least/);
  // over Alpha's remaining budget (100)
  await partPage.fill('#bid-input', '150');
  await partPage.click('#bid-btn');
  await expect(partPage.locator('#identity-msg')).toContainText(/enough remaining budget/);
});

test('SSE disconnect and reconnect recover the latest state', async () => {
  await partPage.context().setOffline(true);
  await selectTeam(hostPage, 'Beta');
  await hostPage.fill('#bid-amount', '90');
  await hostPage.click('#place-bid');
  await partPage.context().setOffline(false);
  // EventSource auto-reconnect delivers the newest snapshot
  await expect(partPage.locator('#lot-bid')).toHaveText('₹90', { timeout: 20000 });
});

test('refresh restores the participant session and current state', async () => {
  await partPage.reload();
  await expect(partPage.locator('#team-panel')).toBeVisible();
  await expect(partPage.locator('#joined-team')).toHaveText('Alpha');
  await expect(partPage.locator('#lot-bid')).toHaveText('₹90');
});

// ---------------------------------------------------------------------------
// 5. PAUSE / RESUME
// ---------------------------------------------------------------------------
test('host can pause (bids rejected) and resume', async () => {
  await hostPage.click('#pause-btn');
  await expect(hostPage.locator('#auction-status')).toContainText('PAUSED');

  // participant UI disables bidding and explains why
  await expect(partPage.locator('#bid-btn')).toBeDisabled();
  await expect(partPage.locator('#bid-hint')).toContainText('Bidding is closed right now');
  // even a forced request is rejected server-side while paused
  const pausedStatus = await partPage.evaluate(async () => {
    const token = sessionStorage.getItem('auctionParticipantToken');
    const r = await fetch('/api/participant/bids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-participant-token': token || '' },
      body: JSON.stringify({ amount: 95 }),
    });
    return r.status;
  });
  expect(pausedStatus).toBe(409);

  await hostPage.click('#pause-btn'); // resume
  await expect(hostPage.locator('#auction-status')).toContainText('LIVE');
  // participant console sees LIVE again via SSE
  await expect(partPage.locator('#auction-status')).toContainText('LIVE');
  await expect(partPage.locator('#bid-btn')).toBeEnabled();
});

// ---------------------------------------------------------------------------
// 6. SALE, CORRECTION, UNSOLD
// ---------------------------------------------------------------------------
test('host sells the current lot; budget is deducted exactly once', async () => {
  // winning bid at this point: Beta 90
  await hostPage.click('#sell-player'); // dialog auto-accepted
  await expect(hostPage.locator('#sold-players')).toContainText('Star');
  await expect(hostPage.locator('#sold-players')).toContainText('Beta');
  await expect(hostPage.locator('#sold-players')).toContainText('₹90');
  await expect(hostPage.locator('#teams-list')).toContainText('Remaining: ₹110'); // 200-90
  await expect(hostPage.locator('#auction-player-name')).toHaveText('Swing'); // queue advanced
  await hostPage.screenshot({ path: 'test-results/live-after-sale.png', fullPage: true });
});

test('sale correction restores budget, player and audit state', async () => {
  const undo = hostPage.locator('#sold-players tr', { hasText: 'Star' }).getByRole('button', { name: 'Undo' });
  await undo.click(); // confirm dialog auto-accepted
  await expect(hostPage.locator('#sold-players')).toContainText('corrected');
  await expect(hostPage.locator('#teams-list')).toContainText('Remaining: ₹200'); // restored
  // corrected row no longer offers Undo
  const correctedRow = hostPage.locator('#sold-players tr', { hasText: 'corrected' });
  await expect(correctedRow.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  // player is available again in the pool
  await expect(hostPage.locator('.player-card', { hasText: 'Star' })).toContainText('available');
});

test('participant bids on the next lot; host sells it', async () => {
  await partPage.fill('#bid-input', '45');
  await partPage.click('#bid-btn');
  await expect(partPage.locator('#identity-msg')).toContainText('Bid of ₹45 placed');
  await hostPage.click('#sell-player');
  await expect(hostPage.locator('#sold-players')).toContainText('Swing');
  await expect(hostPage.locator('#teams-list')).toContainText('Remaining: ₹55'); // Alpha 100-45
});

test('host marks a player unsold without deducting budget', async () => {
  await expect(hostPage.locator('#auction-player-name')).toHaveText('Reserve');
  await hostPage.click('#unsold-player'); // confirm auto-accepted
  await expect(hostPage.locator('#unsold-players')).toContainText('Reserve');
  await expect(hostPage.locator('#teams-list')).toContainText('Remaining: ₹55'); // unchanged
});

// ---------------------------------------------------------------------------
// 7. TEAM POPUP RULES
// ---------------------------------------------------------------------------
test('team card opens the team-details popup with server-backed data', async () => {
  const alphaCard = hostPage.locator('.team-card', { hasText: 'Alpha' }).first();
  await alphaCard.click();
  await expect(hostPage.locator('#info-popup')).toBeVisible();
  await expect(hostPage.locator('#popup-title')).toHaveText('Alpha');
  await expect(hostPage.locator('#popup-subtitle')).toContainText('Initial ₹100');
  await expect(hostPage.locator('#popup-subtitle')).toContainText('Remaining ₹55');
  await expect(hostPage.locator('#popup-list')).toContainText('Swing');
  await expect(hostPage.locator('#popup-list')).toContainText('Bowler');
  await expect(hostPage.locator('#popup-list')).toContainText('₹45');
  await hostPage.keyboard.press('Escape');
  await expect(hostPage.locator('#info-popup')).toBeHidden();
});

test('clicking a player never opens a popup', async () => {
  await hostPage.locator('.player-card', { hasText: 'Reserve' }).first().click();
  await expect(hostPage.locator('#info-popup')).toBeHidden();
});

test('buttons inside team cards do not trigger the parent popup', async () => {
  const betaCard = hostPage.locator('.team-card', { hasText: 'Beta' }).first();
  await betaCard.locator('.remove-team-btn').click(); // opens confirm -> dismissed
  await expect(hostPage.locator('#info-popup')).toBeHidden();
});

// ---------------------------------------------------------------------------
// 8. AUTHORIZATION FROM THE BROWSER
// ---------------------------------------------------------------------------
test('host endpoints stay protected; no secrets leak into the participant page', async () => {
  const result = await partPage.evaluate(async () => {
    const r = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-host-token': 'guessed' },
      body: JSON.stringify({ name: 'Sneaky', budget: 5 }),
    });
    return r.status;
  });
  expect(result).toBe(401);
  const html = await partPage.content();
  expect(html).not.toContain(HOST_TOKEN);
  // participant UI has no host console controls
  await expect(partPage.locator('#sell-player')).toHaveCount(0);
  await expect(partPage.locator('#end-auction-btn')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 9. CONCLUSION ACCURACY
// ---------------------------------------------------------------------------
test('conclusion page matches authoritative server state', async () => {
  await hostPage.click('#end-auction-btn'); // confirm auto-accepted
  await hostPage.waitForURL('**/conclusion.html');
  watchErrors(hostPage, 'conclusion');

  const state = await hostPage.evaluate(async () => (await fetch('/api/state')).json());

  // stat cards
  const stats = hostPage.locator('#stats');
  await expect(stats).toContainText('Registered players');
  expect(state.stats.soldCount).toBe(1); // Swing only; Star correction excluded
  expect(state.stats.unsoldCount).toBe(1); // Reserve
  expect(state.stats.totalSpent).toBe(45);
  await expect(stats).toContainText(String(state.stats.soldCount));
  await expect(stats).toContainText('₹45');

  // team summary + corrected exclusion
  const summary = hostPage.locator('#summary');
  await expect(summary).toContainText('Alpha');
  await expect(summary).toContainText('Remaining: ₹55');
  await expect(summary).toContainText('Swing');
  await expect(summary).toContainText('₹45');
  await expect(summary.locator('.team-summary', { hasText: 'Beta' })).toContainText('No players bought');

  // sold table excludes corrected rows but notes them
  const soldRows = hostPage.locator('#sold-list tr');
  await expect(soldRows.filter({ hasText: 'Swing' })).toHaveCount(1);
  await expect(soldRows.filter({ hasText: 'Star' })).toHaveCount(0);
  await expect(soldRows).toContainText('corrected sale(s) excluded');
  await expect(hostPage.locator('#unsold-players')).toContainText('Reserve');
  await hostPage.screenshot({ path: 'test-results/conclusion.png', fullPage: true });
});

// ---------------------------------------------------------------------------
// 10. RESPONSEIVE + CONSOLE HYGIENE
// ---------------------------------------------------------------------------
for (const vp of [
  { width: 1440, height: 900, label: 'desktop' },
  { width: 1280, height: 800, label: 'laptop' },
  { width: 768, height: 1024, label: 'tablet' },
  { width: 390, height: 844, label: 'mobile' },
]) {
  test(`no horizontal overflow at ${vp.label} ${vp.width}x${vp.height}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    for (const path of ['/index.html', '/live.html', '/view.html', '/conclusion.html']) {
      await page.goto(path);
      await page.waitForLoadState('load');
      // SSE keeps a connection open, so wait a beat for JS layout instead of networkidle
      await page.waitForTimeout(800);
      const over = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      expect(over.scrollW, `${path} at ${vp.label}`).toBeLessThanOrEqual(over.innerW + 1);
    }
    await ctx.close();
  });
}

test('no uncaught console errors across the visited pages', async () => {
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
