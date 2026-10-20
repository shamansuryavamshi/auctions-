/* E2E server launcher: isolated data dir, dev-only token, wiped on every start. */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '.data');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

process.env.PORT = process.env.PORT || '4100';
process.env.DATA_DIR = dataDir;
process.env.HOST_TOKEN = 'e2e-dev-token';

require('../server.js');
