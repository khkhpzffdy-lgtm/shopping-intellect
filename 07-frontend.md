# 07 — Frontend (PWA)

> **Load when:** building or changing any PWA surface; touching offline storage, the
> sync queue, or the service worker; designing the list/comparison UI; deciding what
> lives in client state vs server cache; planning the native (Capacitor) path.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton) ·
> `02-domain-model.md` (the meaning) · `04-database.md` (the schema) · `06-api-auth.md`
> (the wire contract this app consumes).
> **Standalone for:** the React/Vite/TS/Tailwind app, the Service Worker, IndexedDB, the
> background-sync queue, offline-first list mechanics, the two-mode list UX, the
> Zustand↔TanStack-Query split, and the Capacitor path to native. For endpoint shapes →
> `06` · entity meaning → `02` · storage → `04` · why the architecture is shaped this way
> → `01 §6/§7`.

-----

## 1. Purpose & the boundary

This document is canonical for the **client**: how the PWA is built, how it survives
offline, how it talks to `si/v1`, and how the demand-first model feels in the hand. It
does **not** re-decide architecture (`01`), re-define entities (`02`), re-specify storage
(`04`), or re-specify endpoints (`06`) — those are referenced as *arch. §n*, *02 §n*,
*04 §n*, *06 §n*, *D §n*.

**The one hard boundary** (arch. §3): the PWA talks **only** to the `si/v1` REST contract.
It never touches WordPress directly — no `wp-login`, no WP cookies, no `admin-ajax`. That
single rule is what makes the future native wrapper (§9) and the Stage-3 backend swap
frontend-invisible (arch. §7). Every data access in this document goes through `06`.

The product’s two defining client realities drive everything below: it must **work in a
store with no signal** (offline-first lists — D §7), and it is **demand-first** — the user
types their own term, sees every candidate across stores, and *chooses* rather than
answering “is this the same product?” (D §4, 02 §7).

-----

## 2. Fixed stack (applied, not re-decided — 03 §3, D §7)

|Tool                          |Role in the PWA                                                     |
|------------------------------|--------------------------------------------------------------------|
|**React 18**                  |UI (pinned — D §7)                                                  |
|**Vite**                      |Build / dev server                                                  |
|**TypeScript**                |Types across the `si/v1` contract (06 shapes → TS types)            |
|**Tailwind CSS**              |Styling                                                             |
|**Zustand**                   |Client state: UI, the working list, the offline mutation queue (§6) |
|**TanStack Query**            |Server-state cache over `si/v1` (§6)                                |
|**Service Worker + IndexedDB**|Offline shell + offline list storage + background-sync queue (§4/§5)|

**Capacitor is Stage 2** — **not installed now** (03 §4, D §7); it only *shapes* today’s
PWA-first choices (§9). Hosted on **Cloudflare Pages** at `app.<domain>` (arch. §4); the
one-domain rule is what makes the refresh cookie work (06 §5.3).

-----

## 3. App shell & boot

### 3.1 Shell from cache, instantly

The app is a **shell + data** split. The SW precaches the app shell (HTML, JS, CSS, icons)
on install, so a returning user — **online or offline** — gets an instant first paint from
cache before any network (arch. §6.1, §12). The shell renders the navigation and an empty
list frame; data hydrates from IndexedDB first (§4), then reconciles with the network.

### 3.2 Silent refresh & the in-memory token

On boot the app performs the **silent `POST /auth/refresh`** of 06 §7.1:

1. Fire `fetch('/auth/refresh', { method:'POST', credentials:'include' })`. The
   same-site `httpOnly` cookie authenticates it (06 §5.3); **no token is read from JS**.
1. On `200`: hold the returned **access JWT in memory only** — a module-scoped variable /
   Zustand non-persisted slice — **never `localStorage`/`sessionStorage`/IndexedDB** (XSS
   containment — arch. §6.1). Schedule a silent re-refresh ~1 min before `exp` (~15 min).
1. On `401`: route to login (offline boot skips this — see §3.3).

The access token lives **outside** TanStack Query’s cache and IndexedDB; it is attached
per request by a fetch wrapper that reads the in-memory value and sets
`Authorization: Bearer …`. A `401 token_expired` mid-session triggers one silent refresh +
retry before falling back to login.

