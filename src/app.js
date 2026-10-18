const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { Store } = require('./store');
const { SseHub } = require('./sse');
const { createHostAuth } = require('./auth');
const { createApiRouter } = require('./routes/api');
const { ApiError } = require('./errors');
const { root } = require('./config');

async function createApp(config) {
  const store = new Store(config.dataDir);
  const initInfo = await store.init();

  let hostToken = config.hostToken;
  let generated = false;
  if (!hostToken) {
    generated = true;
    hostToken = crypto.randomBytes(24).toString('hex');
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(path.join(config.dataDir, 'host-token.txt'), hostToken, { mode: 0o600 });
    } catch (err) {
      console.error('[auth] could not persist generated host token:', err.message);
    }
  }

  const hub = new SseHub({ heartbeatMs: config.heartbeatMs });
  hub.attach(store);

  const { requireHost } = createHostAuth({ hostToken, auth: config.auth });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));

  app.use('/api', createApiRouter({ store, hub, requireHost, limits: { maxImageBytes: config.maxImageBytes } }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API endpoint' } });
  });

  app.use(express.static(path.join(root, 'public')));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ApiError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details === undefined ? null : err.details },
      });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON' } });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
    }
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  return { app, store, hub, hostToken, generated, initInfo };
}

module.exports = { createApp };
