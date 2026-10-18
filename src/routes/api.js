const express = require('express');
const service = require('../services/auction');
const { buildSnapshot } = require('../snapshot');
const { badRequest, ApiError } = require('../errors');

function createApiRouter({ store, hub, requireHost, limits }) {
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
