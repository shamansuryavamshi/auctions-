/* Conclusion page: standings, sales, unsold, stats from authoritative state. */
(() => {
  const A = window.A;
  const { el, clear, money } = A;

  const statusBadge = document.getElementById('auction-status');
  const statGrid = document.getElementById('stat-grid');
  const standings = document.getElementById('standings');
  const soldList = document.getElementById('sold-list');
  const unsoldList = document.getElementById('unsold-list');

  const STATUS_LABEL = { setup: 'SETUP', live: '● LIVE', paused: 'PAUSED', concluded: 'CONCLUDED' };

  function render(state) {
    statusBadge.textContent = STATUS_LABEL[state.auction.status] || state.auction.status.toUpperCase();
    statusBadge.className = 'status-badge ' + state.auction.status;

    const sold = state.sales.filter(s => s.status === 'active');
    const corrected = state.sales.filter(s => s.status === 'corrected');
    const totalSpend = sold.reduce((sum, s) => sum + s.amount, 0);

    clear(statGrid);
    [
      { label: 'Teams', value: A.activeTeams().length },
      { label: 'Players listed', value: state.players.length },
      { label: 'Players sold', value: sold.length },
      { label: 'Total spend', value: money(totalSpend) },
    ].forEach(s => {
      statGrid.appendChild(el('div', { class: 'stat-card' }, [
        el('div', { class: 'value', text: String(s.value) }),
        el('div', { class: 'label', text: s.label }),
      ]));
    });

    clear(standings);
    const teams = [...A.activeTeams()].sort((a, b) => {
      const spentA = a.initialBudget - a.budget;
      const spentB = b.initialBudget - b.budget;
      return spentB - spentA;
    });
    if (!teams.length) {
      standings.appendChild(el('p', { class: 'empty', text: 'No teams yet.' }));
    } else {
      const table = el('table', { class: 'data-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Team' }), el('th', { text: 'Players' }),
          el('th', { text: 'Spent' }), el('th', { text: 'Remaining' }),
        ])),
        el('tbody', {}, teams.map(t => el('tr', {}, [
          el('td', { text: t.name }),
          el('td', { text: String(t.players.length) }),
          el('td', { text: money(t.initialBudget - t.budget) }),
          el('td', { text: money(t.budget) }),
        ]))),
      ]);
      standings.appendChild(table);
    }

    clear(soldList);
    if (!sold.length) {
      soldList.appendChild(el('p', { class: 'empty', text: 'Nothing sold yet.' }));
    } else {
      sold.forEach(s => {
        const player = A.playerById(s.playerId);
        const team = A.teamById(s.teamId);
        soldList.appendChild(el('div', { class: 'winner-row' }, [
          player ? A.playerAvatar(player, 'sm') : null,
          el('div', {}, [
            el('strong', { text: player ? player.name : 'Unknown' }),
            el('div', { class: 'review-meta', text: `${player ? player.category : ''} → ${team ? team.name : 'Unknown'}` }),
          ]),
          el('span', { class: 'price', text: money(s.amount) }),
        ]));
      });
    }

    if (corrected.length) {
      soldList.appendChild(el('p', {
        class: 'hint',
        text: `${corrected.length} corrected sale(s) excluded from results.`,
      }));
    }

    clear(unsoldList);
    const unsoldPlayers = state.players.filter(p => p.status === 'unsold');
    if (!unsoldPlayers.length) {
      unsoldList.appendChild(el('p', { class: 'empty', text: 'No unsold players.' }));
    } else {
      unsoldPlayers.forEach(p => {
        unsoldList.appendChild(el('div', { class: 'review-item' }, [
          A.playerAvatar(p, 'sm'),
          el('div', { class: 'review-main' }, [
            el('strong', { text: p.name }),
            el('span', { class: 'review-meta', text: `${p.category} · base ${money(p.basePrice)}` }),
          ]),
          el('span', { class: 'tag tag-unsold', text: 'unsold' }),
        ]));
      });
    }
  }

  document.getElementById('export-btn').addEventListener('click', () => A.exportJSON());
  A.subscribe(render);
})();