### 3.3 Offline boot

If boot is offline, the shell still renders and **cached lists open and are editable from
IndexedDB** (§4) — the most frequent user action survives a total backend outage (arch.
§12). Refresh is deferred; mutations queue (§5); read endpoints serve from cache. The app
shows the “updated X ago” staleness indicator (§4.3) rather than blocking.

### 3.4 Install-as-app

A standard PWA manifest (name, icons, `display: standalone`, theme color) plus an
**“Install as app” prompt** surfaced at a sensible moment (after the user has created or
opened a list, not on first paint) — D §7.

-----

## 4. Offline-first lists (the critical path — D §7, arch. §6.5)

The user is **in the store, without signal**, checking items off. That flow must be
flawless offline. Three browser primitives carry it: the **Service Worker**, **IndexedDB**,
and a **background-sync queue**.

### 4.1 IndexedDB as the local source of truth for lists

Lists, list items, and the user’s UserProducts are **mirrored into IndexedDB** so the list
UI reads from local storage first and renders instantly, online or off. Object stores
(illustrative; not a server schema — that’s `04`):

- `lists` — list rows keyed by server `id`, plus any not-yet-synced list keyed by
  `client_uuid`.
- `list_items` — keyed by `client_uuid` (the stable offline identity — arch. §6.5), with
  the server `id` filled in after sync.
- `user_products` — keyed by `client_uuid`, carrying `term`, `normalized_term`,
  `category_id` (nullable until categorized — 02 §7), `brand_anchor`, `is_favorite`.
- `mutation_queue` — the outbound queue (§5).
- `meta` — last-sync timestamps per list (drives the staleness indicator, §4.3).

Comparison results and candidate lists are **server-derived and volatile**; they live in
TanStack Query’s cache (§6), **not** IndexedDB — they are meaningless offline (they need
current prices the server computes — 06 §6.4) and must never be shown stale-as-fresh.

### 4.2 UserProduct is offline-born → carries `client_uuid`

A UserProduct is created the moment a term is **first typed into a list** — which in this
product **routinely happens offline, in-store** (D §4/§9, arch. §6.5). So a UserProduct,
**exactly like a `list_item`**, is created locally with a **client-generated `client_uuid`**
and queued. The `06 POST …/items` inline-`user_product` form (06 §6.2) is built for
precisely this: one queued mutation can birth the term *and* the line together.

### 4.3 Sync model: idempotent replay, last-write-wins

- **Idempotent replay.** Every queued mutation carries its entity’s `client_uuid`. On
  replay the server returns the existing resource for a duplicate `client_uuid` rather than
  erroring (06 §6.2/§6.3, §8) — so a flaky connection that replays the same mutation twice
  is harmless.
- **Two devices, same term.** If two offline devices each coin a UserProduct for the same
  term, they carry **different `client_uuid`s but collide on `(owner, normalized_term)`**
  server-side; the server treats that duplicate-key as a **merge to the existing row**, not
  an error (04 §5.4). The client reconciles by adopting the server `id` the response
  returns and dropping its local duplicate. `client_uuid` keeps the *replay* idempotent;
  the composite unique keeps the *term* singular.
- **Conflicts: last-write-wins on server `updated_at`** (D §9, arch. §6.5). No merge-UX in
  MVP. The server clock is authoritative; the client surfaces **“updated X sec ago”** from
  the `meta` store so the user sees recency without a conflict dialog.

### 4.4 The Service Worker’s jobs

1. **Precache** the app shell; serve it cache-first (instant, offline boot — §3).
1. **Runtime cache** static assets and the public `GET /promotions` / `GET /categories`
   browse reads (06 §6.5) with a short TTL — they are cross-user and edge-cacheable
   anyway (arch. §9).
1. **Never cache** authenticated personalized reads (`/lists/*`, `/comparison`,
   `…/candidates`) as if fresh — those are owned by TanStack Query + IndexedDB with their
   own freshness rules.
1. **Background Sync** — register a sync tag when a mutation is queued; the SW flushes the
   queue (§5) on reconnect even if the app tab is closed (where the browser supports
   Background Sync; otherwise an in-app reconnect listener flushes — §5.3).

