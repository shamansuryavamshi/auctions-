const crypto = require('crypto');
const { badRequest, notFound, conflict } = require('../errors');
const { uid, isoNow } = require('../store');

// Sales that still count toward budgets/stats (corrected ones are audit-only).
function activeSales(state) {
  return state.sales.filter(s => s.status !== 'corrected');
}

function makeParticipantCode() {
  return crypto.randomBytes(4).toString('hex');
}

const CATEGORIES = ['Batsman', 'Bowler', 'All-Rounder', 'Wicket-Keeper'];
const MAX_EVENTS = 500;
const MAX_BIDS = 500;

function requireString(value, field, { max = 80 } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return trimmed;
}

function requireInt(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function checkImage(image, maxBytes) {
  if (image === undefined || image === null || image === '') return null;
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    throw badRequest('image must be a base64 data:image URL');
  }
  if (image.length > maxBytes) {
    throw badRequest(`image exceeds the ${Math.round(maxBytes / 1000)} KB limit`);
  }
  return image;
}

function addEvent(state, type, message, data = {}) {
  state.events.push({ id: uid('evt'), type, message, timestamp: isoNow(), data });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function getTeam(state, id) {
  const team = state.teams.find(t => t.id === id);
  if (!team) throw notFound(`Team ${id} not found`);
  return team;
}

function getPlayer(state, id) {
  const player = state.players.find(p => p.id === id);
  if (!player) throw notFound(`Player ${id} not found`);
  return player;
}

function currentPlayer(state) {
  if (!state.auction.currentPlayerId) return null;
  return state.players.find(p => p.id === state.auction.currentPlayerId) || null;
}

function assertAuctionStatus(state, allowed) {
  if (!allowed.includes(state.auction.status)) {
    const labels = {
      setup: 'The auction has not started',
      live: 'The auction is live',
      paused: 'The auction is paused',
      concluded: 'The auction has concluded',
    };
    throw conflict(labels[state.auction.status] || `Auction status is ${state.auction.status}`);
  }
}

// ---------- teams ----------

function addTeam(state, input) {
  const name = requireString(input.name, 'Team name');
  const initialBudget = requireInt(input.budget ?? input.initialBudget, 'Team budget', { min: 1 });
  if (state.teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    throw badRequest('A team with that name already exists');
  }
  const team = {
    id: uid('team'),
    name,
    initialBudget,
    remainingBudget: initialBudget,
    status: 'active',
    participantCode: makeParticipantCode(),
    createdAt: isoNow(),
    archivedAt: null,
  };
  state.teams.push(team);
  addEvent(state, 'team_added', `Team ${name} added with budget ${initialBudget}`, { teamId: team.id });
  return team;
}

function updateTeam(state, id, input) {
  const team = getTeam(state, id);
  if (team.status === 'archived') throw conflict('Archived teams cannot be edited');
  if (state.auction.status !== 'setup') {
    throw conflict('Teams can only be edited while the auction is in setup');
  }
  if (input.name !== undefined) {
    const name = requireString(input.name, 'Team name');
    if (state.teams.some(t => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest('A team with that name already exists');
    }
    team.name = name;
  }
  if (input.budget !== undefined || input.initialBudget !== undefined) {
    const budget = requireInt(input.budget ?? input.initialBudget, 'Team budget', { min: 1 });
    team.initialBudget = budget;
    team.remainingBudget = budget;
  }
  addEvent(state, 'team_updated', `Team ${team.name} updated`, { teamId: team.id });
  return team;
}

// Teams with purchases are archived (never silently deleted) so history stays intact.
function removeTeam(state, id) {
  const team = getTeam(state, id);
  const hasSales = state.sales.some(s => s.teamId === id);
  if (hasSales || state.auction.status !== 'setup') {
    if (team.status === 'archived') throw conflict('Team is already archived');
    team.status = 'archived';
    team.archivedAt = isoNow();
    if (state.auction.currentBid && state.auction.currentBid.teamId === id) {
      state.auction.currentBid = null;
      addEvent(state, 'bid_cleared', `Current bid cleared because ${team.name} was archived`, { teamId: id });
    }
    addEvent(state, 'team_archived', `Team ${team.name} archived (has purchase history)`, { teamId: id });
    return { team, archived: true };
  }
  state.teams = state.teams.filter(t => t.id !== id);
  if (state.auction.currentBid && state.auction.currentBid.teamId === id) {
    state.auction.currentBid = null;
  }
  addEvent(state, 'team_removed', `Team ${team.name} removed`, { teamId: id });
  return { team, archived: false };
}

// ---------- players ----------

function addPlayer(state, input, limits) {
  const name = requireString(input.name, 'Player name');
  const category = requireString(input.category, 'Category');
  if (!CATEGORIES.includes(category)) {
    throw badRequest(`Category must be one of: ${CATEGORIES.join(', ')}`);
  }
  const basePrice = requireInt(input.basePrice ?? 0, 'Base price', { min: 0 });
  const image = checkImage(input.image, limits.maxImageBytes);
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    throw badRequest('A player with that name already exists');
  }
  const player = {
    id: uid('pl'),
    name,
    category,
    basePrice,
    image,
    status: 'available', // available | in_progress | sold | unsold
    order: state.players.length,
    teamId: null,
    price: null,
    createdAt: isoNow(),
    resolvedAt: null,
  };
  state.players.push(player);
  addEvent(state, 'player_added', `Player ${name} (${category}) added`, { playerId: player.id });
  return player;
}

function updatePlayer(state, id, input, limits) {
  const player = getPlayer(state, id);
  if (player.status !== 'available' || state.auction.currentPlayerId === id) {
    throw conflict('Only players waiting in the pool can be edited');
  }
  if (input.name !== undefined) {
    const name = requireString(input.name, 'Player name');
    if (state.players.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
      throw badRequest('A player with that name already exists');
    }
    player.name = name;
  }
  if (input.category !== undefined) {
    const category = requireString(input.category, 'Category');
    if (!CATEGORIES.includes(category)) throw badRequest(`Category must be one of: ${CATEGORIES.join(', ')}`);
    player.category = category;
  }
  if (input.basePrice !== undefined) {
    player.basePrice = requireInt(input.basePrice, 'Base price', { min: 0 });
  }
  if (input.image !== undefined) {
    player.image = checkImage(input.image, limits.maxImageBytes);
  }
  addEvent(state, 'player_updated', `Player ${player.name} updated`, { playerId: id });
  return player;
}

function removePlayer(state, id) {
  const player = getPlayer(state, id);
  if (player.status === 'sold') {
    throw conflict('Sold players cannot be removed; void the sale through the correction workflow instead');
  }
  if (player.status === 'in_progress') {
    throw conflict('The current player cannot be removed; mark it unsold instead');
  }
  state.players = state.players.filter(p => p.id !== id);
  addEvent(state, 'player_removed', `Player ${player.name} removed from the pool`, { playerId: id });
  return player;
}

// ---------- auction lifecycle ----------

function readiness(state) {
  const errors = [];
  const activeTeams = state.teams.filter(t => t.status === 'active');
  if (activeTeams.length < 1) errors.push('At least one active team is required');
  if (state.players.length < 1) errors.push('At least one player is required');
  for (const t of state.teams) {
    if (t.status === 'active' && (!Number.isInteger(t.initialBudget) || t.initialBudget <= 0)) {
      errors.push(`Team ${t.name} has an invalid budget`);
    }
  }
  for (const p of state.players) {
    if (p.status !== 'available') errors.push(`Player ${p.name} is not available to start`);
    if (!Number.isInteger(p.basePrice) || p.basePrice < 0) errors.push(`Player ${p.name} has an invalid base price`);
  }
  if (!Number.isInteger(state.auction.config.bidIncrement) || state.auction.config.bidIncrement < 1) {
    errors.push('Bid increment must be a positive integer');
  }
  return { ready: errors.length === 0, errors };
}

function setConfig(state, input) {
  assertAuctionStatus(state, ['setup']);
  if (input.bidIncrement !== undefined) {
    state.auction.config.bidIncrement = requireInt(input.bidIncrement, 'Bid increment', { min: 1, max: 1000000000 });
  }
  addEvent(state, 'config_updated', `Bid increment set to ${state.auction.config.bidIncrement}`);
  return state.auction.config;
}

function advance(state) {
  const next = state.players
    .filter(p => p.status === 'available')
    .sort((a, b) => a.order - b.order)[0] || null;
  state.auction.currentPlayerId = next ? next.id : null;
  state.auction.currentBid = null;
  if (next) {
    next.status = 'in_progress';
    addEvent(state, 'lot_started', `Now auctioning ${next.name}`, { playerId: next.id });
  } else {
    addEvent(state, 'pool_empty', 'No more players are available for auction');
  }
}

function startAuction(state) {
  assertAuctionStatus(state, ['setup']);
  const r = readiness(state);
  if (!r.ready) throw conflict('Auction setup is incomplete', r.errors);
  state.auction.status = 'live';
  state.auction.startedAt = isoNow();
  addEvent(state, 'auction_started', 'Auction started');
  advance(state);
  return state.auction;
}

function pauseAuction(state) {
  assertAuctionStatus(state, ['live']);
  state.auction.status = 'paused';
  state.auction.pausedAt = isoNow();
  addEvent(state, 'auction_paused', 'Auction paused');
  return state.auction;
}

function resumeAuction(state) {
  assertAuctionStatus(state, ['paused']);
  state.auction.status = 'live';
  state.auction.pausedAt = null;
  addEvent(state, 'auction_resumed', 'Auction resumed');
  return state.auction;
}

function concludeAuction(state) {
  assertAuctionStatus(state, ['live', 'paused']);
  const current = currentPlayer(state);
  if (current && current.status === 'in_progress') {
    current.status = 'unsold';
    current.resolvedAt = isoNow();
    addEvent(state, 'player_unsold', `${current.name} marked unsold (auction concluded)`, { playerId: current.id });
  }
  state.auction.status = 'concluded';
  state.auction.currentPlayerId = null;
  state.auction.currentBid = null;
  state.auction.concludedAt = isoNow();
  addEvent(state, 'auction_concluded', 'Auction concluded');
  return state.auction;
}

function resetAuction(state) {
  const fresh = require('../store').freshState(state.auction.config);
  fresh.events = [{
    id: uid('evt'),
    type: 'auction_reset',
    message: 'Auction data was reset by the host',
    timestamp: isoNow(),
    data: {},
  }];
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, fresh);
  return state.auction;
}

