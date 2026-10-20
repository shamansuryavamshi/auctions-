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

Participants join from `/view.html` with a **team code** (shown to the host on the setup page, generated per team, never present in public snapshots/SSE). The server exchanges a valid code for a random session token bound to that team; bids go to `POST /api/participant/bids` with that token. The team a bid is credited to is derived **only** server-side from the session — any `teamId` in the request body is ignored.

- Sessions are in-memory only: a server restart invalidates them (participants simply re-join with their code). Sessions expire after ~12 hours.
- Participant tokens are not host credentials: they cannot call any host endpoint, and host tokens cannot call participant endpoints.
- Repeated wrong codes are rate limited per IP (10 per 15 minutes → 15-minute lock).
- Participants still cannot reach any host mutation (all guarded server-side — hiding buttons is not the mechanism).

### Sale correction (host)

The host console's sold table has an **Undo** button per sale (`POST /api/sales/:id/correct { confirm: true }`): the sale is marked `corrected` (kept as audit history, excluded from stats/purchases), the winning team's budget is restored, and the player returns to the available pool so they re-enter the block on the next advance. Each sale can be corrected at most once (409 on a second attempt); corrections are safe during live, paused, and concluded auctions.

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
- `POST /api/sales/:id/correct` `{ confirm: true }` — undo a sale: restore budget, return player to the pool (once per sale)
- `POST /api/players/:id/unsold` (current player only)
- `POST /api/participant-codes` — ensure every active team has a code; returns `{ teamId, name, code }[]`
- `POST /api/teams/:id/participant-code` — rotate a team's code
- `POST /api/import-legacy` `{ teams, players }` — migrate old localStorage data

Participant (require a participant session token):

- `POST /api/participants/session` `{ code }` → `{ ok, token, team }` (rate limited on failures)
- `GET /api/participants/me` → your team + current auction status
- `POST /api/participants/logout` — revoke the session
- `POST /api/participant/bids` `{ amount }` — bid as your team (identity comes from the session, never the body)

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

## Deploying to Railway

This app is a long-running Node server (SSE + in-memory sessions), so it needs a
process host — **not** a serverless platform (Vercel will fail with
`FUNCTION_INVOCATION_FAILED`). Railway works out of the box:

1. Push this repository to GitHub, then in [Railway](https://railway.app):
   **New Project → Deploy from GitHub repo →** select the repository.
   Railway auto-detects Node via `railway.json` (`npm start`, health check on `/api/health`).
2. Under **Variables**, set:
   - `HOST_TOKEN` — a long random secret; this unlocks the host setup page.
   - `DATA_DIR=/data` — only if you add a volume (next step).
3. *(Recommended)* **Settings → Volumes → Add Volume**, mount at `/data`.
   Without a volume, auction data lives on the ephemeral container filesystem
   and resets on every redeploy/restart. With the volume it survives.
4. Open the generated `*.up.railway.app` URL. You land on the setup page; it
   asks for the host token once (stored in that browser tab's session).

Notes: the server listens on `0.0.0.0` using Railway's injected `PORT`, and sets
`trust proxy` so the host-auth rate limiter counts per real visitor. Participant
sessions are in-memory by design — a redeploy makes participants re-join with
their team code (auction state itself is on disk and survives).

## Tests

`npm test` runs 84 tests covering: setup validation, empty-auction rejection, bid rules (base price, increment, affordability, paused/concluded states), duplicate & concurrent sale protection, single deduction, unsold handling, team-ID stability after removal/archival (P0 regression), ownership/category assignment, persistence across restart, corrupt-file recovery, authorization failures + rate limiting + token leakage checks, invalid payloads, SSE snapshots/updates/heartbeats, final statistics, participant sessions/codes/brute-force lockout/spoofed-teamId bids/credential separation, and sale correction (budget restore, exactly-once under concurrency, re-entry, post-conclude).

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
src/sessions.js      participant session registry + guard (in-memory)
src/snapshot.js      public snapshot builder (no credentials)
public/              original pages + shared client
test/                node:test suites
data/                auction.json (gitignored)
```
