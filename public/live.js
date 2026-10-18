/* Host live console: bids, sales, unsold, pause/end, team popups. */
(() => {
  const { el, clear, money, messageOf, setStatus } = window.Auction;
  const A = window.Auction;

  A.requireHostToken();

  const $ = id => document.getElementById(id);
  const els = {
    status: $('auction-status'),
    teamsList: $('teams-list'),
    playersList: $('players-list'),
    teamSelect: $('team-select'),
    bidAmount: $('bid-amount'),
    placeBid: $('place-bid'),
    sell: $('sell-player'),
    unsold: $('unsold-player'),
    pause: $('pause-btn'),
    end: $('end-auction-btn'),
    msg: $('live-msg'),
    img: $('auction-player-image'),
    name: $('auction-player-name'),
    category: $('auction-player-category'),
    base: $('auction-player-base'),
    highest: $('highest-bid'),
    leader: $('leading-team'),
    hint: $('bid-hint'),
    soldBody: $('sold-players'),
    unsoldList: $('unsold-players'),
    popup: $('info-popup'),
    popupTitle: $('popup-title'),
    popupSubtitle: $('popup-subtitle'),
    popupList: $('popup-list'),
  };

  // Defensive: every optional section is guarded so one missing node
  // can never abort the whole page initialization (audit P1 #6).
  for (const [key, node] of Object.entries(els)) {
    if (!node) console.warn('[live] missing element:', key);
  }

  let state = null;
  let selectedTeamId = '';
  let loadFailed = false;

  function showMsg(text, isError = true) {
    if (!els.msg) return;
    els.msg.textContent = text;
    els.msg.className = 'form-msg ' + (isError ? 'error' : 'success');
    if (text) setTimeout(() => { if (els.msg.textContent === text) els.msg.textContent = ''; }, 6000);
  }

  function requiredNextBid() {
    if (!state || !state.currentPlayer) return null;
    const inc = state.auction.config.bidIncrement;
    const bid = state.auction.currentBid;
    if (!bid) return Math.max(state.currentPlayer.basePrice, 1);
    return bid.amount + inc;
  }

  function renderStatus() {
    if (!state) return;
    const map = {
      setup: ['SETUP — not started', 'setup'],
      live: ['● LIVE', 'live'],
      paused: ['PAUSED', 'paused'],
      concluded: ['CONCLUDED', 'concluded'],
    };
    const [text, kind] = map[state.auction.status] || [state.auction.status, ''];
    setStatus(els.status, text, kind);
    document.title = `(${text.replace('● ', '')}) Sports Auction`;
  }

  function renderTeams() {
    if (!els.teamsList) return;
    clear(els.teamsList);
    const teams = state.teams;
    if (teams.length === 0) {
      els.teamsList.appendChild(el('p', { class: 'empty', text: 'No teams. Add them on the setup page.' }));
      return;
    }
    teams.forEach(t => {
      const card = el('div', {
        class: 'team-card' + (t.status === 'archived' ? ' archived' : ''),
        tabindex: '0',
        onclick: () => openTeamPopup(t.id),
        onkeydown: e => { if (e.key === 'Enter') openTeamPopup(t.id); },
      }, [
        el('h3', { text: t.name + (t.status === 'archived' ? ' (archived)' : '') }),
        el('p', { text: `Remaining: ${money(t.remainingBudget)}` }),
        el('p', { class: 'hint', text: `of ${money(t.initialBudget)} · ${t.playersBought.length} bought` }),
        el('button', {
          type: 'button', class: 'remove-team-btn', text: t.status === 'archived' ? 'Archived' : 'Remove',
          disabled: t.status === 'archived' ? 'disabled' : null,
          onclick: e => {
            e.stopPropagation(); // never open the popup from an action button
            removeTeam(t);
          },
        }),
      ]);
      els.teamsList.appendChild(card);
    });
  }

  function renderPlayers() {
    if (!els.playersList) return;
    clear(els.playersList);
    const players = state.players;
    if (players.length === 0) {
      els.playersList.appendChild(el('p', { class: 'empty', text: 'No players. Add them on the setup page.' }));
      return;
    }
    players.forEach(p => {
      const isCurrent = p.id === state.auction.currentPlayerId;
      const card = el('div', { class: 'player-card' + (isCurrent ? ' current' : '') }, [
        el('h3', { text: p.name }),
        el('p', { text: `${p.category} · base ${money(p.basePrice)}` }),
        el('span', {
          class: 'tag tag-' + p.status,
          text: isCurrent ? 'on the block' : p.status.replace('_', ' '),
        }),
        p.status === 'sold'
          ? el('p', { class: 'hint', text: `→ ${p.teamName} for ${money(p.price)}` })
          : null,
        (p.status === 'available' || p.status === 'unsold')
          ? el('button', {
              type: 'button', class: 'remove-player-btn', text: 'Remove',
              onclick: e => { e.stopPropagation(); removePlayer(p); },
            })
          : null,
      ]);
      els.playersList.appendChild(card);
    });
  }

  function renderAuctionArea() {
    const player = state.auction.currentPlayerId ? state.currentPlayer : null;
    const live = state.auction.status === 'live';
    const paused = state.auction.status === 'paused';

    if (player) {
      if (player.image) {
        els.img.src = player.image;
        els.img.style.display = 'block';
      } else {
        els.img.removeAttribute('src');
        els.img.style.display = 'none';
      }
      els.name.textContent = player.name;
      els.category.textContent = player.category;
      els.base.textContent = String(player.basePrice);
    } else {
      els.img.removeAttribute('src');
      els.img.style.display = 'none';
      els.name.textContent = state.auction.status === 'concluded' ? 'Auction Concluded'
        : state.auction.status === 'setup' ? 'Not started'
        : state.players.length > 0 ? 'Waiting for next lot' : 'No Players';
      els.category.textContent = '—';
      els.base.textContent = '0';
    }

    const bid = state.auction.currentBid;
    els.highest.textContent = bid ? String(bid.amount) : '0';
    els.leader.textContent = bid ? bid.teamName : '—';

    const required = requiredNextBid();
    els.hint.textContent = player
      ? (required !== null ? `Minimum next bid: ${money(required)}` : '')
      : '';
    if (els.bidAmount && required !== null) els.bidAmount.min = String(required);

    // team select
    const activeTeams = state.teams.filter(t => t.status === 'active');
    if (selectedTeamId && !activeTeams.some(t => t.id === selectedTeamId)) selectedTeamId = '';
    const previous = selectedTeamId;
    clear(els.teamSelect);
    const placeholder = el('option', { value: '', text: 'Select Team' });
    placeholder.disabled = true;
    placeholder.selected = !previous;
    els.teamSelect.appendChild(placeholder);
    activeTeams.forEach(t => {
      const opt = el('option', { value: t.id, text: `${t.name} (${money(t.remainingBudget)})` });
      if (t.id === previous) opt.selected = true;
      els.teamSelect.appendChild(opt);
    });
    selectedTeamId = previous && activeTeams.some(t => t.id === previous) ? previous : '';

    // buttons
    const hasPlayer = Boolean(player);
    els.placeBid.disabled = !(live && hasPlayer && selectedTeamId);
    els.sell.disabled = !(live && hasPlayer && bid);
    els.unsold.disabled = !(live && hasPlayer);
    els.pause.disabled = !live;
    els.pause.textContent = live ? 'Pause' : paused ? 'Resume' : 'Pause';
    els.pause.dataset.action = live ? 'pause' : 'resume';
    els.pause.disabled = !(live || paused);
    els.end.disabled = !(live || paused);
  }

  function renderResults() {
    if (els.soldBody) {
      clear(els.soldBody);
      if (state.sales.length === 0) {
        els.soldBody.appendChild(el('tr', {}, [el('td', { colspan: '4', class: 'empty', text: 'No sales yet' })]));
      } else {
        state.sales.forEach(s => {
          els.soldBody.appendChild(el('tr', {}, [
            el('td', { text: s.playerName || '—' }),
            el('td', { text: state.players.find(p => p.id === s.playerId)?.category || '—' }),
            el('td', { text: s.teamName || '—' }),
            el('td', { text: money(s.price) }),
          ]));
        });
      }
    }
    if (els.unsoldList) {
      clear(els.unsoldList);
      const unsold = state.players.filter(p => p.status === 'unsold');
      if (unsold.length === 0) {
        els.unsoldList.appendChild(el('span', { class: 'empty', text: 'None yet' }));
      } else {
        unsold.forEach(p => els.unsoldList.appendChild(el('span', { class: 'tag tag-unsold', text: p.name })));
      }
    }
  }

  function render() {
    if (!state) return;
    renderStatus();
    renderTeams();
    renderPlayers();
    renderAuctionArea();
    renderResults();
  }

  // ---------- team popup (team cards only; players never open a popup) ----------
  function openTeamPopup(teamId) {
    if (!els.popup) return;
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;
    els.popupTitle.textContent = team.name;
    els.popupSubtitle.textContent =
      `Initial ${money(team.initialBudget)} · Remaining ${money(team.remainingBudget)}` +
      (team.status === 'archived' ? ' · archived' : '');
    clear(els.popupList);
    if (team.playersBought.length === 0) {
      els.popupList.appendChild(el('li', { class: 'empty', text: 'No players bought yet' }));
    } else {
      team.playersBought.forEach(p => {
        els.popupList.appendChild(el('li', { text: `${p.name} (${p.category}) — ${money(p.price)}` }));
      });
    }
    els.popup.classList.remove('hidden');
  }

  function closePopup() {
    if (els.popup) els.popup.classList.add('hidden');
  }

  if (els.popup) {
    $('close-popup').addEventListener('click', closePopup);
    els.popup.addEventListener('click', e => { if (e.target === els.popup) closePopup(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });
  }

  // ---------- destructive actions ----------
  async function removeTeam(team) {
    if (!confirm(`Remove team "${team.name}"? Teams with purchases are archived instead of deleted.`)) return;
    try {
      const res = await A.del(`/api/teams/${team.id}`);
      state = res.state;
      render();
      showMsg(res.result && res.result.archived
        ? `"${team.name}" has purchase history and was archived.`
        : `Team "${team.name}" removed.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  }

  async function removePlayer(player) {
    if (!confirm(`Remove player "${player.name}" from the pool? This cannot be undone.`)) return;
    try {
      const res = await A.del(`/api/players/${player.id}`);
      state = res.state;
      render();
      showMsg(`Player "${player.name}" removed.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  }

  // ---------- auction actions ----------
  els.teamSelect.addEventListener('change', () => {
    selectedTeamId = els.teamSelect.value;
    renderAuctionArea();
  });

  els.placeBid.addEventListener('click', async () => {
    const amount = Number(els.bidAmount.value);
    try {
      const res = await A.post('/api/bids', { teamId: selectedTeamId, amount });
      state = res.state;
      els.bidAmount.value = '';
      render();
      showMsg(`Bid of ${money(amount)} accepted.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  els.sell.addEventListener('click', async () => {
    const bid = state.auction.currentBid;
    const player = state.currentPlayer;
    if (!bid || !player) { showMsg('No valid bid to sell'); return; }
    if (!confirm(`Sell ${player.name} to ${bid.teamName} for ${money(bid.amount)}?`)) return;
    try {
      const res = await A.post('/api/sale');
      state = res.state;
      render();
      showMsg(`${player.name} sold to ${bid.teamName} for ${money(bid.amount)}.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  els.unsold.addEventListener('click', async () => {
    const player = state.currentPlayer;
    if (!player) { showMsg('No current player'); return; }
    if (!confirm(`Mark ${player.name} unsold? No budget will be deducted.`)) return;
    try {
      const res = await A.post(`/api/players/${player.id}/unsold`);
      state = res.state;
      render();
      showMsg(`${player.name} marked unsold.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  els.pause.addEventListener('click', async () => {
    const action = els.pause.dataset.action;
    try {
      const res = await A.post(action === 'pause' ? '/api/auction/pause' : '/api/auction/resume');
      state = res.state;
      render();
      showMsg(action === 'pause' ? 'Auction paused — bids are rejected.' : 'Auction resumed.', false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  els.end.addEventListener('click', async () => {
    if (!confirm('End the auction? Any player still on the block is marked unsold.')) return;
    try {
      const res = await A.post('/api/auction/conclude');
      state = res.state;
      render();
      window.location.href = 'conclusion.html';
    } catch (err) { showMsg(messageOf(err)); }
  });

  // ---------- boot ----------
  async function boot() {
    try {
      state = await A.get('/api/state');
      loadFailed = false;
      render();
    } catch (err) {
      loadFailed = true;
      showMsg(messageOf(err));
    }
    A.connect(snapshot => { state = snapshot; loadFailed = false; render(); });
    // Fallback poll if the first load failed (e.g. server started late).
    setInterval(async () => {
      if (loadFailed || !state) {
        try {
          state = await A.get('/api/state');
          loadFailed = false;
          render();
        } catch { /* still down */ }
      }
    }, 5000);
  }

  boot();
})();