// ---------- bidding ----------

function requiredNextBid(state) {
  const player = currentPlayer(state);
  if (!player) return null;
  if (!state.auction.currentBid) return Math.max(player.basePrice, 1);
  return state.auction.currentBid.amount + state.auction.config.bidIncrement;
}

function placeBid(state, input) {
  assertAuctionStatus(state, ['live']);
  const source = input.source === 'participant' ? 'participant' : 'host';
  const player = currentPlayer(state);
  if (!player || player.status !== 'in_progress') throw conflict('There is no player currently being auctioned');

  const teamId = requireString(input.teamId, 'teamId');
  const team = state.teams.find(t => t.id === teamId);
  if (!team) throw notFound('Team not found');
  if (team.status !== 'active') throw conflict(`Team ${team.name} is not eligible to bid`);

  const amount = requireInt(input.amount, 'Bid amount', { min: 1 });

  const required = requiredNextBid(state);
  if (amount < required) {
    throw conflict(`Bid must be at least ${required} for ${player.name} (base ${player.basePrice}, increment ${state.auction.config.bidIncrement})`, { required });
  }
  if (amount > team.remainingBudget) {
    throw conflict(`${team.name} does not have enough remaining budget (₹${team.remainingBudget})`);
  }

  const bid = { id: uid('bid'), playerId: player.id, teamId, amount, timestamp: isoNow(), source };
  state.bids.push(bid);
  if (state.bids.length > MAX_BIDS) state.bids.splice(0, state.bids.length - MAX_BIDS);
  state.auction.currentBid = { bidId: bid.id, teamId, amount, timestamp: bid.timestamp };
  addEvent(state, 'bid_placed', `${team.name} bid ${amount} for ${player.name}`, { playerId: player.id, teamId, amount, source });
  return bid;
}

