const crypto = require('crypto');
const { unauthorized, ApiError } = require('./errors');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function tokenFromRequest(req) {
  const header = req.get('x-host-token');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim();
  return '';
}

// Simple in-memory brute-force guard for host authentication.
class AttemptTracker {
  constructor({ maxFailures = 5, windowMs = 600000, lockMs = 300000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.map = new Map(); // ip -> { fails: [ts], lockedUntil }
  }

  isLocked(ip) {
    const rec = this.map.get(ip);
    if (!rec) return false;
    if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
    return false;
  }

  recordFailure(ip) {
    const now = Date.now();
    const rec = this.map.get(ip) || { fails: [], lockedUntil: 0 };
    rec.fails = rec.fails.filter(t => now - t < this.windowMs);
    rec.fails.push(now);
    if (rec.fails.length >= this.maxFailures) {
      rec.lockedUntil = now + this.lockMs;
      rec.fails = [];
    }
    this.map.set(ip, rec);
  }

  recordSuccess(ip) {
    this.map.delete(ip);
  }
}

function createHostAuth({ hostToken, auth = {} }) {
  const tracker = new AttemptTracker(auth);

  function requireHost(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (tracker.isLocked(ip)) {
      return next(new ApiError(429, 'rate_limited', 'Too many failed authentication attempts; try again later'));
    }
    const provided = tokenFromRequest(req);
    if (!provided || !safeEqual(provided, hostToken)) {
      tracker.recordFailure(ip);
      return next(unauthorized());
    }
    tracker.recordSuccess(ip);
    next();
  }

  return { requireHost, tracker };
}

module.exports = { createHostAuth, tokenFromRequest, safeEqual, AttemptTracker };
