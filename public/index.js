/* Host setup page: teams, players, rules, review & start. */
(() => {
  const { el, clear, money, messageOf } = window.Auction;
  const A = window.Auction;

  A.requireHostToken();

  const msg = document.getElementById('setup-msg');
  const teamsReview = document.getElementById('teams-review');
  const playersReview = document.getElementById('players-review');
  const teamCount = document.getElementById('team-count');
  const playerCount = document.getElementById('player-count');
  const readinessBox = document.getElementById('readiness');
  const reviewBtn = document.getElementById('review-btn');
  const incrementInput = document.getElementById('bid-increment');
  const legacyBtn = document.getElementById('legacy-import');

  let state = null;

  function showMsg(text, isError = true) {
    msg.textContent = text;
    msg.className = 'form-msg ' + (isError ? 'error' : 'success');
    if (text) setTimeout(() => { if (msg.textContent === text) msg.textContent = ''; }, 6000);
  }

  async function loadReadiness() {
    try {
      const r = await A.get('/api/auction/readiness');
      clear(readinessBox);
      readinessBox.className = 'readiness ' + (r.ready ? 'ready' : 'not-ready');
      if (r.ready) {
        readinessBox.appendChild(el('span', { text: 'Setup complete — ready to start.' }));
      } else {
        readinessBox.appendChild(el('strong', { text: 'Cannot start yet:' }));
        const ul = el('ul');
        r.errors.forEach(e => ul.appendChild(el('li', { text: e })));
        readinessBox.appendChild(ul);
      }
      reviewBtn.disabled = !r.ready;
    } catch (err) {
      readinessBox.textContent = messageOf(err);
      readinessBox.className = 'readiness not-ready';
      reviewBtn.disabled = true;
    }
  }

  function render() {
    if (!state) return;
    const teams = state.teams;
    const players = state.players;
    teamCount.textContent = String(teams.length);
    playerCount.textContent = String(players.length);
    incrementInput.value = state.auction.config.bidIncrement;

    clear(teamsReview);
    if (teams.length === 0) {
      teamsReview.appendChild(el('p', { class: 'empty', text: 'No teams yet. Add at least one.' }));
    }
    teams.forEach(t => {
      teamsReview.appendChild(el('div', { class: 'review-item' }, [
        el('div', { class: 'review-main' }, [
          el('strong', { text: t.name }),
          el('span', { class: 'review-meta', text: `budget ${money(t.initialBudget)}` }),
        ]),
        t.status === 'archived' ? el('span', { class: 'tag tag-archived', text: 'archived' }) : null,
        el('button', {
          type: 'button', class: 'btn btn-danger btn-small', text: 'Remove',
          onclick: async () => {
            if (!confirm(`Remove team "${t.name}"? This cannot be undone.`)) return;
            try {
              const res = await A.del(`/api/teams/${t.id}`);
              state = res.state;
              render();
              showMsg(res.result && res.result.archived
                ? `"${t.name}" has purchases, so it was archived instead of deleted.`
                : `Team "${t.name}" removed.`, false);
            } catch (err) { showMsg(messageOf(err)); }
          },
        }),
      ]));
    });

    clear(playersReview);
    if (players.length === 0) {
      playersReview.appendChild(el('p', { class: 'empty', text: 'No players yet. Add at least one.' }));
    }
    players.forEach(p => {
      const statusTag = p.status !== 'available'
        ? el('span', { class: 'tag tag-' + p.status, text: p.status.replace('_', ' ') })
        : null;
      playersReview.appendChild(el('div', { class: 'review-item' }, [
        el('div', { class: 'review-main' }, [
          el('strong', { text: p.name }),
          el('span', { class: 'review-meta', text: `${p.category} · base ${money(p.basePrice)}` }),
        ]),
        statusTag,
        el('button', {
          type: 'button', class: 'btn btn-danger btn-small', text: 'Remove',
          onclick: async () => {
            if (!confirm(`Remove player "${p.name}"? This cannot be undone.`)) return;
            try {
              const res = await A.del(`/api/players/${p.id}`);
              state = res.state;
              render();
              showMsg(`Player "${p.name}" removed.`, false);
            } catch (err) { showMsg(messageOf(err)); }
          },
        }),
      ]));
    });

    loadReadiness();
  }

  async function refresh() {
    state = await A.get('/api/state');
    render();
  }

  // ---------- actions ----------
  document.getElementById('addteambdgt').addEventListener('click', async () => {
    const name = document.getElementById('teamNameInput').value.trim();
    const budget = document.getElementById('teambudgetinput').value;
    try {
      const res = await A.post('/api/teams', { name, budget });
      state = res.state;
      document.getElementById('teamNameInput').value = '';
      document.getElementById('teambudgetinput').value = '';
      render();
      showMsg(`Team "${name}" added.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  document.getElementById('save-config').addEventListener('click', async () => {
    try {
      const res = await A.post('/api/auction/config', { bidIncrement: Number(incrementInput.value) });
      state = res.state;
      render();
      showMsg(`Bid increment saved: ${money(res.state.auction.config.bidIncrement)}.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  document.getElementById('add-player').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    const category = document.getElementById('playerCategory').value;
    const basePrice = document.getElementById('playerBasePrice').value;
    const file = document.getElementById('playerImage').files[0];

    const finish = async (image) => {
      try {
        const res = await A.post('/api/players', { name, category, basePrice, image: image || null });
        state = res.state;
        document.getElementById('player-name').value = '';
        document.getElementById('playerCategory').value = '';
        document.getElementById('playerBasePrice').value = '';
        document.getElementById('playerImage').value = '';
        render();
        showMsg(`Player "${name}" added.`, false);
      } catch (err) { showMsg(messageOf(err)); }
    };

    if (!file) { finish(null); return; }
    if (!file.type.startsWith('image/')) { showMsg('Please select a valid image file'); return; }
    const reader = new FileReader();
    reader.onload = () => finish(reader.result);
    reader.onerror = () => showMsg('Error reading the file. Please try again.');
    reader.readAsDataURL(file);
  });

  // ---------- review & start ----------
  function openReview() {
    const teams = state.teams;
    const players = state.players;
    const rows = [
      el('p', { text: `${teams.length} team(s), ${players.length} player(s), bid increment ${money(state.auction.config.bidIncrement)}.` }),
      el('ul', { class: 'review-summary' }, teams.map(t =>
        el('li', { text: `${t.name} — ${money(t.initialBudget)}` }))),
      el('ul', { class: 'review-summary' }, players.map(p =>
        el('li', { text: `${p.name} (${p.category}) — base ${money(p.basePrice)}` }))),
      el('p', { class: 'hint', text: 'Starting freezes the player order and begins the first lot. Teams and players can no longer be added.' }),
    ];
    const startBtn = el('button', { type: 'button', class: 'btn btn-success', text: 'Confirm — Start Auction' });
    const backBtn = el('button', { type: 'button', class: 'btn', text: 'Back' });
    const box = el('div', { class: 'modal-box' }, [
      el('h2', { text: 'Review auction setup' }),
      ...rows,
      el('div', { class: 'modal-actions' }, [startBtn, backBtn]),
    ]);
    const overlay = el('div', { class: 'popup', id: 'review-modal' }, [box]);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    backBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try {
        await A.post('/api/auction/start');
        close();
        window.location.href = 'live.html';
      } catch (err) {
        startBtn.disabled = false;
        box.insertBefore(el('p', { class: 'form-msg error', text: messageOf(err) }), box.firstChild);
      }
    });
  }

  reviewBtn.addEventListener('click', () => { if (state) openReview(); });

  // ---------- legacy migration ----------
  function legacyData() {
    try {
      const teams = JSON.parse(localStorage.getItem('teams') || 'null');
      const players = JSON.parse(localStorage.getItem('players') || 'null');
      if (Array.isArray(teams) && teams.length) return { teams };
      if (Array.isArray(players) && players.length) return { players };
    } catch { /* corrupt legacy data */ }
    if (localStorage.getItem('teams') || localStorage.getItem('players')) {
      return { teams: [], players: [] };
    }
    return null;
  }

  if (legacyData()) legacyBtn.hidden = false;
  legacyBtn.addEventListener('click', async () => {
    const data = legacyData() || {};
    if (!confirm('Import teams/players stored by the old version of this site?')) return;
    try {
      const res = await A.post('/api/import-legacy', data);
      localStorage.removeItem('teams');
      localStorage.removeItem('players');
      legacyBtn.hidden = true;
      state = res.state;
      render();
      showMsg(`Imported ${res.result.importedTeams} team(s) and ${res.result.importedPlayers} player(s) from browser storage.`, false);
    } catch (err) { showMsg(messageOf(err)); }
  });

  // ---------- boot ----------
  refresh().catch(err => showMsg(messageOf(err)));
  A.connect(snapshot => { state = snapshot; render(); });
})();