// ---------- settlement ----------

function confirmSale(state) {
  assertAuctionStatus(state, ['live']);
  const player = currentPlayer(state);
  if (!player) throw conflict('There is no player currently being auctioned');
  if (player.status !== 'in_progress') throw conflict(`Player ${player.name} has already been resolved`);

  const bid = state.auction.currentBid;
  if (!bid) throw conflict('Cannot sell without a valid bid');

  const team = state.teams.find(t => t.id === bid.teamId);
  if (!team) throw conflict('Winning team no longer exists');
  if (team.status !== 'active') throw conflict(`Team ${team.name} is not eligible to receive a player`);
  if (!Number.isInteger(team.remainingBudget) || team.remainingBudget < bid.amount) {
    throw conflict(`${team.name} cannot afford ${bid.amount}; remaining budget is ₹${team.remainingBudget}`);
  }

  // --- single atomic settlement from here on ---
  player.status = 'sold';
  player.teamId = team.id;
  player.price = bid.amount;
  player.resolvedAt = isoNow();
  team.remainingBudget -= bid.amount;

  const sale = {
    id: uid('sale'),
    playerId: player.id,
    teamId: team.id,
    price: bid.amount,
    status: 'active', // -> 'corrected' via the host correction workflow
    timestamp: isoNow(),
  };
  state.sales.push(sale);
  addEvent(state, 'player_sold', `${player.name} sold to ${team.name} for ${bid.amount}`, {
    playerId: player.id, teamId: team.id, price: bid.amount, saleId: sale.id,
  });
  advance(state);
  return { sale, player, team };
}

