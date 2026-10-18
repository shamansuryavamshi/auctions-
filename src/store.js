const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('./errors');

const DATA_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function isoNow() {
  return new Date().toISOString();
}

function freshState(config = {}) {
  return {
    version: DATA_VERSION,
    auction: {
      id: uid('auc'),
      status: 'setup', // setup | live | paused | concluded
      currentPlayerId: null,
      currentBid: null, // { bidId, teamId, amount, timestamp }
      config: {
        bidIncrement: Number.isInteger(config.bidIncrement) && config.bidIncrement > 0 ? config.bidIncrement : 10,
        currency: '\u20b9',
      },
      sequence: 0,
      createdAt: isoNow(),
      startedAt: null,
      pausedAt: null,
      concludedAt: null,
    },
    teams: [],
    players: [],
    bids: [],
    sales: [],
    events: [],
  };
}

function validateParsed(data) {
  if (!data || typeof data !== 'object') throw new Error('not an object');
  if (data.version !== DATA_VERSION) {
    throw new Error(`unsupported data version: ${data.version}`);
  }
  const a = data.auction;
  if (!a || typeof a !== 'object') throw new Error('missing auction');
  if (!['setup', 'live', 'paused', 'concluded'].includes(a.status)) throw new Error('bad status');
  if (!Array.isArray(data.teams) || !Array.isArray(data.players) ||
      !Array.isArray(data.sales) || !Array.isArray(data.bids) || !Array.isArray(data.events)) {
    throw new Error('missing collections');
  }
  if (!a.config || !Number.isInteger(a.config.bidIncrement) || a.config.bidIncrement < 1) {
    throw new Error('bad bid increment');
  }
  return data;
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'auction.json');
    this.tmpFile = path.join(dataDir, 'auction.json.tmp');
    this.bakFile = path.join(dataDir, 'auction.json.bak');
    this.state = null;
    this.queue = Promise.resolve();
    this.onPublish = null;
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });

    let raw = null;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (raw === null) {
      this.state = freshState();
      await this.persist(this.state);
      await fsp.copyFile(this.file, this.bakFile).catch(() => {});
      return { created: true, recovered: false };
    }

    let recovered = false;
    try {
      this.state = validateParsed(JSON.parse(raw));
    } catch (err) {
      const corruptCopy = `${this.file}.corrupt-${Date.now()}`;
      await fsp.copyFile(this.file, corruptCopy).catch(() => {});
      try {
        const bakRaw = await fsp.readFile(this.bakFile, 'utf8');
        this.state = validateParsed(JSON.parse(bakRaw));
        recovered = true;
        console.warn(`[store] auction.json was malformed (${err.message}); restored from ${path.basename(this.bakFile)}. Corrupt copy kept at ${path.basename(corruptCopy)}`);
      } catch {
        throw new Error(
          `Auction data at ${this.file} is malformed (${err.message}) and no valid backup exists. ` +
          `The file was preserved at ${corruptCopy}. Repair it manually or move it aside; nothing was reset.`
        );
      }
    }

    if (!recovered) {
      await fsp.copyFile(this.file, this.bakFile).catch(() => {});
    } else {
      await this.persist(this.state);
      await fsp.copyFile(this.file, this.bakFile).catch(() => {});
    }
    return { created: false, recovered };
  }

  snapshot() {
    return clone(this.state);
  }

  read(fn) {
    return fn(clone(this.state));
  }

  async update(fn) {
    const run = this.queue.then(async () => {
      const before = clone(this.state);
      let result;
      try {
        result = fn(this.state);
        this.state.auction.sequence += 1;
      } catch (err) {
        this.state = before;
        throw err;
      }
      try {
        await this.persist(this.state);
      } catch (err) {
        this.state = before;
        console.error('[store] persist failed:', err.message);
        throw new ApiError(500, 'persist_failed', 'Failed to persist auction state; the operation was rolled back.');
      }
      const snapshot = clone(this.state);
      if (this.onPublish) {
        try { this.onPublish(snapshot); } catch (err) { console.error('[store] publish failed:', err.message); }
      }
      return { state: snapshot, result };
    });

    this.queue = run.catch(() => {});
    return run;
  }

  async persist(state) {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const json = JSON.stringify(state, null, 2);
    await fsp.writeFile(this.tmpFile, json, 'utf8');
    await fsp.rename(this.tmpFile, this.file);
    // Best-effort mirror of the last known-good file for crash recovery.
    try {
      const bakTmp = `${this.bakFile}.tmp`;
      await fsp.writeFile(bakTmp, json, 'utf8');
      await fsp.rename(bakTmp, this.bakFile);
    } catch (err) {
      console.warn('[store] could not update backup file:', err.message);
    }
  }

  existsSync() {
    return fs.existsSync(this.file);
  }
}

module.exports = { Store, freshState, clone, uid, isoNow, DATA_VERSION };
