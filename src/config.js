const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  let txt;
  try {
    txt = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["'](.*)["']$/, '$1');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function loadConfig(overrides = {}) {
  loadDotEnv(path.join(root, '.env'));

  const port = Number(overrides.port ?? process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  return {
    root,
    port,
    hostToken: overrides.hostToken ?? process.env.HOST_TOKEN ?? null,
    dataDir: overrides.dataDir ?? process.env.DATA_DIR ?? path.join(root, 'data'),
    maxImageBytes: overrides.maxImageBytes ?? 1500000,
    auth: {
      maxFailures: overrides.authMaxFailures ?? Number(process.env.AUTH_MAX_FAILURES ?? 5),
      windowMs: overrides.authWindowMs ?? Number(process.env.AUTH_WINDOW_MS ?? 600000),
      lockMs: overrides.authLockMs ?? Number(process.env.AUTH_LOCK_MS ?? 300000),
    },
    heartbeatMs: overrides.heartbeatMs ?? 25000,
  };
}

module.exports = { loadConfig, root };
