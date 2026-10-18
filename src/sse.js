const { buildSnapshot } = require('./snapshot');

// Server-Sent Events hub: read-only broadcast of committed state.
class SseHub {
  constructor({ heartbeatMs = 25000 } = {}) {
    this.clients = new Set();
    this.heartbeatMs = heartbeatMs;
  }

  attach(store) {
    store.onPublish = (state) => this.broadcast(buildSnapshot(state));
  }

  handle(req, res, store) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const send = (snapshot) => {
      try {
        res.write(`id: ${snapshot.sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch {
        this.clients.delete(entry);
      }
    };

    const entry = { send, res };
    this.clients.add(entry);

    // Initial authoritative snapshot (reconnects recover latest state, no replay).
    send(buildSnapshot(store.snapshot()));

    const heartbeat = setInterval(() => {
      try { res.write(': hb\n\n'); } catch { /* closed */ }
    }, this.heartbeatMs);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.clients.delete(entry);
      try { res.end(); } catch { /* already ended */ }
    };
    req.on('close', cleanup);
    req.on('error', cleanup);

    return cleanup;
  }

  broadcast(snapshot) {
    for (const entry of this.clients) {
      try {
        entry.send(snapshot);
      } catch {
        this.clients.delete(entry);
      }
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}

module.exports = { SseHub };
