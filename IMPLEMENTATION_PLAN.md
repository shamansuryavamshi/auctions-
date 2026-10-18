# IMPLEMENTATION_PLAN — Sports Auction Website

Prioritized tasks derived from `PROJECT_AUDIT.md`. Each task lists dependencies and acceptance criteria.
Legend: P0 / P1 / P2 / P3 by severity.

---

## Architecture decision (Phase 2)

**Decision: introduce a minimal Node.js + Express server that owns all auction state; keep the existing HTML/CSS/vanilla-JS presentation layer.**

Why this is a documented reason to change the stack (not modernization for its own sake):

- Audited defect #1: state is browser-`localStorage`-only. The specification requires host *and participant* views of the same auction, server-enforced bid rules, and exactly-once sale/budget deduction. No amount of client code can provide shared authoritative state across devices.
- The machine already has Node v24.20.0 (built-in `node:test`, `fetch`, `fs`), so a server requires only one dependency: `express`.
- Real-time updates use **Server-Sent Events** (no extra dependency): server broadcasts state after every committed mutation; clients re-render from server state instead of local counters.

Resulting structure (adapted to this small app — no needless layers):

```
auctions/
  server.js               # HTTP server: static files, JSON API, SSE hub
  src/
    store.js              # data layer: load/save data/auction.json, in-process write lock
    services/auction.js   # auction rules: bid validation, sale settlement, unsold, budgets
    routes/api.js         # routes + input validation, maps service results to HTTP
  data/auction.json       # persistent state (created on first run)
  public/                 # existing pages, served statically
    index.html/.css/.js   # host setup (audit fixes + review screen)
    live.html/.css/.js    # host console (auction control) 
    view.html/.js         # participant/viewer page (read-only + server-validated bids)
    conclusion.html/.css/.js
  test/                   # node:test suites for store/service/API
  package.json
  PROJECT_AUDIT.md, IMPLEMENTATION_PLAN.md, README.md
```

Storage choice: a single JSON file with a serialized write lock and validate-before-commit service layer. Justified by scale (one auction, tens of players, single host writer); document in README that swapping `store.js` for a DB is the only change needed later. File writes are atomic (write temp + rename), so a crash cannot corrupt state.

---

## Phase 1 — Audit ✅ (this deliverable)

- [x] Inspect all files, classify defects → `PROJECT_AUDIT.md`
- [x] Plan with priorities and acceptance criteria → this file
- [x] Stack report + how to run (chat report)

## Phase 2 — Architecture & server foundation

| # | Task | Pri | Depends on | Acceptance criteria |
|---|------|-----|-----------|---------------------|
| 2.1 | Create `package.json`, install `express`, `npm start` script | P1 | — | `npm start` serves the app on a configurable port |
| 2.2 | `src/store.js`: JSON persistence, atomic write, in-process lock | P0 | 2.1 | Concurrent API calls never produce interleaved/corrupt writes; state survives restart |
| 2.3 | `src/services/auction.js`: state machine + rules (see list below) | P0 | 2.2 | Every rule in Phase 4 lives here, unit-tested |
| 2.4 | `src/routes/api.js`: `/api/state`, `/api/teams`, `/api/players`, `/api/bids`, `/api/sell`, `/api/unsold`, `/api/auction/status`, `/api/reset` | P0 | 2.3 | All mutations go through the API; no client-side state writes remain |
| 2.5 | SSE broadcast channel; clients render from `GET /api/state` | P0 | 2.4 | Two browser windows stay synchronized within one broadcast |
| 2.6 | Move existing pages into `public/`, fix `/index.css` absolute path | P2 | 2.1 | App works when served from any path |
| 2.7 | Move names/values rendering to `textContent` (XSS fix) everywhere | P0 | 2.5 | A team named `<img src=x onerror=alert(1)>` renders as literal text |
| 2.8 | Tests: `node --test` for store, service, API (incl. concurrent double-sell attempt) | P0 | 2.3-2.5 | `npm test` green; includes duplicate-sale and negative-budget cases |

## Phase 3 — Roles

| # | Task | Pri | Depends on | Acceptance criteria |
|---|------|-----|-----------|---------------------|
| 3.1 | Host console = `live.html` behind a host token (env var, default generated on first run, shown in console) | P1 | 2.4 | Without token: host actions return 401/403 |
| 3.2 | Participant page `view.html`: current player, current bid, leading team, bid history, team budgets, auction status | P1 | 2.5 | No setup forms or management buttons are reachable from this page |
| 3.3 | Optional participant bidding: POST `/api/bids` with same server rules; team identity via selected-team chip, not free admin powers | P2 | 2.3 | A modified client cannot bypass increment/affordability/status checks |
| 3.4 | Host-only mutations (`/api/teams`, `/api/players`, `/api/sell`, `/api/unsold`, `/api/auction/status`) require host token | P1 | 3.1 | Participants get 403 on every host endpoint |

## Phase 4 — Auction lifecycle (service rules)

State machine: `setup → ready → live ⇄ paused → concluded`.

