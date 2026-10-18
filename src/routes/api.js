const express = require('express');
const service = require('../services/auction');
const { buildSnapshot } = require('../snapshot');
const { badRequest, ApiError } = require('../errors');
const { safeEqual } = require('../auth');

function createApiRouter({ store, hub, requireHost, requireParticipant, sessions, codeTracker, limits }) {
  const router = express.Router();
  const H = [requireHost]; // every mutation is explicitly guarded

  // ---------- public (read-only) ----------
  router.get('/health', (req, res) => {
    const state = store.snapshot();
    res.json({ status: 'ok', sequence: state.auction.sequence, auctionStatus: state.auction.status, uptime: process.uptime() });
  });

  router.get('/state', (req, res) => {
    res.json(buildSnapshot(store.snapshot()));
  });

  router.get('/auction/readiness', (req, res) => {
    res.json(store.read(state => service.readiness(state)));
  });

  router.get('/history', (req, res) => {
    const state = store.snapshot();
    res.json({ events: state.events, sales: state.sales });
  });

  // SSE is GET-only and cannot mutate state.
  router.get('/events', (req, res) => hub.handle(req, res, store));

  // ---------- participant identity (never involves the host token) ----------
  router.post('/participants/session', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (codeTracker.isLocked(ip)) {
      return next(new ApiError(429, 'rate_limited', 'Too many failed team-code attempts; try again later'));
    }
    const code = typeof (req.body && req.body.code) === 'string' ? req.body.code.trim().toLowerCase() : '';
    if (!code) return next(badRequest('code is required'));

    const state = store.snapshot();
    const team = state.teams.find(t =>
      t.status === 'active' && t.participantCode && safeEqual(t.participantCode.toLowerCase(), code));
    if (!team) {
      codeTracker.recordFailure(ip);
      return next(new ApiError(401, 'invalid_participant_code', 'That team code is not valid'));
    }
    codeTracker.recordSuccess(ip);
    const token = sessions.create(team.id);
    res.json({ ok: true, token, team: { id: team.id, name: team.name } });
  });

  router.get('/participants/me', requireParticipant, (req, res) => {
    const state = store.snapshot();
    const team = state.teams.find(t => t.id === req.participant.teamId);
    if (!team) {
      return res.status(401).json({
        error: { code: 'participant_unauthorized', message: 'Your team is no longer part of this auction' },
      });
    }
    res.json({
      team: {
        id: team.id, name: team.name, status: team.status,
        initialBudget: team.initialBudget, remainingBudget: team.remainingBudget,
      },
      auctionStatus: state.auction.status,
    });
  });

  router.post('/participants/logout', requireParticipant, (req, res) => {
    sessions.revoke(req.participant.token);
    res.json({ ok: true });
  });

  // ---------- host-only mutations ----------
  function mutate(fn) {
    return async (req, res, next) => {
      try {
        const { state, result } = await store.update(s => fn(s, req));
        res.json({ ok: true, result: result === undefined ? null : result, state: buildSnapshot(state) });
      } catch (err) {
        next(err);
      }
    };
  }

  router.post('/teams', H, mutate((state, req) => service.addTeam(state, req.body || {})));
  router.patch('/teams/:id', H, mutate((state, req) => service.updateTeam(state, req.params.id, req.body || {})));
  router.delete('/teams/:id', H, mutate((state, req) => service.removeTeam(state, req.params.id)));

  router.post('/players', H, mutate((state, req) => service.addPlayer(state, req.body || {}, limits)));
  router.patch('/players/:id', H, mutate((state, req) => service.updatePlayer(state, req.params.id, req.body || {}, limits)));
  router.delete('/players/:id', H, mutate((state, req) => service.removePlayer(state, req.params.id)));

  router.post('/auction/config', H, mutate((state, req) => service.setConfig(state, req.body || {})));
  router.post('/auction/start', H, mutate(state => service.startAuction(state)));
  router.post('/auction/pause', H, mutate(state => service.pauseAuction(state)));
  router.post('/auction/resume', H, mutate(state => service.resumeAuction(state)));
  router.post('/auction/conclude', H, mutate(state => service.concludeAuction(state)));

  router.post('/auction/reset', H, mutate((state, req) => {
    if (!req.body || req.body.confirm !== 'RESET') {
      throw badRequest('Send { "confirm": "RESET" } to permanently clear auction data');
    }
    return service.resetAuction(state);
  }));

  // Participant bidding: team identity comes ONLY from the session,
  // any teamId in the body is ignored by construction.
  router.post('/participant/bids', requireParticipant, mutate((state, req) =>
    service.placeBid(state, {
      teamId: req.participant.teamId,
      amount: req.body && req.body.amount,
      source: 'participant',
    })));

  router.post('/participant-codes', H, mutate(state => service.ensureParticipantCodes(state)));
  router.post('/teams/:id/participant-code', H, mutate((state, req) => service.rotateParticipantCode(state, req.params.id)));

  router.post('/sales/:id/correct', H, mutate((state, req) => {
    if (!req.body || req.body.confirm !== true) {
      throw badRequest('Send { "confirm": true } to apply this correction');
    }
    return service.correctSale(state, req.params.id);
  }));

  router.post('/bids', H, mutate((state, req) => service.placeBid(state, req.body || {})));
  router.post('/sale', H, mutate(state => service.confirmSale(state)));
  router.post('/players/:id/unsold', H, mutate((state, req) => {
    if (req.params.id !== state.auction.currentPlayerId) {
      throw new ApiError(409, 'conflict', 'Only the current player can be marked unsold');
    }
    return service.markUnsold(state);
  }));

  router.post('/import-legacy', H, mutate((state, req) => service.importLegacy(state, req.body || {}, limits)));

  return router;
}

module.exports = { createApiRouter };
