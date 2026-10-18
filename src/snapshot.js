// Public authoritative snapshot sent to every client (host + participant).
// Never includes the host token or any credential.

function buildSnapshot(state) {
  const teamsById = new Map(state.teams.map(t => [t.id, t]));
  const playersById = new Map(state.players.map(p => [p.id, p]));

  const current = state.auction.currentPlayerId
    ? playersById.get(state.auction.currentPlayerId) || null
    : null;

  const teams = state.teams.map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    initialBudget: t.initialBudget,
    remainingBudget: t.remainingBudget,
    playersBought: state.sales
      .filter(s => s.teamId === t.id)
      .map(s => {
        const p = playersById.get(s.playerId);
        return {
          playerId: s.playerId,
          name: p ? p.name : '(unknown)',
          category: p ? p.category : null,
          price: s.price,
        };
      }),
  }));

  const players = state.players.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    basePrice: p.basePrice,
    status: p.status,
    order: p.order,
    teamId: p.teamId,
    teamName: p.teamId && teamsById.get(p.teamId) ? teamsById.get(p.teamId).name : null,
    price: p.price,
    // image only for the current lot: keeps SSE payloads small
    image: p.id === state.auction.currentPlayerId ? p.image : undefined,
  }));

  const currentBid = state.auction.currentBid
    ? {
        ...state.auction.currentBid,
        teamName: teamsById.get(state.auction.currentBid.teamId)?.name || null,
      }
    : null;

  const sold = state.players.filter(p => p.status === 'sold');
  const unsold = state.players.filter(p => p.status === 'unsold');
  const available = state.players.filter(p => p.status === 'available');
  const inProgress = state.players.filter(p => p.status === 'in_progress');
  const totalSpent = state.sales.reduce((sum, s) => sum + s.price, 0);

  return {
    sequence: state.auction.sequence,
    auction: {
      id: state.auction.id,
      status: state.auction.status,
      currentPlayerId: state.auction.currentPlayerId,
      currentBid,
      config: state.auction.config,
      createdAt: state.auction.createdAt,
      startedAt: state.auction.startedAt,
      pausedAt: state.auction.pausedAt,
      concludedAt: state.auction.concludedAt,
    },
    currentPlayer: current
      ? {
          id: current.id,
          name: current.name,
          category: current.category,
          basePrice: current.basePrice,
          status: current.status,
          image: current.image,
        }
      : null,
    teams,
    players,
    sales: state.sales.map(s => ({
      ...s,
      playerName: playersById.get(s.playerId)?.name || null,
      teamName: teamsById.get(s.teamId)?.name || null,
    })),
    recentBids: state.bids.slice(-25).map(b => ({
      ...b,
      playerName: playersById.get(b.playerId)?.name || null,
      teamName: teamsById.get(b.teamId)?.name || null,
    })),
    events: state.events.slice(-30),
    stats: {
      totalPlayers: state.players.length,
      soldCount: sold.length,
      unsoldCount: unsold.length,
      inProgressCount: inProgress.length,
      availableCount: available.length,
      totalSpent,
      teams: state.teams.map(t => {
        const purchases = state.sales.filter(s => s.teamId === t.id);
        const spent = purchases.reduce((sum, s) => sum + s.price, 0);
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          initialBudget: t.initialBudget,
          remainingBudget: t.remainingBudget,
          playersBought: purchases.length,
          spent,
          utilization: t.initialBudget > 0 ? Math.round((spent / t.initialBudget) * 10000) / 100 : 0,
        };
      }),
    },
  };
}

module.exports = { buildSnapshot };