| # | Task | Pri | Depends on | Acceptance criteria |
|---|------|-----|-----------|---------------------|
| 4.1 | Setup validation endpoint: ≥1 team, each budget > 0; ≥1 player with name/category/base price ≥ 0/image; no duplicates | P1 | 2.4 | Start blocked with a specific error message until valid; review screen shows full setup |
| 4.2 | Explicit start confirmation initializes auction state (queue order frozen, status = live) | P1 | 4.1 | Auction cannot be started twice; state initialized exactly once |
| 4.3 | Bid validation: status is `live`; player is current; bid ≥ next required bid (base price, else highest + increment); team exists; team budget ≥ resulting price; team is not the current leader (optional rule, documented); integer currency units | P0 | 4.2 | Every rejection returns a specific reason; valid bid updates highest bid + leader and broadcasts |
| 4.4 | Pause / resume controls with bid rejection while paused | P1 | 4.2 | Bid while paused → rejected with "auction paused" |
| 4.5 | **Sale settlement (atomic)**: re-verify current player, not already sold, winner exists, budget covers price → record sale once, assign player, deduct budget once, clear bid, advance queue. Idempotency: repeat requests for an already-sold player are rejected, not re-applied | P0 | 4.3 | Concurrent/double "Sell" clicks produce exactly one sale and one deduction (asserted in test) |
| 4.6 | **Unsold**: host marks player unsold → status recorded, no budget touched, player kept in records, queue advances | P1 | 4.2 | Unsold player appears in conclusion with status `unsold`; budget unchanged |
| 4.7 | Conclusion: totals derived from store — players registered/sold/unsold, total spend, per team: initial + remaining budget, players with price and category, utilization % | P1 | 4.5, 4.6 | All figures equal a recomputation from `data/auction.json`; no client counters |
| 4.8 | Mistake correction: host can void a sale (restores budget, returns player to pool as pending) with confirmation, recorded in an audit log | P2 | 4.5 | Voided sale restores budget exactly; log lists who/what/when |

## Phase 5 — Team cards & interaction rules

| # | Task | Pri | Depends on | Acceptance criteria |
|---|------|-----|-----------|---------------------|
| 5.1 | Team card click opens team popup: name, initial budget, remaining budget, purchased players with category + price | P1 | 2.5 | Popup content matches server state |
| 5.2 | Remove player-popup behavior; current player image/name always visible on the live page (already true — keep it) | P1 | 5.1 | Clicking anywhere on a player row does nothing destructive and opens no popup |
| 5.3 | Action buttons stop propagation / use dedicated handlers; destructive actions (remove team, remove player, end auction, void sale) require confirmation | P1 | 5.1 | Clicking Remove never opens the parent popup; cancelled confirmation changes nothing |
| 5.4 | Inline success/error/empty/loading states replace `alert()` | P2 | 2.5 | Every action shows feedback in-page; empty setup shows guidance text |

## Phase 6 — Visual polish (master prompt truncated here)

| # | Task | Pri | Acceptance criteria |
|---|------|-----|---------------------|
| 6.1 | Shared stylesheet for reset/header/footer/buttons; consistent typography scale | P2 | No duplicated base CSS across pages |
| 6.2 | Responsive breakpoints: single-column stacking under 900px, usable on 360px phones | P2 | No horizontal scroll at 360px; lists remain scrollable |
| 6.3 | Consistent currency formatting (`₹` + locale, unit documented) on all pages | P2 | Same number formats on live and conclusion |
| 6.4 | Live page visual hierarchy: current lot prominent, bid history panel, team grid, status badge (LIVE/PAUSED/ENDED) | P2 | Status visible at a glance; current lot is the visual focus |
| 6.5 | Image handling: size limit (e.g. 1 MB), aspect-ratio box, placeholder for missing image | P2 | Oversized upload rejected with message; layout never jumps |

## Phase 7 — Testing & hardening

- Unit: bid validation matrix, settlement idempotency, unsold, budget math, conclusion totals.
- API: full lifecycle test (setup → start → bids → pause/resume → sell → unsold → conclude) against an ephemeral server instance.
- Manual: two-window sync test; host-less participant access test.
- `README.md`: run instructions, host token, data file location, reset procedure.

## Execution order

1. Phase 1 ✅ → 2.1-2.8 → 4.1-4.7 (core money logic) → 3.1-3.4 → 5.x → 6.x → 7.
   Phases 3 and 5 depend on Phase 2; Phase 6 depends only on markup stability, so it may be interleaved once Phase 5 lands.

---

## Phase 2 execution status � COMPLETE (2026-10-18)

All Phase 2 tasks (2.1-2.8), core Phase 4 rules (4.1-4.7), Phase 3 auth (3.1, 3.4), Phase 5 interaction rules (5.1-5.3) and tests (Phase 7 core) implemented and verified: **59/59 automated tests pass** (`npm test`), end-to-end HTTP smoke test passed (setup ? start ? bid ? sell ? unsold ? conclude ? statistics, plus 401 on unauthenticated mutation).

- Bidding is host-operated (auctioneer console); participants are read-only � documented in `README.md`.
- Sale void/correction (task 4.8) and participant-side bidding (task 3.3) remain open as P2/P3 follow-ups.
- Visual redesign (Phase 6) not started, per instructions.

---

## Phase 3 execution status - COMPLETE (2026-10-18)

Phase 3 (participant identity + participant bidding, task 3.3) and Phase 4 task 4.8 (sale correction) implemented and verified: **84/84 automated tests pass** (
pm test = 59 prior + 25 new in test/participant.test.js and test/correction.test.js).

- Participant identity: server-issued sessions via POST /api/participants/session {code} (team codes, 8-hex, host-only visibility, brute-force rate limit); sessions are in-memory (restart invalidates - documented in README/DATA_MODEL).
- Participant bidding: POST /api/participant/bids {amount} - team derived ONLY from the session server-side; spoofed teamId in the body is ignored; host and participant credentials are not interchangeable.
- Sale correction: POST /api/sales/:id/correct {confirm:true} (host) - restores budget, returns player to the pool, marks the sale corrected (excluded from all derivations), audited via sale_corrected event, exactly-once under concurrency, works live/paused/concluded. Host console sold table has an Undo button.
- Frontend: participant join/bid panel with inline feedback on view.html; team-code management on host setup page; no visual redesign (Phase 6) started, per instructions.