-----

## 5. The background-sync queue

### 5.1 What a queued mutation is

An append-only IndexedDB log of offline edits — list/item/user-product creates, item
checks, quantity edits, favorite toggles, brand anchors. Each record:

```
{ client_uuid, endpoint, method, body, created_at, attempts, status }
```

`client_uuid` is the entity’s stable identity (§4.2); `endpoint`/`method`/`body` are the
exact `06` call to replay; `status ∈ {pending, in_flight, done, failed}`.

### 5.2 Ordering & dependencies

Replay is **FIFO within a list** to preserve causality — a list must exist before its
items, a UserProduct before the line that references it. The inline-create form (06 §6.2)
removes the most common ordering hazard by birthing the term and line in **one** mutation.
Where a child references a parent created in the same batch, the queue substitutes the
server `id` returned for the parent’s `client_uuid` before sending the child.

### 5.3 Flush triggers & retry

- **Triggers:** SW Background Sync on reconnect (§4.4); plus an in-app `online` event
  listener and an on-focus check, as a fallback for browsers without Background Sync (iOS
  Safari notably — §9 also rides on this).
- **Retry:** exponential backoff on network/`5xx`. A `409 duplicate_client_uuid` is **not**
  a failure — it means the server already has it; mark `done` and reconcile the server `id`
  (§4.3). A `4xx` that is a real rejection (e.g. `404 list_not_found` because the list was
  deleted elsewhere) moves the record to `failed` and surfaces a non-blocking notice; it
  never wedges the queue.

### 5.4 Reconciliation on success

On a `2xx`, the client writes the server `id` back into the IndexedDB mirror (keyed by
`client_uuid`), updates `meta.last_sync`, and **invalidates the relevant TanStack Query
keys** (§6.3) so any open comparison/candidate views refetch fresh server truth.

-----

## 6. State layers — Zustand vs TanStack Query

Two stores with a clean split; the reconciliation rule between them is the important part.

### 6.1 Zustand owns *client* state

- **UI state:** which list is open, **planning vs shopping mode** (§7), filters, modals,
  the install-prompt state.
- **The working list & offline mirror:** the optimistic local view of lists/items/
  user-products backed by IndexedDB (§4) — what the user sees and edits in-store.
- **The outbound mutation queue** (§5) and its status.
- **The in-memory access token** (§3.2) — a non-persisted slice, never written to disk.

Zustand is the **offline-authoritative** layer: in-store, with no network, the UI runs
entirely on Zustand + IndexedDB.

### 6.2 TanStack Query owns *server* state

- **Reads from `si/v1`:** `/lists`, `/lists/{id}`, `…/candidates`, `/comparison`,
  `/promotions`, `/families` — cached by query key, with staleness and background refetch.
- **Server-derived, volatile data** (comparison, candidates) lives **only** here — never
  IndexedDB (§4.1), because it depends on current server-side prices (06 §6.4) and must not
  be shown stale-as-fresh.
- Mutations that happen **online** can go through TanStack Query’s mutation + optimistic
  update directly; mutations made **offline** go through the Zustand queue (§5) and
  *converge* into the same cache on flush (§6.3).

### 6.3 How the two reconcile on reconnect

The seam is deliberate so the two never fight:

1. **Offline edits** are applied **optimistically to Zustand/IndexedDB immediately** and
   queued (§5). The user sees them at once.
1. On reconnect the queue flushes (§5); each success **invalidates the matching TanStack
   Query keys** (e.g. `['list', id]`, `['comparison', id]`, `['candidates', userProductId]`).
1. TanStack Query refetches server truth; the list view **rebases** onto it (last-write-
   wins — §4.3), reconciling server `id`s and dropping merged duplicates (§4.3).
1. Read-only server data (comparison, candidates) is simply refetched — it was never in
   IndexedDB, so there is nothing to merge, only to refresh.

Rule of thumb: **if it can be edited offline, Zustand+IndexedDB is authoritative until
sync; if it is computed by the server, TanStack Query is authoritative and it is never
trusted offline.**

-----

## 7. Two-mode list UX (the detail D §9 only signposts)

