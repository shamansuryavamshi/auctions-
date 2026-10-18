# DATA_MODEL — `data/auction.json` (version 2)

Single document, whole-state persistence. Every mutation runs inside the store's write queue, is validated first, then written atomically (temp + rename) to this file with a mirrored `auction.json.bak`.

All cross-references use **stable string IDs** (`team_…`, `pl_…`, `bid_…`, `sale_…`, `auc_…`, `evt_…`) — never array positions.

```jsonc
{
  "version": 2,

  "auction": {
    "id": "auc_...",
    "status": "setup | live | paused | concluded",
    "currentPlayerId": "pl_... | null",       // the lot on the block
    "currentBid": {                           // highest live bid, null when none
      "bidId": "bid_...", "teamId": "team_...",
      "amount": 250, "timestamp": "ISO-8601"
    },
    "config": { "bidIncrement": 50, "currency": "₹" },
    "sequence": 12,                           // monotonically increasing state version (= SSE event id)
    "createdAt": "ISO-8601",
    "startedAt": "ISO-8601 | null",
    "pausedAt": "ISO-8601 | null",
    "concludedAt": "ISO-8601 | null"
  },

  "teams": [{
    "id": "team_...", "name": "Chennai",
    "initialBudget": 1000,                    // never mutated after setup edits
    "remainingBudget": 750,                   // only ever changed by committed sales (and corrections)
    "status": "active | archived",            // archived = disabled but retained with history
    "participantCode": "3f9a1c2d",            // 8-hex secret shared with that team's manager
    "createdAt": "ISO-8601",                  //   (never included in public snapshots/SSE)
    "archivedAt": "ISO-8601 | null"
  }],

  "players": [{
    "id": "pl_...", "name": "Dhoni",
    "category": "Batsman | Bowler | All-Rounder | Wicket-Keeper",
    "basePrice": 200,
    "image": "data:image/...;base64,... | null",   // ≤1.5 MB, kept server-side
    "status": "available | in_progress | sold | unsold",
    "order": 0,                               // frozen lot order at auction start
    "teamId": "team_... | null",              // set exactly once, on sale
    "price": 250 | null,                      // final price, set exactly once, on sale
    "createdAt": "ISO-8601",
    "resolvedAt": "ISO-8601 | null"           // when sold/unsold
  }],

  "bids":   [{ "id", "playerId", "teamId", "amount", "timestamp", "source" }],  // source: "host" | "participant", last 500
  "sales":  [{ "id", "playerId", "teamId", "price", "status", "timestamp", "correctedAt" }],  // status: "active" | "corrected"
  "events": [{ "id", "type", "message", "timestamp", "data" }]        // audit trail, last 500
}
```

Participant session tokens are **not** part of this document: they live only in server memory and are invalidated by a restart (participants re-join with their team code).

## Player lifecycle (enforced transitions)

```
available ──start/advance──▶ in_progress ──sell──▶   sold   (teamId + price set, budget deducted)
                                │
                                ├──mark unsold──▶  unsold  (no budget change)
                                │
                                └──conclude with lot open──▶ unsold (recorded as such)

sold / unsold  ──(no further transitions)──▶  removable from pool only if available/unsold

sold ──host correction (once per sale)──▶ available   (budget restored; sale kept as "corrected" audit record)
```

Invalid transitions are rejected with HTTP 409: selling twice, unsold→sold, deleting a sold player, deleting the current player, removing/editing a lot that is in progress.

## Team lifecycle

- `setup`: edited/removed freely (no sales possible yet). `DELETE` removes outright only in `setup` **and** only when no purchases exist.
- `live/paused/concluded`, or any team with purchases: `DELETE` **archives** (status `archived`) — purchase history and budgets are retained; archived teams cannot bid or be edited. Archiving the current leader clears the live bid (event recorded).

## Auction lifecycle

`setup →(start, readiness-validated)→ live ⇄ paused →(conclude)→ concluded`

- **start**: requires ≥1 active team, ≥1 available player, valid budgets/base prices/increment; freezes `order`; puts first available player `in_progress`.
- **bid** (only in `live`): amount integer ≥ required (`basePrice` for the first bid, else `highest + bidIncrement`), team `active`, `amount ≤ remainingBudget`, player `in_progress`.
- **sale**: single serialized operation — re-validates lot/winner/budget, marks sold, assigns `teamId`+`price`, deducts `remainingBudget` exactly once, appends `sales` + event, clears the bid, advances the queue. Repeat/concurrent requests → 409, state unchanged.
- **correction** (`POST /api/sales/:id/correct { confirm: true }`, host-only): allowed while live/paused/concluded. Marks the sale `corrected`, restores the winner's budget, returns the player to `available` (they re-enter the block on the next advance by frozen lot order). Exactly-once: a second correction of the same sale → 409; concurrent attempts resolve to one success. Bid history is never deleted.
- **unsold**: no budget movement; queue advances.
- **conclude**: any open lot becomes `unsold`; totals are always recomputed from `sales`/`players`/`teams`, never stored counters.

## Derivable (never stored as counters)

`stats` in every snapshot — total/sold/unsold/in-progress/available counts, `totalSpent`, per-team `spent`, `utilization %`, `remainingBudget` — computed from the records above on each read. Corrected sales are excluded from all derivations (`totalSpent`, per-team `spent`/`playersBought`, purchase lists).

## Public snapshot vs stored document

`GET /api/state` (and every SSE frame) returns a derived snapshot: IDs, names, budgets, statuses, prices, current lot (with image), last 25 bids, last 30 events, computed stats. Player images are included **only** for the current lot; credentials never exist in either form. Team `participantCode` values are never included in snapshots — the host retrieves them only from the host-authenticated code endpoints.