// Host-only sale correction: atomic, exactly-once, fully audited.
function correctSale(state, saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) throw notFound('Sale not found');
  if (sale.status === 'corrected') throw conflict('This sale has already been corrected');

  const player = state.players.find(p => p.id === sale.playerId);
  const team = state.teams.find(t => t.id === sale.teamId);
  if (!player || player.status !== 'sold' || player.teamId !== sale.teamId || player.price !== sale.price) {
    throw conflict('Sale cannot be corrected safely: the sale and player records disagree');
  }
  if (!team) throw conflict('Sale cannot be corrected safely: the winning team no longer exists');
  if (!Number.isInteger(team.remainingBudget) || team.remainingBudget + sale.price > team.initialBudget) {
    throw conflict('Sale cannot be corrected safely: restoring the budget would exceed the initial budget');
  }

  // --- single atomic correction ---
  player.status = 'available';
  player.teamId = null;
  player.price = null;
  player.resolvedAt = null;
  team.remainingBudget += sale.price;
  sale.status = 'corrected';
  sale.correctedAt = isoNow();

  addEvent(state, 'sale_corrected',
    `Sale of ${player.name} to ${team.name} for ${sale.price} corrected; budget restored and player returned to the pool`,
    { saleId: sale.id, playerId: player.id, teamId: team.id, price: sale.price });
  return { sale, player, team };
}

function markUnsold(state) {
  assertAuctionStatus(state, ['live']);
  const player = currentPlayer(state);
  if (!player) throw conflict('There is no player currently being auctioned');
  if (player.status !== 'in_progress') throw conflict(`Player ${player.name} has already been resolved`);

  player.status = 'unsold';
  player.resolvedAt = isoNow();
  addEvent(state, 'player_unsold', `${player.name} marked unsold`, { playerId: player.id });
  advance(state);
  return player;
}

// ---------- stats ----------

