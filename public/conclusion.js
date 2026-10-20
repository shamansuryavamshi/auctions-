/* Conclusion page: all totals derived from the server's authoritative state. */
(() => {
  const { el, clear, money, messageOf } = window.Auction;
  const A = window.Auction;

  const statsBox = document.getElementById('stats');
  const summary = document.getElementById('summary');
  const soldList = document.getElementById('sold-list');
  const unsoldDiv = document.getElementById('unsold-players');
  const notice = document.getElementById('conclusion-notice');

  function statCard(label, value) {
    return el('div', { class: 'stat-card' }, [
      el('span', { class: 'stat-value', text: value }),
      el('span', { class: 'stat-label', text: label }),
    ]);
  }

  function render(state) {
    const s = state.stats;

    if (notice) {
      if (state.auction.status !== 'concluded') {
        notice.hidden = false;
        notice.className = 'form-msg info';
        notice.textContent = `The auction is not finished yet (status: ${state.auction.status}). Showing current standings.`;
      } else {
        notice.hidden = true;
      }
    }

    clear(statsBox);
    statsBox.appendChild(statCard('Registered players', String(s.totalPlayers)));
    statsBox.appendChild(statCard('Sold', String(s.soldCount)));
    statsBox.appendChild(statCard('Unsold', String(s.unsoldCount)));
    statsBox.appendChild(statCard('Still on the block', String(s.inProgressCount + s.availableCount)));
    statsBox.appendChild(statCard('Total spend', money(s.totalSpent)));
    statsBox.appendChild(statCard('Teams', String(s.teams.length)));

    clear(summary);
    if (s.teams.length === 0) {
      summary.appendChild(el('p', { class: 'empty', text: 'No auction data found.' }));
    }
    s.teams.forEach(t => {
      const bought = state.players.filter(p => p.teamId === t.id);
      const boughtList = bought.length === 0
        ? el('p', { class: 'empty', text: 'No players bought' })
        : el('ul', { class: 'purchase-list' }, bought.map(p =>
            el('li', { text: `${p.name} (${p.category}) — ${money(p.price)}` })));

      summary.appendChild(el('div', { class: 'team-summary' + (t.status === 'archived' ? ' archived' : '') }, [
        el('h3', { text: t.name + (t.status === 'archived' ? ' (archived)' : '') }),
        el('div', { class: 'budget-row' }, [
          el('p', { text: `Initial budget: ${money(t.initialBudget)}` }),
          el('p', { text: `Remaining: ${money(t.remainingBudget)}` }),
          el('p', { text: `Spent: ${money(t.spent)} (${t.utilization}%)` }),
        ]),
        el('p', { class: 'hint', text: `${t.playersBought} player(s) purchased` }),
        boughtList,
      ]));
    });

    clear(soldList);
    const activeSales = state.sales.filter(sale => sale.status !== 'corrected');
    if (activeSales.length === 0) {
      soldList.appendChild(el('tr', {}, [el('td', { colspan: '4', class: 'empty', text: 'No players were sold' })]));
    } else {
      activeSales.forEach(sale => {
        const player = state.players.find(p => p.id === sale.playerId);
        soldList.appendChild(el('tr', {}, [
          el('td', { text: sale.playerName || '—' }),
          el('td', { text: player ? player.category : '—' }),
          el('td', { text: sale.teamName || '—' }),
          el('td', { text: money(sale.price) }),
        ]));
      });
    }
    const corrected = state.sales.filter(sale => sale.status === 'corrected');
    if (corrected.length > 0) {
      soldList.appendChild(el('tr', { class: 'corrected' }, [
        el('td', { colspan: '4', class: 'hint', text: `${corrected.length} corrected sale(s) excluded from results` }),
      ]));
    }

    clear(unsoldDiv);
    const unsold = state.players.filter(p => p.status === 'unsold');
    if (unsold.length === 0) {
      unsoldDiv.appendChild(el('p', { class: 'empty', text: 'No unsold players.' }));
    } else {
      const ul = el('ul', { class: 'unsold-list' });
      unsold.forEach(p => ul.appendChild(el('li', { text: `${p.name} (${p.category})` })));
      unsoldDiv.appendChild(ul);
    }
  }

  A.get('/api/state')
    .then(render)
    .catch(err => {
      if (statsBox) statsBox.innerHTML = '';
      if (summary) summary.appendChild(el('p', { class: 'form-msg error', text: messageOf(err) }));
    });

  A.connect(render);
})();
