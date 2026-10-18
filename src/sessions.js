const crypto = require('crypto');

// In-memory participant sessions (never persisted with auction data).
// A participant proves which team they belong to by entering the team's
// participant code; the server answers with a random session token that is
// bound server-side to that team. The token is never a host credential.
class SessionRegistry {
  constructor({ ttlMs = 12 * 60 * 60 * 1000, sweepMs = 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map(); // token -> { teamId, expiresAt }
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  create(teamId) {
    this.sweep();
    const token = crypto.randomBytes(24).toString('hex');
    this.map.set(token, { teamId, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  get(token) {
    if (!token || typeof token !== 'string') return null;
    const rec = this.map.get(token);
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      this.map.delete(token);
      return null;
    }
    return { teamId: rec.teamId };
  }

  revoke(token) {
    return this.map.delete(token);
  }

  sweep() {
    const now = Date.now();
    for (const [token, rec] of this.map) {
      if (rec.expiresAt < now) this.map.delete(token);
    }
  }

  stop() {
    clearInterval(this.sweepTimer);
  }
}

function participantTokenFromRequest(req) {
  const header = req.get('x-participant-token');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim();
  return '';
}

function createParticipantAuth(sessions) {
  return function requireParticipant(req, res, next) {
    const token = participantTokenFromRequest(req);
    const session = sessions.get(token);
    if (!session) {
      return res.status(401).json({
        error: {
          code: 'participant_unauthorized',
          message: 'A valid participant session is required. Join with your team code first.',
        },
      });
    }
    req.participant = { token, teamId: session.teamId };
    next();
  };
}

module.exports = { SessionRegistry, createParticipantAuth, participantTokenFromRequest };