function stats(state) {
  const sold = state.players.filter(p => p.status === 'sold');
  const unsold = state.players.filter(p => p.status === 'unsold');
  const inProgress = state.players.filter(p => p.status === 'in_progress');
  const available = state.players.filter(p => p.status === 'available');
  const totalSpent = activeSales(state).reduce((sum, s) => sum + s.price, 0);
  const teams = state.teams.map(t => {
    const purchases = activeSales(state).filter(s => s.teamId === t.id);
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
  });
  return {
    totalPlayers: state.players.length,
    soldCount: sold.length,
    unsoldCount: unsold.length,
    inProgressCount: inProgress.length,
    availableCount: available.length,
    totalSpent,
    teams,
  };
}

// ---------- participant team codes ----------

function ensureParticipantCodes(state) {
  let created = 0;
  for (const t of state.teams) {
    if (t.status === 'active' && !t.participantCode) {
      t.participantCode = makeParticipantCode();
      created++;
    }
  }
  if (created > 0) {
    addEvent(state, 'participant_codes_created', `Generated ${created} participant team code(s)`);
  }
  return state.teams
    .filter(t => t.status === 'active')
    .map(t => ({ teamId: t.id, name: t.name, code: t.participantCode }));
}

function rotateParticipantCode(state, teamId) {
  const team = getTeam(state, teamId);
  if (team.status === 'archived') throw conflict('Archived teams do not accept participants');
  team.participantCode = makeParticipantCode();
  addEvent(state, 'participant_code_rotated', `Participant code rotated for ${team.name}`, { teamId });
  return { teamId: team.id, name: team.name, code: team.participantCode };
}

// ---------- legacy migration ----------

function importLegacy(state, input, limits) {
  assertAuctionStatus(state, ['setup']);
  const legacyTeams = input && Array.isArray(input.teams) ? input.teams : null;
  const legacyPlayers = input && Array.isArray(input.players) ? input.players : null;
  if (!legacyTeams && !legacyPlayers) throw badRequest('Provide legacy { teams, players } arrays');

  let importedTeams = 0;
  let importedPlayers = 0;

  for (const t of legacyTeams || []) {
    const budget = Number(t && (t.budget ?? t.initialBudget));
    if (!t || typeof t.name !== 'string' || !t.name.trim() || !Number.isInteger(budget) || budget <= 0) continue;
    if (state.teams.some(x => x.name.toLowerCase() === t.name.trim().toLowerCase())) continue;
    addTeam(state, { name: t.name, budget });
    importedTeams++;
  }

  const categoryMap = {
    'Batsman': 'Batsman', 'Bowler': 'Bowler',
    'All-Rounder': 'All-Rounder', 'All-rounder': 'All-Rounder',
    'Wicket-Keeper': 'Wicket-Keeper', 'Wicket Keeper': 'Wicket-Keeper',
  };
  for (const p of legacyPlayers || []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
    const category = categoryMap[p.type || p.category] || 'Batsman';
    if (state.players.some(x => x.name.toLowerCase() === p.name.trim().toLowerCase())) continue;
    const image = typeof p.image === 'string' && p.image.startsWith('data:image/')
      && p.image.length <= limits.maxImageBytes ? p.image : null;
    addPlayer(state, { name: p.name, category, basePrice: Number(p.basePrice) || 0, image }, limits);
    importedPlayers++;
  }

  addEvent(state, 'legacy_import', `Imported ${importedTeams} teams and ${importedPlayers} players from browser storage`, {
    importedTeams, importedPlayers,
  });
  return { importedTeams, importedPlayers };
}

module.exports = {
  CATEGORIES,
  addTeam, updateTeam, removeTeam,
  addPlayer, updatePlayer, removePlayer,
  readiness, setConfig, startAuction, pauseAuction, resumeAuction, concludeAuction, resetAuction,
  placeBid, confirmSale, markUnsold, correctSale,
  requiredNextBid, stats, importLegacy, activeSales,
  ensureParticipantCodes, rotateParticipantCode,
  currentPlayer, getTeam, getPlayer, addEvent,
};
