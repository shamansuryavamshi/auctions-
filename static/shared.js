/* Shared client-side auction engine: state, storage, cross-tab sync, helpers. */
(function () {
  const STATE_KEY = 'auctionStateV1';
  const CHANNEL_NAME = 'auction-sync-v1';
  const PASS_KEY = 'auctionHostPass';
  const PARTICIPANT_KEY = 'auctionParticipantTeam';
  const EVENT_CAP = 300;

  const uid = p => p + '_' + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
  const money = n => '₹' + (Number(n) || 0).toLocaleString('en-IN');
  const code8 = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function freshState() {
    return {
      version: 1,
      auction: {
        status: 'setup',
        currentPlayerId: null,
        currentBid: null,
        bidIncrement: 10,
        sequence: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        pausedAt: null,
        concludedAt: null,
      },
      teams: [],
      players: [],
      bids: [],
      sales: [],
      events: [],
    };
  }

  function validShape(s) {
    return Boolean(s && s.version === 1 && s.auction && Array.isArray(s.teams) &&
      Array.isArray(s.players) && Array.isArray(s.bids) &&
      Array.isArray(s.sales) && Array.isArray(s.events));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      return validShape(parsed) ? parsed : freshState();
    } catch { return freshState(); }
  }

  let state = loadState();
  const listeners = [];
  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = e => {
      if (e.data && e.data.type === 'state' && validShape(e.data.state)) {
        state = e.data.state;
        notify();
      }
    };
  } catch { /* BroadcastChannel unsupported; storage events still sync */ }

  window.addEventListener('storage', e => {
    if (e.key !== STATE_KEY || !e.newValue) return;
    try {
      const s = JSON.parse(e.newValue);
      if (validShape(s)) { state = s; notify(); }
    } catch { /* ignore malformed */ }
  });

  function notify() { listeners.forEach(fn => { try { fn(state); } catch (err) { console.error(err); } }); }
  function subscribe(fn) { listeners.push(fn); fn(state); }

  function persist() {
    state.auction.sequence += 1;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      throw new Error('Could not save: browser storage is full. Use smaller player images, or export your data and reset.');
    }
    if (channel) channel.postMessage({ type: 'state', state });
  }

  function mutate(fn) {
    fn(state);
    try { persist(); } catch (err) { notify(); throw err; }
    notify();
  }

  function log(text, type = 'info') {
    state.events.unshift({ at: new Date().toISOString(), text, type });
    if (state.events.length > EVENT_CAP) state.events.length = EVENT_CAP;
  }

  // ---------- lookups & rules ----------
  const teamById = id => state.teams.find(t => t.id === id) || null;
  const playerById = id => state.players.find(p => p.id === id) || null;
  const currentPlayer = () => (state.auction.currentPlayerId ? playerById(state.auction.currentPlayerId) : null);
  const activeSales = () => state.sales.filter(s => s.status === 'active');
  const activeTeams = () => state.teams.filter(t => t.status === 'active');
  const availablePlayers = () => state.players.filter(p => p.status === 'available');

  function minBidAmount() {
    const p = currentPlayer();
    if (!p) return null;
    return state.auction.currentBid ? state.auction.currentBid.amount + state.auction.bidIncrement : p.basePrice;
  }

  function nextAvailableId(afterId) {
    if (afterId) {
      const idx = state.players.findIndex(p => p.id === afterId);
      if (idx >= 0) {
        const later = state.players.slice(idx + 1).find(p => p.status === 'available');
        if (later) return later.id;
      }
    }
    const first = availablePlayers()[0];
    return first ? first.id : null;
  }

  function advance(fromId) {
    state.auction.currentPlayerId = nextAvailableId(fromId);
    state.auction.currentBid = null;
    if (!state.auction.currentPlayerId && state.auction.status !== 'concluded') {
      state.auction.status = 'concluded';
      state.auction.concludedAt = new Date().toISOString();
      log('All players have been listed — auction concluded.', 'system');
    }
  }

  // ---------- host pass (soft gate: browser-local, not real security) ----------
  const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ''; } catch { return ''; } };
  const setPass = v => { try { localStorage.setItem(PASS_KEY, v); } catch { /* private mode */ } };
  const isHost = () => Boolean(getPass());

  function hostGate(onReady) {
    if (isHost()) { onReady(); return; }
    const input = el('input', { type: 'password', id: 'host-pass-input', placeholder: 'Passcode', autocomplete: 'off' });
    const error = el('p', { class: 'modal-error' });
    const firstTime = !localStorage.getItem(PASS_KEY + ':seen');
    const save = el('button', { type: 'button', class: 'btn btn-primary', text: firstTime ? 'Choose this passcode' : 'Unlock host controls' });
    const box = el('div', { class: 'modal-box', role: 'dialog', 'aria-label': 'Host access' }, [
      el('h2', { text: firstTime ? 'Choose a host passcode' : 'Host access required' }),
      el('p', { class: 'modal-text', text: firstTime
        ? 'Pick a passcode for this browser. It only gates host controls on this device — it is not real security.'
        : 'Enter the host passcode to manage the auction.' }),
      input, error,
      el('div', { class: 'modal-actions' }, [save]),
    ]);
    const overlay = el('div', { id: 'host-auth-modal', class: 'popup' }, [box]);
    document.body.appendChild(overlay);
    input.focus();
    const submit = () => {
      const value = input.value.trim();
      if (value.length < 4) { error.textContent = 'Use at least 4 characters'; return; }
      setPass(value);
      try { localStorage.setItem(PASS_KEY + ':seen', '1'); } catch { /* ignore */ }
      overlay.remove();
      onReady();
    };
    save.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  // ---------- participant session ----------
  const getParticipantTeamId = () => { try { return sessionStorage.getItem(PARTICIPANT_KEY) || ''; } catch { return ''; } };
  const setParticipantTeamId = v => {
    try { if (v) sessionStorage.setItem(PARTICIPANT_KEY, v); else sessionStorage.removeItem(PARTICIPANT_KEY); } catch { /* ignore */ }
  };
  function joinByCode(rawCode) {
    const code = String(rawCode || '').trim().toLowerCase();
    if (!code) return { ok: false, error: 'Enter your team code.' };
    const team = activeTeams().find(t => t.code === code);
    if (!team) return { ok: false, error: 'No team matches that code.' };
    setParticipantTeamId(team.id);
    return { ok: true, team };
  }

  // ---------- setup actions ----------
  function addTeam(name, budget) {
    const clean = String(name || '').trim();
    const amount = Number(budget);
    if (!clean) return { ok: false, error: 'Team name is required.' };
    if (!Number.isFinite(amount) || amount < 1) return { ok: false, error: 'Budget must be at least ₹1.' };
    if (state.teams.some(t => t.status === 'active' && t.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, error: 'A team with that name already exists.' };
    }
    mutate(() => {
      state.teams.push({ id: uid('team'), name: clean, initialBudget: amount, budget: amount, status: 'active', code: null, players: [], joinedAt: null });
      log(`Team "${clean}" added with a budget of ${money(amount)}.`, 'setup');
    });
    return { ok: true };
  }

  function removeTeam(id) {
    const team = teamById(id);
    if (!team) return { ok: false, error: 'Team not found.' };
    mutate(() => {
      if (team.players.length) {
        team.status = 'archived';
        log(`Team "${team.name}" has purchases, so it was archived instead of deleted.`, 'setup');
      } else {
        state.teams = state.teams.filter(t => t.id !== id);
        log(`Team "${team.name}" removed.`, 'setup');
      }
    });
    return { ok: true };
  }

  function addPlayer({ name, category, basePrice, image }) {
    const clean = String(name || '').trim();
    const amount = Number(basePrice);
    if (!clean) return { ok: false, error: 'Player name is required.' };
    if (!['Batsman', 'Bowler', 'All-Rounder', 'Wicket-Keeper'].includes(category)) {
      return { ok: false, error: 'Pick a valid category.' };
    }
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Base price must be ₹0 or more.' };
    mutate(() => {
      state.players.push({ id: uid('player'), name: clean, category, basePrice: amount, image: image || null, status: 'available' });
      log(`Player "${clean}" (${category}) added at base ${money(amount)}.`, 'setup');
    });
    return { ok: true };
  }

  function removePlayer(id) {
    const player = playerById(id);
    if (!player) return { ok: false, error: 'Player not found.' };
    if (player.status === 'sold') return { ok: false, error: `${player.name} is sold — undo the sale first.` };
    mutate(() => {
      state.players = state.players.filter(p => p.id !== id);
      if (state.auction.currentPlayerId === id) {
        state.auction.currentBid = null;
        state.auction.currentPlayerId = nextAvailableId(null);
        if (!state.auction.currentPlayerId && state.auction.status === 'live') advance(null);
      }
      log(`Player "${player.name}" removed.`, 'setup');
    });
    return { ok: true };
  }

  function setIncrement(value) {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'Bid increment must be a whole number ≥ 1.' };
    mutate(() => { state.auction.bidIncrement = amount; log(`Bid increment set to ${money(amount)}.`, 'setup'); });
    return { ok: true };
  }

  function ensureCode(teamId, forceRotate = false) {
    const team = teamById(teamId);
    if (!team) return { ok: false, error: 'Team not found.' };
    if (team.code && !forceRotate) return { ok: true, code: team.code };
    mutate(() => {
      team.code = code8();
      log(forceRotate ? `Code rotated for "${team.name}".` : `Participant code created for "${team.name}".`, 'setup');
    });
    return { ok: true, code: team.code };
  }

  function generateMissingCodes() {
    let count = 0;
    mutate(() => {
      activeTeams().forEach(t => { if (!t.code) { t.code = code8(); count += 1; } });
      if (count) log(`Generated ${count} participant code(s).`, 'setup');
    });
    return count;
  }

  function validateSetup() {
    const errs = [];
    if (!activeTeams().length) errs.push('Add at least one team.');
    if (!availablePlayers().length) errs.push('Add at least one available player.');
    if (!Number.isInteger(state.auction.bidIncrement) || state.auction.bidIncrement < 1) {
      errs.push('Set a valid bid increment.');
    }
    return errs;
  }

  function startAuction() {
    const errors = validateSetup();
    if (errors.length) return { ok: false, errors };
    if (state.auction.status !== 'setup') return { ok: false, errors: ['Auction already started.'] };
    mutate(() => {
      state.auction.status = 'live';
      state.auction.startedAt = new Date().toISOString();
      state.auction.currentPlayerId = availablePlayers()[0].id;
      log('Auction started — good luck, everyone!', 'system');
    });
    return { ok: true };
  }

  // ---------- bidding & sales ----------
  function placeBid(teamId, amount, source = 'participant') {
    const status = state.auction.status;
    if (status === 'setup') return { ok: false, error: 'The auction has not started yet.' };
    if (status === 'paused') return { ok: false, error: 'Bidding is paused.' };
    if (status === 'concluded') return { ok: false, error: 'The auction has ended.' };
    const player = currentPlayer();
    if (!player) return { ok: false, error: 'No player is on the block.' };
    const team = teamById(teamId);
    if (!team || team.status !== 'active') return { ok: false, error: 'That team is not active.' };
    const value = Number(amount);
    const minimum = minBidAmount();
    if (!Number.isFinite(value) || value < minimum) return { ok: false, error: `Bid must be at least ${money(minimum)}.` };
    if (team.budget < value) return { ok: false, error: `${team.name} cannot afford ${money(value)} (budget ${money(team.budget)}).` };
    if (team.players.includes(player.id)) return { ok: false, error: `${team.name} already owns ${player.name}.` };
    mutate(() => {
      const timestamp = new Date().toISOString();
      state.bids.push({ id: uid('bid'), playerId: player.id, teamId, amount: value, timestamp, source });
      state.auction.currentBid = { teamId, amount: value, timestamp };
      log(`${team.name} bid ${money(value)} on ${player.name}.`, 'bid');
    });
    return { ok: true, amount: value };
  }

  function sellCurrent() {
    if (state.auction.status !== 'live') return { ok: false, error: 'Resume the auction before selling.' };
    const player = currentPlayer();
    if (!player) return { ok: false, error: 'No player is on the block.' };
    if (!state.auction.currentBid) return { ok: false, error: 'No bids yet — mark the player unsold instead.' };
    mutate(() => {
      const { teamId, amount } = state.auction.currentBid;
      const team = teamById(teamId);
      team.budget -= amount;
      team.players.push(player.id);
      player.status = 'sold';
      state.sales.push({ id: uid('sale'), playerId: player.id, teamId, amount, status: 'active', timestamp: new Date().toISOString() });
      log(`${player.name} sold to ${team.name} for ${money(amount)}.`, 'sale');
      advance(player.id);
    });
    return { ok: true };
  }

  function markUnsold() {
    if (state.auction.status !== 'live') return { ok: false, error: 'Resume the auction before marking unsold.' };
    const player = currentPlayer();
    if (!player) return { ok: false, error: 'No player is on the block.' };
    mutate(() => {
      player.status = 'unsold';
      state.sales.push({ id: uid('sale'), playerId: player.id, teamId: null, amount: 0, status: 'unsold', timestamp: new Date().toISOString() });
      log(`${player.name} went unsold.`, 'sale');
      advance(player.id);
    });
    return { ok: true };
  }

  function correctSale(saleId) {
    const sale = state.sales.find(s => s.id === saleId);
    if (!sale) return { ok: false, error: 'Sale not found.' };
    if (sale.status !== 'active') return { ok: false, error: 'This sale was already corrected.' };
    const player = playerById(sale.playerId);
    const team = teamById(sale.teamId);
    if (!player || !team) return { ok: false, error: 'Sale data is inconsistent.' };
    mutate(() => {
      sale.status = 'corrected';
      sale.correctedAt = new Date().toISOString();
      team.budget += sale.amount;
      team.players = team.players.filter(id => id !== player.id);
      player.status = 'available';
      if (state.auction.status === 'live' || state.auction.status === 'paused') {
        state.auction.currentPlayerId = player.id;
        state.auction.currentBid = null;
      }
      log(`Sale of ${player.name} to ${team.name} corrected — ${money(sale.amount)} refunded and bidding restarted.`, 'correction');
    });
    return { ok: true };
  }

  function togglePause() {
    if (state.auction.status === 'live') {
      mutate(() => { state.auction.status = 'paused'; state.auction.pausedAt = new Date().toISOString(); log('Auction paused by host.', 'system'); });
    } else if (state.auction.status === 'paused') {
      mutate(() => { state.auction.status = 'live'; state.auction.pausedAt = null; log('Auction resumed.', 'system'); });
    } else {
      return { ok: false, error: 'Nothing to pause.' };
    }
    return { ok: true };
  }

  function endAuction() {
    if (state.auction.status === 'concluded') return { ok: false, error: 'Already concluded.' };
    mutate(() => {
      state.auction.status = 'concluded';
      state.auction.concludedAt = new Date().toISOString();
      log('Auction ended by host.', 'system');
    });
    return { ok: true };
  }

  // ---------- data management ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `auction-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function importJSON(parsed) {
    if (!validShape(parsed)) return { ok: false, error: 'That file is not auction data from this app.' };
    mutate(() => {
      state = JSON.parse(JSON.stringify(parsed));
      log('Auction data imported.', 'system');
    });
    return { ok: true };
  }

  function resetAll() {
    state = freshState();
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    if (channel) channel.postMessage({ type: 'state', state });
    notify();
  }

  function resizeImage(file, max = 256) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) { reject(new Error('Not an image file.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode the image.'));
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function playerAvatar(player, size = 'md') {
    if (player.image) return el('img', { class: `avatar avatar-${size}`, src: player.image, alt: player.name });
    const initials = player.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return el('div', { class: `avatar avatar-${size} avatar-placeholder`, text: initials });
  }

  function timeLabel(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }

  function popup({ title, bodyNodes, actions = [] }) {
    const box = el('div', { class: 'modal-box', role: 'dialog' }, [
      el('h2', { text: title }),
      ...[].concat(bodyNodes),
      el('div', { class: 'modal-actions' }, actions.length ? actions : [
        el('button', { type: 'button', class: 'btn', text: 'Close', onclick: e => e.target.closest('.popup').remove() }),
      ]),
    ]);
    const overlay = el('div', { class: 'popup' }, [box]);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function showMsg(node, text, isError = true) {
    node.textContent = text;
    node.className = 'form-msg ' + (isError ? 'error' : 'success');
    if (text) setTimeout(() => { if (node.textContent === text) node.textContent = ''; }, 6000);
  }

  window.A = {
    subscribe, mutate, log, money, el, clear, uid,
    get state() { return state; },
    teamById, playerById, currentPlayer, activeSales, activeTeams, availablePlayers,
    minBidAmount, validateSetup,
    getPass, setPass, isHost, hostGate,
    getParticipantTeamId, setParticipantTeamId, joinByCode,
    addTeam, removeTeam, addPlayer, removePlayer, setIncrement,
    ensureCode, generateMissingCodes, startAuction,
    placeBid, sellCurrent, markUnsold, correctSale, togglePause, endAuction,
    exportJSON, importJSON, resetAll, resizeImage, playerAvatar, timeLabel, popup, showMsg,
  };
})();
