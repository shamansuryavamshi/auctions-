/* Participant view: watch the auction, join with a team code, place bids. */
(() => {
  const { el, clear, money, messageOf, setStatus } = window.Auction;
  const A = window.Auction;

  const $ = id => document.getElementById(id);
  const statusEl = $('auction-status');
  const msg = $('view-msg');
  const identityMsg = $('identity-msg');
  const joinForm = $('join-form');
  const joinCode = $('join-code');
  const teamPanel = $('team-panel');
  const joinedTeam = $('joined-team');
  const joinedBudget = $('joined-budget');
  const bidForm = $('bid-form');
  const bidInput = $('bid-input');
  const bidBtn = $('bid-btn');
  const leaveBtn = $('leave-btn');
  const lotImage = $('lot-image');
  const lotName = $('lot-name');
  const lotCategory = $('lot-category');
  const lotBase = $('lot-base');
  const lotBid = $('lot-bid');
  const lotTeam = $('lot-team');
  const bidHint = $('bid-hint');
  const teamsList = $('teams-list');
  const bidHistory = $('bid-history');
  const salesList = $('sales-list');

  let state = null;
  let failed = false;
  let me = null; // { id, name, remainingBudget, status } once joined

  function showMsg(text, isError = true) {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.className = 'form-msg' + (isError && text ? ' error' : '');
  }

  function showIdentityMsg(text, isError = true) {
    if (!identityMsg) return;
    identityMsg.hidden = !text;
    identityMsg.textContent = text || '';
    identityMsg.className = 'form-msg' + (isError && text ? ' error' : '');
    if (text && !isError) setTimeout(() => { if (identityMsg.textContent === text) { identityMsg.hidden = true; } }, 5000);
  }

  function renderStatus() {
    if (!state) return;
    const map = {
      setup: ['SETUP', 'setup'],
      live: ['● LIVE', 'live'],
      paused: ['PAUSED', 'paused'],
      concluded: ['CONCLUDED', 'concluded'],
    };
    const [text, kind] = map[state.auction.status] || [state.auction.status, ''];
    setStatus(statusEl, text, kind);
  }

  function requiredNextBid() {
    if (!state || !state.currentPlayer) return null;
    const inc = state.auction.config.bidIncrement;
    const bid = state.auction.currentBid;
    if (!bid) return Math.max(state.currentPlayer.basePrice, 1);
    return bid.amount + inc;
  }

  function renderIdentity() {
    if (!teamPanel || !joinForm) return;
    const joined = Boolean(me);
    joinForm.hidden = joined;
    teamPanel.hidden = !joined;
    if (joined && state) {
      // Refresh remaining budget from the authoritative snapshot.
      const t = state.teams.find(x => x.id === me.id);
      if (t) me = { ...me, remainingBudget: t.remainingBudget, status: t.status };
      joinedTeam.textContent = me.name;
      joinedBudget.textContent = money(me.remainingBudget);
    }

    const player = state && state.currentPlayer;
    const live = state && state.auction.status === 'live';
    const canBid = Boolean(joined && live && player && me && me.status === 'active');
    if (bidBtn) bidBtn.disabled = !canBid;
    if (bidInput) {
      const required = requiredNextBid();
      bidInput.disabled = !canBid;
      if (required !== null) {
        bidInput.min = String(required);
        bidInput.placeholder = String(required);
        bidHint.textContent = me
          ? (canBid ? `Minimum next bid: ${money(required)}` : 'Bidding is closed right now')
          : '';
      } else {
        bidHint.textContent = '';
      }
    }
  }

  function renderLot() {
    const player = state.currentPlayer;
    const bid = state.auction.currentBid;
    if (player) {
      if (player.image) {
        lotImage.src = player.image;
        lotImage.style.display = 'block';
      } else {
        lotImage.removeAttribute('src');
        lotImage.style.display = 'none';
      }
      lotName.textContent = player.name;
      lotCategory.textContent = player.category;
      lotBase.textContent = money(player.basePrice);
    } else {
      lotImage.removeAttribute('src');
      lotImage.style.display = 'none';
      lotName.textContent = state.auction.status === 'setup' ? 'Auction has not started yet'
        : state.auction.status === 'concluded' ? 'Auction concluded'
        : 'No player on the block';
      lotCategory.textContent = '—';
      lotBase.textContent = '—';
    }
    lotBid.textContent = bid ? money(bid.amount) : '—';
    lotTeam.textContent = bid ? bid.teamName : '—';
  }

  function renderTeams() {
    clear(teamsList);
    if (state.teams.length === 0) {
      teamsList.appendChild(el('p', { class: 'empty', text: 'No teams yet' }));
      return;
    }
    state.teams.forEach(t => {
      const isMe = me && t.id === me.id;
      teamsList.appendChild(el('div', { class: 'team-card' + (t.status === 'archived' ? ' archived' : '') + (isMe ? ' me' : '') }, [
        el('h3', { text: t.name + (isMe ? ' (you)' : '') }),
        el('p', { text: `Remaining: ${money(t.remainingBudget)}` }),
        el('p', { class: 'hint', text: `${t.playersBought.length} player(s)` }),
      ]));
    });
  }

  function renderBids() {
    clear(bidHistory);
    const bids = [...state.recentBids].reverse();
    if (bids.length === 0) {
      bidHistory.appendChild(el('p', { class: 'empty', text: 'No bids yet' }));
      return;
    }
    bids.slice(0, 12).forEach(b => {
      bidHistory.appendChild(el('div', { class: 'bid-row' }, [
        el('span', { text: b.teamName || '—' }),
        el('span', { text: b.playerName || '—' }),
        el('strong', { text: money(b.amount) }),
      ]));
    });
  }

  function renderSales() {
    clear(salesList);
    const sales = state.sales.filter(s => s.status !== 'corrected');
    if (sales.length === 0) {
      salesList.appendChild(el('p', { class: 'empty', text: 'No sales yet' }));
      return;
    }
    [...sales].reverse().forEach(s => {
      salesList.appendChild(el('div', { class: 'bid-row' }, [
        el('span', { text: s.playerName || '—' }),
        el('span', { text: s.teamName || '—' }),
        el('strong', { text: money(s.price) }),
      ]));
    });
  }

  function render() {
    if (!state) return;
    renderStatus();
    renderIdentity();
    renderLot();
    renderTeams();
    renderBids();
    renderSales();
    showMsg(failed ? 'Connection lost — retrying…' : '');
  }

  // ---------- participant identity ----------
  async function restoreSession() {
    if (!A.getParticipantToken()) return;
    try {
      const res = await A.participantGet('/api/participants/me');
      me = res.team;
    } catch {
      A.setParticipantToken('');
      me = null;
    }
  }

  joinForm.addEventListener('submit', async e => {
    e.preventDefault();
    const code = joinCode.value.trim();
    if (!code) { showIdentityMsg('Enter your team code'); return; }
    try {
      const res = await A.participantPost('/api/participants/session', { code });
      A.setParticipantToken(res.token);
      me = { ...res.team, remainingBudget: 0, status: 'active' };
      joinCode.value = '';
      showIdentityMsg(`Joined as ${res.team.name}. Good luck!`, false);
      render();
    } catch (err) {
      showIdentityMsg(messageOf(err));
    }
  });

  leaveBtn.addEventListener('click', async () => {
    try { await A.participantPost('/api/participants/logout'); } catch { /* session may already be gone */ }
    A.setParticipantToken('');
    me = null;
    showIdentityMsg('You left the team session.', false);
    render();
  });

  bidForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!me) return;
    const amount = Number(bidInput.value);
    try {
      const res = await A.participantPost('/api/participant/bids', { amount });
      bidInput.value = '';
      state = res.state;
      showIdentityMsg(`Bid of ${money(amount)} placed for ${me.name}.`, false);
      render();
    } catch (err) {
      showIdentityMsg(messageOf(err));
    }
  });

  async function boot() {
    await restoreSession();
    try {
      state = await A.get('/api/state');
      failed = false;
      render();
    } catch (err) {
      failed = true;
      showMsg(messageOf(err));
    }
    A.connect(snapshot => { state = snapshot; failed = false; render(); });
    setInterval(async () => {
      if (failed || !state) {
        try { state = await A.get('/api/state'); failed = false; render(); } catch { /* still down */ }
      }
    }, 5000);
  }

  boot();
})();
