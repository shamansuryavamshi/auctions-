# Sports Auction Platform

Node.js + Express server with server-authoritative auction state, SSE live sync, host/participant separation, and the original three-page frontend (setup → live console → conclusion) plus a participant view.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm test           # full automated suite (node --test)
```

On first run a host token is generated and written to `data/host-token.txt` (also printed to the console in development). Set a stable one for real use:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# copy the value into .env as HOST_TOKEN=...   (see .env.example)
```

Pages:

| URL | Purpose | Access |
|---|---|---|
| `/index.html` | Host setup: teams, budgets, players, base prices, increment, review & start | host |
| `/live.html` | Host console: bidding, sell/unsold, pause/resume/end, team popups | host |
| `/view.html` | Participant view: current lot, bids, teams, sales — read only | public |
| `/conclusion.html` | Final statistics and summary | public |
| `/` | same as `/index.html` | host |

## Host token

- Sent as `x-host-token: <token>` or `Authorization: Bearer <token>` on every mutation.
- Entered once in the on-screen dialog on host pages; kept in `sessionStorage` (per tab, never in page source or responses).
- Never appears in API responses, SSE frames, HTML, or logs.
- Failed attempts are rate limited (5 per 10 minutes → 5-minute lock; configurable).
- **Deploy behind HTTPS only** — the token travels in headers.

## Participant access

`/view.html` is read-only by design: it only calls public GET endpoints and `/api/events`. Participants cannot reach any mutation (all guarded server-side — hiding buttons is not the mechanism).

## Configuration (.env)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST_TOKEN` | generated on first run | host management credential |
| `DATA_DIR` | `./data` | where `auction.json` lives |
| `AUTH_MAX_FAILURES` | `5` | failed host logins per window |
| `AUTH_WINDOW_MS` | `600000` | failure window (10 min) |
| `AUTH_LOCK_MS` | `300000` | lockout duration (5 min) |

## API

Public (read-only):

- `GET /api/health` — liveness + current sequence
- `GET /api/state` — authoritative snapshot (auction, teams, players, sales, bids, events, stats)
- `GET /api/auction/readiness` — `{ ready, errors[] }`
- `GET /api/history` — events + sales
- `GET /api/events` — Server-Sent Events stream (initial snapshot, `snapshot` events with `id:` = sequence, `: hb` heartbeats)

Host (require token):

- `POST /api/teams` `{ name, budget }` · `PATCH /api/teams/:id` · `DELETE /api/teams/:id`
- `POST /api/players` `{ name, category, basePrice, image }` · `PATCH /api/players/:id` · `DELETE /api/players/:id`
- `POST /api/auction/config` `{ bidIncrement }`
- `POST /api/auction/start` · `/pause` · `/resume` · `/conclude`
- `POST /api/auction/reset` `{ confirm: "RESET" }`
- `POST /api/bids` `{ teamId, amount }`
- `POST /api/sale` — atomic settlement of the current lot
- `POST /api/players/:id/unsold` (current player only)
- `POST /api/import-legacy` `{ teams, players }` — migrate old localStorage data

Errors are JSON: `{ "error": { "code", "message", "details" } }` with proper statuses (400/401/403/404/409/413/429/500).

## Data & storage

State lives in `data/auction.json` (versioned schema — see `DATA_MODEL.md`):

- single-process JSON store with an in-process write queue (serialized mutations),
- atomic writes (temp file + rename) plus a mirrored `auction.json.bak`,
- corrupt main file → restored from backup; corrupt with no backup → startup refuses and preserves the file (never silently resets),
- host token and other secrets are never written into auction data.

**Limitations:** a JSON file store is fine for a single-server, low-concurrency auction. It is not transactional across processes — do not run multiple server instances against one data directory, and use a real database if you scale out.

## Migrating old browser data

The original site kept teams/players in `localStorage`. Open the setup page, press **"Import it now"** (shown automatically when legacy keys exist), then the keys are removed after a successful import. Or POST the payload yourself to `/api/import-legacy`.

## Tests

`npm test` runs 59 tests covering: setup validation, empty-auction rejection, bid rules (base price, increment, affordability, paused/concluded states), duplicate & concurrent sale protection, single deduction, unsold handling, team-ID stability after removal/archival (P0 regression), ownership/category assignment, persistence across restart, corrupt-file recovery, authorization failures + rate limiting + token leakage checks, invalid payloads, SSE snapshots/updates/heartbeats, and final statistics.

## Project layout

```
server.js            entry point
src/config.js        env loading
src/app.js           express app wiring + error handling
src/store.js         JSON persistence, write queue, atomic replace
src/services/auction.js   all auction rules (pure, unit-testable)
src/routes/api.js    HTTP layer (validation → service → snapshot)
src/sse.js           SSE hub (read-only broadcast)
src/auth.js          host token check + brute-force guard
src/snapshot.js      public snapshot builder (no credentials)
public/              original pages + shared client
test/                node:test suites
data/                auction.json (gitignored)
```
