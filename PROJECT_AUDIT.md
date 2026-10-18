# PROJECT_AUDIT — Sports Auction Website

Audit date: 2026-10-18 · Scope: full static inspection + code-path analysis of every file in the project.
Findings are only listed where the source code supports them. Severity: P0 (data/security/money), P1 (core workflow), P2 (usability/maintainability), P3 (optional).

---

## 1. Current stack (as found)

| Item | Status |
|---|---|
| Files | `index.html/.css/.js`, `live.html/.css/.js`, `conclusion.html/.css/.js`, `.qodo/` (empty) |
| package.json | **Missing** |
| Node/Express/EJS | **Not present** — there are no routes, controllers, middleware, or templates |
| Server | None — the project is a pure static site opened from disk or any static host |
| Storage | `localStorage` keys `teams` and `players` (browser-only, per-device) |
| Auth / roles | None |
| Tests | None |
| Version control | Not a git repository |
| Runtime available | Node v24.20.0, npm 11.19.0 (installed on machine) |

**How to run today:** open `index.html` directly in a browser (works because no `fetch` is used), or serve the folder, e.g. `npx serve "C:\Users\Shaman M\OneDrive\Desktop\auctions"`.

**Honest note:** the master prompt asks to audit package.json / Express / EJS / routes. Those artifacts do not exist in this project; the audit below describes the real implementation instead of an assumed one.

## 2. Feature inventory (what exists and works)

- Add team (name + budget) with duplicate-name and empty/zero-budget checks — `index.js:17-51`
- Add player (name, category, image→Base64) with duplicate/type checks — `index.js:54-107`
- Navigate setup → live auction — `index.js:112-114`
- Live page: team cards, player pool cards, current player (image/name/category/highest bid/leading team)
- Place bid (must be higher than current bid; team budget must cover it) — `live.js:295-319`
- Sell player to leading team, deduct budget, remove from pool — `live.js:321-358`
- Team popup on card click (name, budget, purchased players with price) — `live.js:208-233, 258-273`
- End auction → conclusion page showing per-team remaining budget and leftover ("unsold") players

## 3. Defects and risks

### P0 — data integrity / money / security

1. **All state lives in `localStorage`; there is no server or shared authority.**
   Two devices or two tabs each hold an independent copy of teams, players, budgets and the current bid. A sale committed in one tab is invisible to the other, so the same player can be "sold" twice and budgets deducted twice with inconsistent totals. Multi-user auctions (host + participants) are impossible as architected. (All three JS files; `live.js:4-5`, `index.js:13-14`, `conclusion.js:4-5`.)

2. **Removing a team mid-auction corrupts which team receives a player and pays for it.**
   Teams are referenced by array index (`leadingTeamIndex`, `team-select` option values). `teamsList` click handler splices the array (`live.js:258-273`) without adjusting `leadingTeamIndex`. Example: leading team index 1, host removes team at index 0 → `teams[1]` is now a different team → the sale assigns the player and deducts the budget from the wrong team (`live.js:332-339`). This is an incorrect-budget defect.

3. **Bidding and sale rules are enforced only in the browser.**
   Any client can be modified to skip checks; there is no server validation of bid amount, increment, affordability, or auction status.

4. **Sale is not guarded by an auction-state token and budget is re-checked only at bid time.**
   Nothing verifies at commit time that (a) the player is still the current player, (b) the player has not already been sold, (c) the winning team's budget still covers the price. In a single tab this is masked by resetting `highestBid`; across tabs/storage reloads it produces double sales and negative budgets.

5. **XSS: names are interpolated into `innerHTML`.**
   `live.js:126-131, 147-151, 197-199, 215-227`, `conclusion.js:26, 32-37` build HTML with raw `${team.name}` / `${player.name}`. A player or team named `<img src=x onerror=...>` executes script in every page that renders it — critical once participant-supplied names exist.

### P1 — broken or missing core workflow

6. **Live page init throws a `TypeError`: `renderSoldPlayers()` runs against a null node.**
   `live.js:37` binds `#sold-players`, which exists only inside an HTML comment (`live.html:59-72`), so `document.getElementById` returns `null`. `renderSoldPlayers()` (`live.js:161`) then throws at init (`live.js:408`), which prevents `updateCurrentPlayerDisplay()` (`live.js:409`) from ever running → the page shows **"No Player"** even though players exist. The same throw occurs inside the sell handler (`live.js:356`) *after* localStorage was written (`live.js:351-352`) → data saved, UI not re-rendered until manual reload.