`decisions.md §9` fixes the *direction* — a **dual-mode** list — and explicitly leaves the
interaction detail to this document. The two modes serve two physically different moments.

### 7.1 Planning mode (at home, online)

The deciding surface. For each list item the user can **expand the candidates** (from
`GET …/candidates` — 06 §6.3) and see **every offer across all stores with promo
markers** (broad by default — D §4/§10). A **comparison panel** (from
`GET /lists/{id}/comparison` — 06 §6.4) shows **per-store basket totals**, the
**cheapest store highlighted**, and `not_available`/`promo` flags. This is where the user:

- browses candidates and, by **choosing**, performs the match (no yes/no dialog — §8);
- optionally **anchors a term to a brand** (§8);
- decides **where to shop** by reading the per-store totals.

Planning mode is **online-dependent** by nature — it needs current prices the server
computes (06 §6.4 invariant: no request-time crawl, pure MySQL) — and degrades to “comparison
unavailable, reconnect to compare” when offline (arch. §12), while the list itself stays
fully editable.

### 7.2 Shopping mode (in-store, often offline)

The **calm, low-friction** surface. The comparison is **out of the way**; the screen is a
**large-target checklist** for one-tap checking while walking the aisles (D §9). Design
intent: big tap targets, minimal chrome, no price tables competing for attention, readable
at arm’s length with a trolley in hand. Checking an item:

- flips `is_checked` locally (Zustand/IndexedDB) **instantly, offline-safe**, and queues
  the `PATCH …/items/{id}` (06 §6.2);
- that check is also what **appends a `purchase_log` row** server-side on sync (the
  recently/frequently-bought substrate — 06 §6.2, 02 §6).

Shopping mode is **fully offline-capable** — it is exactly the in-store-no-signal case the
whole offline-first decision exists for (§4, D §7).

### 7.3 Switching between modes

A single, obvious toggle on the list surface flips planning↔shopping; it is **pure
client/UI state in Zustand** (§6.1), no server round-trip, so it works offline. The mode
is remembered per list. Optionally the app can **suggest** shopping mode (e.g. when the
user opts to “start shopping”), but the switch is always manual and reversible — no
automatic mode changes that could surprise someone mid-aisle.

-----

## 8. Demand-first flows in the client

Each maps to a `06` call and embodies a `decisions.md`/`02` rule.

- **Typing a term → a UserProduct.** Typing a new item into a list creates a UserProduct
  locally with a `client_uuid` and queues it (often offline — §4.2). On the wire it is the
  inline `user_product` of `POST …/items` (06 §6.2). The user never picks from a global
  catalog; **their term is the entry point** (D §4).
- **Opening a product → candidates → match by selection.** Tapping a list item opens its
  **candidate offers across all stores with promo markers** (`GET …/candidates` — 06 §6.3).
  **There is no “is this the same product? yes/no” dialog** — browsing and choosing *is*
  the match (D §4, 02 §7). A debatable categorization just shows as an odd extra candidate
  the eye ignores; it never blocks.
- **Opt-in brand anchoring.** If brand matters, the user picks one candidate’s brand to
  **anchor** the term (`POST …/anchor` — 06 §6.3); the candidate/comparison views then
  **narrow** to that brand across stores. Clearing the anchor widens back to broad. Default
  is always **broad** (D §4).
- **Favorite toggle.** A heart on the UserProduct (`PATCH /user-products/{id}` —
  06 §6.3) sets `is_favorite`; offline-safe, queued, owner-level (02 §6).
- **Recently / frequently bought sections.** Derived owner-level lists from `purchase_log`
  via `GET /user-products?section=recent|frequent` (06 §6.3). They surface “things this
  household buys” for fast re-adding. The **“frequently bought” window/threshold is a
  tunable server default (04 §7.5) and remains an open product question (D §14)** — the
  client renders whatever count the server returns and must not hardcode a threshold (§10).

-----

## 9. Capacitor path to native (Stage 2 — direction only)

**Not built now** (03 §4, D §7). Recorded so today’s choices stay compatible:

- Stage 2 **wraps the existing React PWA** with **Capacitor** for App Store / Play Store —
  the same bundle, not a rewrite (D §7). Because the PWA already talks only to `si/v1`
  (§1), nothing about the data layer changes.
