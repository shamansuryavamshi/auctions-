/* Host setup page: teams, players, rules, review & start. */
(() => {
  const A = window.A;
  const { el, clear, money, showMsg } = A;

  const msg = document.getElementById('setup-msg');
  const teamsReview = document.getElementById('teams-review');
  const codesReview = document.getElementById('codes-review');
  const playersReview = document.getElementById('players-review');
  const teamCount = document.getElementById('team-count');
  const playerCount = document.getElementById('player-count');
  const readinessBox = document.getElementById('readiness');
  const reviewBtn = document.getElementById('review-btn');
  const incrementInput = document.getElementById('bid-increment');

  let state = null;
  let pendingImage = null;

  function render() {
    if (!state) return;
    const teams = A.activeTeams();
    const archived = state.teams.filter(t => t.status === 'archived');
    const players = state.players;
    teamCount.textContent = String(teams.length);
    playerCount.textContent = String(players.length);
    incrementInput.value = state.auction.bidIncrement;

    clear(teamsReview);
    if (!teams.length) teamsReview.appendChild(el('p', { class: 'empty', text: 'No teams yet. Add at least one.' }));
    [...teams, ...archived].forEach(t => {
      teamsReview.appendChild(el('div', { class: 'review-item' }, [
        el('div', { class: 'review-main' }, [
          el('strong', { text: t.name }),
          el('span', { class: 'review-meta', text: `budget ${money(t.initialBudget)} · ${t.players.length} player(s)` }),
        ]),
        t.status === 'archived' ? el('span', { class: 'tag tag-archived', text: 'archived' }) : null,
        el('button', {
          type: 'button', class: 'btn btn-danger btn-small', text: 'Remove',
          onclick: () => {
            if (!confirm(`Remove team "${t.name}"? This cannot be undone.`)) return;
            const res = A.removeTeam(t.id);
            if (!res.ok) showMsg(msg, res.error);
          },
        }),
      ]));
    });

    renderCodes();

    clear(playersReview);
    if (!players.length) playersReview.appendChild(el('p', { class: 'empty', text: 'No players yet. Add at least one.' }));
    players.forEach(p => {
      playersReview.appendChild(el('div', { class: 'review-item' }, [
        A.playerAvatar(p, 'sm'),
        el('div', { class: 'review-main' }, [
          el('strong', { text: p.name }),
          el('span', { class: 'review-meta', text: `${p.category} · base ${money(p.basePrice)}` }),
        ]),
        p.status !== 'available' ? el('span', { class: 'tag tag-' + p.status, text: p.status }) : null,
        el('button', {
          type: 'button', class: 'btn btn-danger btn-small', text: 'Remove',
          onclick: () => {
            if (!confirm(`Remove player "${p.name}"? This cannot be undone.`)) return;
            const res = A.removePlayer(p.id);
            if (!res.ok) showMsg(msg, res.error);
          },
        }),
      ]));
    });

    const errors = A.validateSetup();
    const ready = errors.length === 0 && state.auction.status === 'setup';
    readinessBox.className = 'readiness ' + (ready ? 'ready' : 'not-ready');
    clear(readinessBox);
    if (state.auction.status !== 'setup') {
      readinessBox.appendChild(el('span', { text: `Auction status: ${state.auction.status}. Setup is locked.` }));
      reviewBtn.disabled = true;
    } else if (ready) {
      readinessBox.appendChild(el('span', { text: 'Setup complete — ready to start.' }));
      reviewBtn.disabled = false;
    } else {
      readinessBox.appendChild(el('strong', { text: 'Cannot start yet:' }));
      const ul = el('ul');
      errors.forEach(e => ul.appendChild(el('li', { text: e })));
      readinessBox.appendChild(ul);
      reviewBtn.disabled = true;
    }
  }

  function renderCodes() {
    clear(codesReview);
    const teams = A.activeTeams();
    if (!teams.length) {
      codesReview.appendChild(el('p', { class: 'empty', text: 'No active teams yet.' }));
      return;
    }
    teams.forEach(t => {
      codesReview.appendChild(el('div', { class: 'review-item' }, [
        el('div', { class: 'review-main' }, [
          el('strong', { text: t.name }),
          el('span', { class: 'review-meta' }, t.code
            ? ['Share this code: ', el('span', { class: 'secret-code', text: t.code })]
            : ['no code yet']),
        ]),
        t.code
          ? el('button', {
              type: 'button', class: 'btn btn-small', text: 'Rotate',
              onclick: () => { A.ensureCode(t.id, true); },
            })
          : el('button', {
              type: 'button', class: 'btn btn-small', text: 'Create code',
              onclick: () => { A.ensureCode(t.id); },
            }),
      ]));
    });
  }

  // ---------- actions ----------
  document.getElementById('save-config').addEventListener('click', () => {
    const res = A.setIncrement(incrementInput.value);
    showMsg(msg, res.ok ? `Bid increment saved: ${money(A.state.auction.bidIncrement)}.` : res.error, !res.ok);
  });

  document.getElementById('add-team').addEventListener('click', () => {
    const name = document.getElementById('team-name').value;
    const budget = document.getElementById('team-budget').value;
    const res = A.addTeam(name, budget);
    if (!res.ok) { showMsg(msg, res.error); return; }
    document.getElementById('team-name').value = '';
    document.getElementById('team-budget').value = '';
    showMsg(msg, `Team added.`, false);
  });

  document.getElementById('generate-codes').addEventListener('click', () => {
    const n = A.generateMissingCodes();
    showMsg(msg, n ? `Created ${n} code(s).` : 'All teams already have codes.', !n ? false : false);
  });

  const imageInput = document.getElementById('player-image');
  const imagePreview = document.getElementById('image-preview');
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    pendingImage = null;
    imagePreview.hidden = true;
    if (!file) return;
    try {
      pendingImage = await A.resizeImage(file);
      imagePreview.src = pendingImage;
      imagePreview.hidden = false;
    } catch (err) {
      showMsg(msg, err.message);
      imageInput.value = '';
    }
  });

  document.getElementById('add-player').addEventListener('click', () => {
    const name = document.getElementById('player-name').value;
    const category = document.getElementById('player-category').value;
    const basePrice = document.getElementById('player-base').value;
    const res = A.addPlayer({ name, category, basePrice, image: pendingImage });
    if (!res.ok) { showMsg(msg, res.error); return; }
    document.getElementById('player-name').value = '';
    document.getElementById('player-category').value = '';
    document.getElementById('player-base').value = '';
    document.getElementById('player-image').value = '';
    pendingImage = null;
    imagePreview.hidden = true;
    showMsg(msg, 'Player added.', false);
  });

  // ---------- review & start ----------
  function openReview() {
    const teams = A.activeTeams();
    const players = state.players;
    const startBtn = el('button', { type: 'button', class: 'btn btn-success', text: 'Confirm — Start Auction' });
    const backBtn = el('button', { type: 'button', class: 'btn', text: 'Back' });
    const box = el('div', { class: 'modal-box' }, [
      el('h2', { text: 'Review auction setup' }),
      el('p', { text: `${teams.length} team(s), ${players.length} player(s), bid increment ${money(state.auction.bidIncrement)}.` }),
      el('ul', {}, teams.map(t => el('li', { text: `${t.name} — ${money(t.initialBudget)}` }))),
      el('ul', {}, players.map(p => el('li', { text: `${p.name} (${p.category}) — base ${money(p.basePrice)}` }))),
      el('p', { class: 'hint', text: 'Starting freezes setup and opens the first lot on the live console.' }),
      el('div', { class: 'modal-actions' }, [startBtn, backBtn]),
    ]);
    const overlay = el('div', { class: 'popup', id: 'review-modal' }, [box]);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    backBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    startBtn.addEventListener('click', () => {
      const res = A.startAuction();
      if (!res.ok) {
        box.insertBefore(el('p', { class: 'form-msg error', text: res.errors.join(' ') }), box.firstChild);
        return;
      }
      window.location.href = 'live.html';
    });
  }

  reviewBtn.addEventListener('click', () => { if (state && state.auction.status === 'setup') openReview(); });

  // ---------- data management ----------
  document.getElementById('export-btn').addEventListener('click', () => A.exportJSON());

  const importFile = document.getElementById('import-file');
  document.getElementById('import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = A.importJSON(JSON.parse(reader.result));
        showMsg(msg, res.ok ? 'Auction data imported.' : res.error, !res.ok);
      } catch {
        showMsg(msg, 'Could not parse that file.');
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset ALL auction data in this browser? Export a backup first!')) return;
    A.resetAll();
    showMsg(msg, 'All auction data reset.', false);
  });

  // ---------- boot ----------
  A.hostGate(() => A.subscribe(s => { state = s; render(); }));
})();
