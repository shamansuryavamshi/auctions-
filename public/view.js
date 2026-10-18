/* Participant view: read-only, server-synchronized. */
(() => {
  const { el, clear, money, messageOf, setStatus } = window.Auction;
  const A = window.Auction;

  const $ = id => document.getElementById(id);
  const statusEl = $('auction-status');
  const msg = $('view-msg');
  const lotImage = $('lot-image');
  const lotName = $('lot-name');
  const lotCategory = $('lot-category');
  const lotBase = $('lot-base');
  const lotBid = $('lot-bid');
  const lotTeam = $('lot-team');
  const teamsList = $('teams-list');
  const bidHistory = $('bid-history');
  const salesList = $('sales-list');

  let state = null;
  let failed = false;

  function showMsg(text) {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
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
      teamsList.appendChild(el('div', { class: 'team-card' + (t.status === 'archived' ? ' archived' : '') }, [
        el('h3', { text: t.name }),
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
    if (state.sales.length === 0) {
      salesList.appendChild(el('p', { class: 'empty', text: 'No sales yet' }));
      return;
    }
    [...state.sales].reverse().forEach(s => {
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
    renderLot();
    renderTeams();
    renderBids();
    renderSales();
    showMsg(failed ? 'Connection lost — retrying…' : '');
  }

  async function boot() {
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