- Native capabilities it unlocks: **camera (barcode scan)** and **push notifications**
  (push via Firebase Cloud Messaging on its own D §11 trigger — 03 §4).
- The iOS Background-Sync gap (§5.3) is one concrete reason the Capacitor wrapper is
  attractive later — a native shell can flush the queue more reliably than mobile Safari —
  but the in-app reconnect/on-focus flush (§5.3) covers Stage 1 without it.
- A **full React Native migration** is considered **only if performance becomes a
  documented user complaint** (D §7) — not a default, not scheduled.

-----

## 10. Open questions this document carries (not invented here)

Referenced from `decisions.md §14`, surfaced where they touch the client; **no values
invented**:

- **Barcode scanner — MVP or Stage 2?** (D §14.) It is a **Capacitor camera capability**
  (§9), and Capacitor is **not** installed in Stage 1 (03 §4). A pure-web barcode scan
  (`BarcodeDetector` / a WASM decoder) is *technically* possible in the PWA but support is
  uneven across mobile browsers. **`07`’s leaning (flagged, §11): treat barcode scanning as
  Stage 2, arriving with the Capacitor wrapper** — but this is **referenced as open**, not
  decided, per D §14.
- **“Frequently bought” window & threshold.** (D §14, 04 §7.5.) A tunable **server**
  default; the client must render the server-returned count and **never hardcode** the
  window or threshold (§8). Referenced as open.
- **Empty-bucket candidate read shape** (06 §12): whether `…/candidates` returns
  `200`-empty vs `409 not_categorized` for a not-yet-categorized term. `07` renders the
  `200`-empty case as a non-blocking **“matching in progress”** state; it consumes whatever
  `06` settles on. Referenced, not decided here.

-----

## 11. Amendments to fold back into `decisions.md` (proposed)

One client-side leaning this document proposes, flagged rather than silently adopted:

1. **Barcode scanning is Stage 2, via the Capacitor camera path.** Rationale: it is a
   native-camera capability (§9) and Capacitor is deliberately deferred to Stage 2
   (03 §4); web `BarcodeDetector` support is too uneven for an MVP dependency. This is a
   **proposed resolution to the open D §14 “barcode scanner: MVP or Stage 2?” question** —
   confirm in `decisions.md §14`. (No schema/contract impact: `barcodes` already exists for
   crawl-side Phase-2 categorization — 04 §4.4 — independent of a client scanner.)

Everything else here applies existing decisions; nothing else is newly resolved.

-----

## 12. Frontend → document map

|Need                                                           |Lives in                        |
|---------------------------------------------------------------|--------------------------------|
|Endpoint shapes, JWT, refresh flow, CORS, errors this app calls|`06-api-auth.md`                |
|Entity meaning (UserProduct, CategoryBucket, purchase log)     |`02-domain-model.md`            |
|Tables, `client_uuid`, `(owner, normalized_term)` unique       |`04-database.md`                |
|Why the PWA is decoupled; offline-first as availability        |`01-architecture.md` (§6/§7/§12)|
|Per-stage technology & triggers (Capacitor, FCM)               |`03-tech-stack.md`              |
|Stage-2/3 native & extraction runbooks                         |`08-scaling-migration.md`       |
|Per-stage cost figures                                         |`09-risks-costs.md`             |

-----

*Last updated: June 2026 · Session 5 of 6 (Opus 4.8, High effort, Thinking OFF) · canonical
for the **PWA**: app shell & silent-refresh boot with the in-memory JWT, offline-first lists
on Service Worker + IndexedDB + a background-sync queue, the two-mode (planning / shopping)
list UX, the Zustand↔TanStack-Query split and its reconnect reconciliation, and the
Stage-2 Capacitor path. Built on the **demand-first** foundation — terms become
UserProducts (offline-born, `client_uuid`), candidates browsed across stores with promo
markers, **match by selection** (no yes/no dialog), opt-in brand anchoring, owner-level
favorite + recently/frequently-bought from the purchase log. Consumes the `si/v1` contract
of `06`; meaning defers to `02`, storage to `04`, skeleton to `01`, canon to
`decisions.md`. `<TABLE_PREFIX>` retained pending the final prefix (D §14).*