7. **No base price and no bid increment rules.**
   Players have no base-price field (`index.js:84-88`); a bid of ₹1 on a ₹100-base player is accepted. Only rule enforced is "greater than current bid" (`live.js:304`).

8. **No auction lifecycle status.** No started/paused/ended state — the live page accepts bids immediately, and "End Auction" (`live.js:371-399`) can be pressed at any moment with no confirmation, wiping the UI and leaving no record of *why* players are unsold.

9. **Players can only be permanently deleted, never marked unsold.**
   "Remove" buttons (`live.js:129, 150`) splice records with **no confirmation** and no recovery (`live.js:241-248, 261-268`). Deleted players vanish from the pool and from the conclusion — data loss, and the "unsold" list on the conclusion page is therefore wrong.

10. **Initial budget is destroyed by mutation.**
    `team.budget -= highestBid` (`live.js:339`) keeps only the remaining budget; no `initialBudget` is stored, so the required conclusion fields "each team's initial and remaining budget" and "budget utilization" cannot be computed.

11. **No host/participant separation.**
    Setup, live console, and management endpoints (there are none server-side) are all equally public; anyone opening `index.html` can add/remove teams and players. No authentication of any kind.

12. **Auction can be started in an invalid state.**
    "Start Live Auction" navigates unconditionally (`index.js:112-114`) with 0 teams or 0 players; there is no review/confirmation screen.

13. **Conclusion page is far short of the required summary.**
    It shows only remaining budget + leftover players (`conclusion.js`) — no total players, sold/unsold counts, total expenditure, initial budgets, purchase price/category per player, or utilization. Totals are not computed at all.

14. **Player card click opens a player-details popup** (`live.js:251-256`), violating the required interaction rule that only team cards open popups.

### P2 — usability, responsiveness, maintainability

15. `index.html:7` uses absolute `/index.css` — breaks whenever the site is served from a subpath (the other pages use relative links).
16. No responsive rules: `live.css:37-45` fixes a 3-column grid with no media queries; cards/lists overflow on phones.
17. Inconsistent units: live page prints `₹100`, conclusion prints `₹100 Cr` for the same value (`conclusion.js:26,34`).
18. All feedback is `alert()`; no inline success/error/empty/loading states.
19. Dead code/CSS: commented-out results section (`live.html:59-72`), unused `#results` grid area (`live.css:84-86`), unused `renderSoldPlayers` wiring.
20. Duplicated reset/header/footer CSS across three stylesheets; no shared stylesheet.
21. Base64 images inside `localStorage` hit the ~5 MB quota quickly; no image size limit.
22. Fixed bottom-left footer on setup page overlaps content on small screens (`index.css:129-135`).
23. No package.json, no linting, no tests, no git history.

### P3 — optional

24. No auction statistics/leaderboard, no data export, no sound cues for new lots, no persistence across browser restarts beyond localStorage.

## 4. Reproduction notes (verified by code path)

- **"No Player" on load:** `#sold-players` appears only within `<!-- ... -->` in `live.html`; `getElementById` ignores commented markup → `renderSoldPlayers()` dereferences `null` before `updateCurrentPlayerDisplay()` runs (`live.js:408-409`).
- **Wrong-team sale:** remove team 0 while `leadingTeamIndex === 1`, then Sell → `teams[1]` at `live.js:330` resolves to the team that shifted into that slot.
- **XSS:** add a team named `<img src=x onerror=alert(1)>`, open live page → injected via `div.innerHTML` at `live.js:126`.
- **Start invalid auction:** add no teams, click "Start Live Auction" → navigates with no guard (`index.js:112`).

## 5. Risk summary

The application currently works only as a single-user, single-tab demo. The highest risks are money-related state (budgets, sales) living in mutable, index-addressed, browser-local data, and the absence of any server authority or validation. Phase 2 must establish authoritative server-side state before further UI work, or every UI fix will rest on an unreliable foundation.
