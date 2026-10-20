/* Host live console: current lot, controls, teams, sales, event log. */
(() => {
  const A = window.A;
  const { el, clear, money, showMsg } = A;

  const statusBadge = document.getElementById('auction-status');
  const sequenceNode = document.getElementById('sequence');
  const lotWrap = document.getElementById('lot-wrap');
  const teamsGrid = document.getElementById('teams-grid');
  const salesList = document.getElementById('sales-list');
  const logList = document.getElementById('log-list');
  const liveMsg = document.getElementById('live-msg');
  const sellBtn = document.getElementById('sell-btn');
  const unsoldBtn = document.getElementById('unsold-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const endBtn = document.getElementById('end-btn');

  let state = null;

  const STATUS_LABEL = { setup: 'SETUP', live: '● LIVE', paused: 'PAUSED', concluded: 'CONCLUDED' };

  function render() {
    if (!state) return;
    const { auction } = state;

    statusBadge.textContent = STATUS_LABEL[auction.status] || auction.status.toUpperCase();
    statusBadge.className = 'status-badge ' + auction.status;
    sequenceNode.textContent = String(auction.sequence);

    renderLot();
    renderTeams();
    renderSales();
    renderLog();

    const live = auction.status === 'live';
    sellBtn.disabled = !live || !auction.currentBid;
    unsoldBtn.disabled = !live;
    pauseBtn.disabled = !(live || auction.status === 'paused');
    endBtn.disabled = auction.status === 'concluded';
    pauseBtn.textContent = auction.status === 'paused' ? 'Resume' : 'Pause';
  }

  function renderLot() {
    clear(lotWrap);
    const p = A.currentPlayer();
    if (state.auction.status === 'setup') {
      lotWrap.appendChild(el('p', { class: 'empty', text: 'Auction not started yet. Finish setup, then press "Review & Start".' }));
      return;
    }
    if (!p) {
      lotWrap.appendChild(el('p', { class: 'empty', text: state.auction.status === 'concluded' ? 'Auction over — see the conclusion page.' : 'No player on the block.' }));
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
        el('div', { class: 'min', text: bid ? `Next bid ≥ ${money(A.minBidAmount())}` : `Opening at ${money(p.basePrice)}` }),
      ]),
    ]));
  }

  function renderTeams() {
    clear(teamsGrid);
    const teams = state.teams;
    if (!teams.length) {
      teamsGrid.appendChild(el('p', { class: 'empty', text: 'No teams.' }));
      return;
    }
    teams.forEach(t => {
      const spent = t.initialBudget - t.budget;
      const card = el('div', {
        class: 'team-card' + (t.status === 'archived' ? ' archived' : ''),
        onclick: () => openTeamPopup(t),
      }, [
        el('h4', { text: t.name }),
        el('div', { class: 'budget', text: money(t.budget) + ' left' }),
        el('div', { class: 'spent', text: `spent ${money(spent)} · ${t.players.length} player(s)` }),
        t.status === 'archived' ? el('span', { class: 'tag tag-archived', text: 'archived', style: 'margin-top:8px' }) : null,
      ]);
      teamsGrid.appendChild(card);
    });
  }

  function openTeamPopup(team) {
    const roster = team.players.map(id => A.playerById(id)).filter(Boolean);
    const bid = state.auction.currentBid;
    A.popup({
      title: team.name,
      bodyNodes: [
        el('p', { text: `Budget remaining: ${money(team.budget)} of ${money(team.initialBudget)}` }),
        team.joinedAt ? el('p', { class: 'hint', text: 'Joined the participant view.' }) : el('p', { class: 'hint', text: 'Has not joined the participant view yet.' }),
        team.code ? el('p', {}, ['Code: ', el('span', { class: 'secret-code', text: team.code })]) : null,
        el('h3', { text: `Roster (${roster.length})` }, ),
        roster.length
          ? el('ul', {}, roster.map(p => el('li', { text: `${p.name} (${p.category})` })))
          : el('p', { class: 'empty', text: 'No players bought yet.' }),
        bid && bid.teamId === team.id ? el('p', { class: 'hint', text: `Currently holds the top bid of ${money(bid.amount)}.` }) : null,
      ],
    });
  }

  function renderSales() {
    clear(salesList);
    const sales = [...state.sales].reverse();
    if (!sales.length) {
      salesList.appendChild(el('p', { class: 'empty', text: 'No sales yet.' }));
      return;
    }
    sales.slice(0, 12).forEach(sale => {
      const player = A.playerById(sale.playerId);
      const team = sale.teamId ? A.teamById(sale.teamId) : null;
      salesList.appendChild(el('div', { class: 'review-item' }, [
        el('div', { class: 'review-main' }, [
          el('strong', { text: player ? player.name : 'Unknown player' }),
          el('span', {
            class: 'review-meta',
            text: sale.status === 'unsold' ? 'unsold' : sale.status === 'corrected'
              ? `corrected — ${team ? team.name : '?'} refunded ${money(sale.amount)}`
              : `${team ? team.name : '?'} · ${money(sale.amount)}`,
          }),
        ]),
        sale.status === 'active'
          ? el('span', { class: 'tag tag-sold', text: 'sold' })
          : el('span', { class: 'tag tag-' + sale.status, text: sale.status }),
        sale.status === 'active'
          ? el('button', {
              type: 'button', class: 'btn btn-small', text: 'Undo',
              onclick: () => {
                if (!confirm(`Undo the sale of ${player ? player.name : '?'} to ${team ? team.name : '?'}? Budget is refunded and bidding restarts.`)) return;
                const res = A.correctSale(sale.id);
                showMsg(liveMsg, res.ok ? 'Sale corrected.' : res.error, !res.ok);
              },
            })
          : null,
      ]));
    });
  }

  function renderLog() {
    clear(logList);
    if (!state.events.length) {
      logList.appendChild(el('p', { class: 'empty', text: 'No events yet.' }));
      return;
    }
    state.events.slice(0, 60).forEach(ev => {
      logList.appendChild(el('div', { class: 'log-item ' + ev.type }, [
        el('span', { class: 't', text: A.timeLabel(ev.at) }),
        el('span', { text: ev.text }),
      ]));
    });
  }

  // ---------- controls ----------
  sellBtn.addEventListener('click', () => {
    const p = A.currentPlayer();
    const bid = state.auction.currentBid;
    if (!p || !bid) return;
    if (!confirm(`Sell ${p.name} to ${A.teamById(bid.teamId).name} for ${money(bid.amount)}?`)) return;
    const res = A.sellCurrent();
    showMsg(liveMsg, res.ok ? 'Sold!' : res.error, !res.ok);
  });

  unsoldBtn.addEventListener('click', () => {
    const p = A.currentPlayer();
    if (!p) return;
    if (!confirm(`Mark ${p.name} unsold and move to the next player?`)) return;
    const res = A.markUnsold();
    showMsg(liveMsg, res.ok ? `${p.name} marked unsold.` : res.error, !res.ok);
  });

  pauseBtn.addEventListener('click', () => {
    const res = A.togglePause();
    showMsg(liveMsg, res.ok ? (A.state.auction.status === 'paused' ? 'Auction paused.' : 'Auction resumed.') : res.error, !res.ok);
  });

  endBtn.addEventListener('click', () => {
    if (!confirm('End the auction now? This cannot be undone.')) return;
    const res = A.endAuction();
    showMsg(liveMsg, res.ok ? 'Auction ended. See the conclusion page.' : res.error, !res.ok);
  });

  // ---------- boot ----------
  A.hostGate(() => A.subscribe(s => { state = s; render(); }));
})();
