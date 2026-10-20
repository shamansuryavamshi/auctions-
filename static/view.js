/* Participant view: join by team code, watch the lot, bid. */
(() => {
  const A = window.A;
  const { el, clear, money, showMsg } = A;

  const joinScreen = document.getElementById('join-screen');
  const auctionScreen = document.getElementById('auction-screen');
  const joinMsg = document.getElementById('join-msg');
  const statusBadge = document.getElementById('auction-status');
  const lotWrap = document.getElementById('lot-wrap');
  const bidInput = document.getElementById('bid-input');
  const bidBtn = document.getElementById('bid-btn');
  const bidHint = document.getElementById('bid-hint');
  const bidMsg = document.getElementById('bid-msg');
  const bidsList = document.getElementById('bids-list');

  const STATUS_LABEL = { setup: 'SETUP', live: '● LIVE', paused: 'PAUSED', concluded: 'CONCLUDED' };

  let state = null;
  let myTeam = null;

  function myTeamId() { return A.getParticipantTeamId(); }

  function resolveMyTeam() {
    const id = myTeamId();
    if (!id) { myTeam = null; return; }
    const team = A.teamById(id);
    if (!team || team.status !== 'active') {
      A.setParticipantTeamId('');
      myTeam = null;
      return;
    }
    if (!myTeam || myTeam.id !== team.id || myTeam.joinedAt !== team.joinedAt) {
      myTeam = team;
      if (!team.joinedAt) A.mutate(() => { team.joinedAt = new Date().toISOString(); });
    }
  }

  function render() {
    if (!state) return;
    resolveMyTeam();

    if (!myTeam) {
      joinScreen.hidden = false;
      auctionScreen.hidden = true;
      return;
    }
    joinScreen.hidden = true;
    auctionScreen.hidden = false;

    statusBadge.textContent = STATUS_LABEL[state.auction.status] || state.auction.status.toUpperCase();
    statusBadge.className = 'status-badge ' + state.auction.status;

    document.getElementById('team-name').textContent = myTeam.name;
    document.getElementById('team-budget').textContent = `${money(myTeam.budget)} remaining`;
    const roster = myTeam.players.map(id => A.playerById(id)).filter(Boolean);
    document.getElementById('team-roster').textContent = roster.length
      ? 'Your players: ' + roster.map(p => p.name).join(', ')
      : 'No players bought yet.';

    renderLot();
    renderBidArea();
    renderBids();
  }

  function renderLot() {
    clear(lotWrap);
    const p = A.currentPlayer();
    if (state.auction.status === 'setup') {
      lotWrap.appendChild(el('p', { class: 'empty', text: 'The auction has not started yet. Watch this page — it updates automatically.' }));
      return;
    }
    if (!p) {
      lotWrap.appendChild(el('p', { class: 'empty', text: state.auction.status === 'concluded' ? 'The auction has ended. Thank you for bidding!' : 'Waiting for the next player…' }));
      return;
    }
    const bid = state.auction.currentBid;
    const leader = bid ? A.teamById(bid.teamId) : null;
    lotWrap.appendChild(el('div', { class: 'lot-card' }, [
      A.playerAvatar(p, 'lg'),
      el('div', { class: 'info', style: 'flex:1' }, [
        el('h3', { text: p.name }),
        el('div', { class: 'category', text: p.category }),
        el('div', { class: 'base', text: `Base price ${money(p.basePrice)}` }),
      ]),
      el('div', { class: 'bid-panel', style: 'min-width:220px' }, [
        el('div', { class: 'leader', text: bid ? `Top bid — ${leader.name}` : 'No bids yet' }),
        el('div', { class: 'amount', text: bid ? money(bid.amount) : '—' }),
        el('div', { class: 'min', text: bid ? `Next bid ≥ ${money(A.minBidAmount())}` : `Opens at ${money(p.basePrice)}` }),
      ]),
    ]));
  }

  function renderBidArea() {
    const status = state.auction.status;
    const p = A.currentPlayer();
    const minimum = A.minBidAmount();
    const ownsCurrent = p && myTeam.players.includes(p.id);

    let canBid = true;
    let hint = '';
    if (status === 'setup') { canBid = false; hint = 'The auction has not started yet.'; }
    else if (status === 'paused') { canBid = false; hint = 'Bidding is closed right now (paused).'; }
    else if (status === 'concluded') { canBid = false; hint = 'The auction has ended.'; }
    else if (!p) { canBid = false; hint = 'No player is on the block.'; }
    else if (ownsCurrent) { canBid = false; hint = `Your team already owns ${p.name}.`; }
    else if (myTeam.budget < minimum) { canBid = false; hint = `Your budget (${money(myTeam.budget)}) is below the minimum bid (${money(minimum)}).`; }

    bidBtn.disabled = !canBid;
    bidInput.disabled = !canBid;
    bidInput.placeholder = minimum ? String(minimum) : '';
    bidInput.min = minimum || 1;
    bidHint.textContent = hint || (minimum ? `Minimum bid: ${money(minimum)}` : '');
  }

  function renderBids() {
    clear(bidsList);
    const recent = state.bids.slice(-10).reverse();
    if (!recent.length) {
      bidsList.appendChild(el('p', { class: 'empty', text: 'No bids yet.' }));
      return;
    }
    recent.forEach(bid => {
      const team = A.teamById(bid.teamId);
      const player = A.playerById(bid.playerId);
      bidsList.appendChild(el('div', { class: 'log-item bid' }, [
        el('span', { class: 't', text: A.timeLabel(bid.timestamp) }),
        el('span', { text: `${team ? team.name : '?'} bid ${money(bid.amount)} on ${player ? player.name : '?'}` }),
      ]));
    });
  }

  // ---------- actions ----------
  document.getElementById('join-btn').addEventListener('click', () => {
    const res = A.joinByCode(document.getElementById('join-code').value);
    if (!res.ok) { showMsg(joinMsg, res.error); return; }
    showMsg(joinMsg, `Joined as ${res.team.name}!`, false);
    document.getElementById('join-code').value = '';
    render();
  });

  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
  });

  document.getElementById('leave-btn').addEventListener('click', () => {
    if (!confirm('Leave your team? You can rejoin with your code.')) return;
    A.setParticipantTeamId('');
    myTeam = null;
    render();
  });

  bidBtn.addEventListener('click', () => {
    const res = A.placeBid(myTeam.id, Number(bidInput.value));
    if (!res.ok) { showMsg(bidMsg, res.error); return; }
    bidInput.value = '';
    showMsg(bidMsg, `Bid of ${money(res.amount)} placed — you are the top bidder!`, false);
    render();
  });

  bidInput.addEventListener('keydown', e => { if (e.key === 'Enter') bidBtn.click(); });

  // ---------- boot ----------
  A.subscribe(s => { state = s; render(); });
})();
