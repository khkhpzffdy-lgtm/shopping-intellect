# 13 — Implementation Line (the ordered Slice sequence, empty repo → MVP)

> **Load when:** deciding what to build next; authoring a Slice (this file says *which* one and
> *in what order*); checking whether a Slice's dependencies have shipped; tracking build progress.
> **Depends on:** `decisions.md` (the canon) · `12-execution-model.md` (defines the **Slice**, the
> loop, and "done" — this file is the *list* that model runs) · `CLAUDE.md` (the iron rules every
> Slice quotes) · the per-row canon refs below (`01`/`04`/`05`/`06`/`07`/`10`/`11`).
> **Standalone for:** the **ordered build sequence** — every Slice from empty repo to working MVP
> in dependency order, grouped into milestones, each with goal, dependencies, primary canon, and
> the Owner-checkable behaviour that closes it. It decides **no** product/architecture content;
> it **sequences** what `00`–`11` already decided. Per **D §15** this is the *full* ordered line,
> not a first-milestone sketch.

-----

## 0. How to read this file

Each Slice below is a **stub**, not the full Slice document — it carries everything Claude needs to
*author* the combined Slice (per `12 §2`) when the Owner asks for it: a stable id, goal,
dependencies, the canon to quote, the iron rules in play, and the observable acceptance the Owner
will check. The full pasteable Slice is generated on demand in a Claude planning session; this file
is the **map and the order**.

- **Id** — `§<milestone>.<slice>`, stable. Referenced by Slices and failure/escalation templates.
- **Dep** — Slice ids that must be **closed** (both gates, `12 §3`) before this one starts.
- **Canon** — the documents/sections the Slice must quote verbatim to Codex (Codex loads none of
  `00`–`11` itself — `12 §2`).
- **Iron** — the `CLAUDE.md §2` rules this Slice touches.
- **Owner sees** — the behaviour the Owner verifies to close it. Some early infra Slices have no
  user-facing screen; their Owner-check is an **operator/Admin** observation or a one-command run
  Codex wires for the Owner to trigger (never "read the code").

> **Slicing note.** Milestone M0–M2 are infrastructure with thin or operator-only acceptance; per
> `12 §2`'s rule, each is kept just large enough to expose *some* checkable behaviour (a CLI prints
> a row, an Admin page lists a count, an endpoint returns JSON in the browser). Genuinely invisible
> plumbing is folded into the first Slice whose behaviour it enables, never shipped as its own
> Owner-checkable Slice.

-----

## M0 — Skeleton & spine (the plugin can load, the DB exists, money is safe)

*No business behaviour yet; this is the WP-free spine every later Slice depends on. Acceptance is
operator-level: the plugin activates, tables appear, a value object round-trips in a test.*

### §0.1 — Plugin skeleton + PSR-4 autoloader
- **Goal:** the `shopping-intellect/` plugin activates cleanly in WordPress with the hand-written
  PSR-4 autoloader wiring `ShoppingIntellect\`.
- **Dep:** —
- **Canon:** `01 §5` (plugin tree: `src/{Api,Services,Repositories/{Contracts,Wpdb},Crawlers,Models,Support,Admin}`, `bin/`, `assets/`) · `03 §3.1` (no Composer) · `CLAUDE.md §1.7` (naming).
- **Iron:** no Composer (§2.2); namespace `ShoppingIntellect\`, plugin dir `shopping-intellect/` (§2.7).
- **Owner sees:** plugin appears and activates in *Plugins* with no error; deactivate/reactivate clean.

### §0.2 — Config, Clock, Logger, env scaffolding
- **Goal:** `Support/` provides injectable `Clock`, `Logger`, and `Config` (incl. resolving the `oCk_si_` table prefix from `$wpdb->prefix` + `si_`) so every later class receives them by constructor.
- **Dep:** §0.1
- **Canon:** `01 §1`/`§5` (constructor-injected `Clock`/`Logger`/`Config`) · `CLAUDE.md §2.1`.
- **Iron:** business logic reached only through injected interfaces (§2.1).
- **Owner sees:** (operator) a tiny `bin/` smoke command prints the resolved table prefix + current Sofia time via the injected `Clock` — proving wiring, not behaviour.

### §0.3 — `Money` value object
- **Goal:** integer-euro-cents `Money` with the fixed BGN→EUR conversion and `converted_from_bgn` flag.
- **Dep:** §0.1
- **Canon:** `01 §8` · `CLAUDE.md §2.4` · `decisions.md` Currency (1.95583, round half-up, `currency` const `EUR` Stage 1).
- **Iron:** money is integer cents, never float; fixed 1.95583, round half-up (§2.4).
- **Owner sees:** (operator) Codex's tests cover cents arithmetic + a known BGN→EUR conversion; Owner confirms tests green (this Slice's behaviour *is* its tests, `12 §3`).

### §0.4 — Schema & migrations (all `oCk_si_*` tables)
- **Goal:** activation creates the full MVP schema; `schema_version` recorded in a WP option.
- **Dep:** §0.1, §0.2
- **Canon:** `04` (whole schema — tables, indexes; `price_entries` single table per D §14; `user_products`, `list_items`, `purchase_log`, `families`, `store_products`, `category` buckets, token/refresh tables) · `04 §6.1` (`schema_version` in a WP option).
- **Iron:** IDs `BIGINT UNSIGNED`; `client_uuid` on `list_items` *and* `user_products` (§2.6); table prefix `$wpdb->prefix` + `si_` → `oCk_si_` (§2.7, D §6); FKs only among `oCk_si_*`, `user_id` by logical ref (D §14).
- **Owner sees:** (operator) after activation, the tables exist (Codex wires a one-line Admin "schema status" readout showing version + table count).

-----

## M1 — Repositories & auth (a real app user can log in and stay logged in)

*First user-facing milestone. Closes when the Owner can register, log in (email/password + Google),
reload, and stay logged in — with the JWT/refresh discipline intact.*

### §1.1 — Repository contracts + first `Wpdb` implementations
- **Goal:** `Repositories/Contracts` interfaces for the auth/identity + user-product/list tables, with `Wpdb` implementations using prepared statements only.
- **Dep:** §0.4
- **Canon:** `01 §5` rule 2, `§7` (the storage seam) · `04` (the tables they read/write).
- **Iron:** only `Repositories/Wpdb` touches `$wpdb`; prepared statements only (§2.1, §2.8).
- **Owner sees:** (operator) tests prove a row round-trips through the repository; Owner confirms green.

### §1.2 — `AuthProvider` / `UserRepository` over `wp_users` + `si_user` role
- **Goal:** app users live in `wp_users` behind the `AuthProvider` abstraction; new app users get the zero-capability `si_user` role, blocked from `wp-admin`.
- **Dep:** §1.1
- **Canon:** `06 §2` · `decisions.md` Identity store + §8 · `CLAUDE.md §2.8`.
- **Iron:** `si_user` zero-capability, no wp-admin (§2.8); identity behind `AuthProvider` (D §14).
- **Owner sees:** (operator) creating an app user yields a `si_user` who cannot reach `/wp-admin`.

### §1.3 — JWT issuer/verifier (custom `hash_hmac`) + claim set
- **Goal:** custom access-JWT issuer/verifier emitting the `{user_id, family_ids[], roles[]}` claim set.
- **Dep:** §1.2
- **Canon:** `06 §5` · `CLAUDE.md §5` (the claim set is one of the two real contracts) · `decisions.md` JWT impl (§8).
- **Iron:** JWT via core `hash_hmac`, never a WP-JWT plugin (§2.2); claim set is the contract, no issuer/WP leak (§5).
- **Owner sees:** (operator) tests prove issue→verify round-trip + tamper rejection; Owner confirms green.

### §1.4 — Register + login endpoints (email/password) with refresh-cookie flow
- **Goal:** `si/v1` register + login + refresh + logout; access token returned in body (memory-only), refresh token in an `httpOnly Secure` cookie with 30-day lineage + reuse detection. Google login is split out as **§1.4b**.
- **Dep:** §1.3
- **Canon:** `06 §3`–`§5.2` (endpoints, refresh rotation/lineage) · `06` CORS · `decisions.md` refresh 30-day + reuse-detection (§14) · `01 §9`.
- **Iron:** access JWT in memory only, refresh in `httpOnly Secure` cookie; exact-origin CORS (§2.8).
- **Owner sees:** (operator/early UI) hitting the endpoints (or a throwaway form) registers + logs in and sets the refresh cookie; bad password rejected.

### §1.4b — Google OAuth login (`/auth/google`)
- **Goal:** `si/v1` `POST /auth/google` — exchange a Google authorization code, verify with Google, find-or-create the `wp_users` record, and return the **identical** `{ auth, user }` shape as `/auth/login` (provider-blind output, `06 §6.1`/`§7.2`), setting the same refresh cookie.
- **Dep:** §1.4
- **Canon:** `06 §6.1` (endpoint spec, lines 214–221) · `06 §7.2` (provider-blind output) · `decisions.md` §8/§14 (Identity store, `AuthProvider` abstraction, Apple/Facebook future).
- **Iron:** access JWT in memory only, refresh in `httpOnly Secure` cookie (§2.8); identity stays behind `AuthProvider` — no provider-specific shape leaks past it (D §14).
- **Owner sees:** (operator/early UI) hitting `/auth/google` with a valid Google auth code logs in or creates the `si_user` account and sets the refresh cookie, with a response indistinguishable from `/auth/login`; `401 google_verification_failed` on a bad/expired code.

### §1.5 — App shell + auth screen + silent-refresh boot (first real screen)
- **Goal:** the PWA shell boots, attempts silent refresh, and shows the auth screen (email/password **and** "Sign in with Google" button) when there's no session; successful login (either provider) lands on an (empty) home.
- **Dep:** §1.4b
- **Canon:** `07 §3` (shell, silent-refresh boot) · `11 Flow 1`/`Flow 13` (first run; cold/offline boot) · `10` (auth is a leaf screen — flagged Open-for-design, `11`); `06 §5` (refresh) · `06 §6.1` (Google button → `/auth/google`).
- **Iron:** access JWT in memory only (§2.8).
- **Owner sees:** opens `app.<domain>`, registers/logs in with email/password **or** Google, reloads the page, **stays logged in**; logging out returns to the auth screen.

-----

## M2 — Lists, terms & families (the core list works, offline-first, shared)

*The heart of the product without prices yet. Closes when a user can build a shared family list of
their own terms, offline, and have it sync.*

### §2.1 — UserProduct create-on-write + owner-scoped term normalization
- **Goal:** writing a term creates a `UserProduct` for the list's owner, deduped on `(owner, normalized_term)`.
- **Dep:** §1.5
- **Canon:** `02`/`04 §7.1` (NFC+lowercase+trim+collapse+punctuation-strip, no stemming on key) · `06` user-product endpoints · `decisions.md` §14 normalizer · `CLAUDE.md §3`.
- **Iron:** `list_items` reference `user_product_id`, never free text/canonical (§3); `client_uuid` for idempotent sync (§2.6); demand-first — no shared canonical Product (§3).
- **Owner sees:** typing "мляко" twice on the owner's lists makes **one** term, not two; it's owner-scoped.

### §2.2 — Two-mode list (build/shop) with offline optimistic queue
- **Goal:** create/open a list, add/check/remove items in both modes; edits apply optimistically to Zustand+IndexedDB and queue when offline.
- **Dep:** §2.1
- **Canon:** `07 §4`/`§5` (two-mode, offline queue Q) · `10 §1.3`/`§2` · `11 Flow 2`–`Flow 6`.
- **Iron:** `client_uuid` idempotent sync; offline-born `list_items` carry it (§2.6).
- **Owner sees:** adds items with Wi-Fi **off**, sees them immediately; back online they persist after reload.

### §2.2c — Visual redesign of Lists overview + List screen
- **Goal:** restyle §2.2b's functional Lists overview + two-mode List screen to match the
  canonical mobile UI in `design/screens2.jsx`/`design/app.css` (app bar, list switcher,
  mode segmented control, emoji rows, `ListCard`), without changing data/sync logic.
- **Dep:** §2.2b
- **Canon:** `10 §8.1`/`§8.18`/`§8.19`/`§8.21`/`§8.26` (component states/variants) ·
  `design/screens2.jsx` + `design/app.css` (canonical layout/classes).
- **Iron:** no regression to §2.2b's optimistic local-first offline behaviour.
- **Owner sees:** the app visually matches the `design/screens2.jsx` mockup for Lists
  overview and the List screen; create/add/check/remove and offline behaviour unchanged.

### §2.2d — UI consistency cleanup (new, added 2026-06-17)
- **Goal:** fix four concrete consistency bugs found by audit: a duplicated
  `SyncStatusIndicator`, a dead `EmptyState` "Create list" button + duplicate inline empty-state
  markup, a partial English/Bulgarian copy mix, and a dead `onOpenAddSearch` prop with no button
  wired to it. Presentation/prop-wiring only — no data/sync/API changes.
- **Dep:** §2.2c
- **Canon:** `design/screens2.jsx` `ListScreen` appbar search icon · `10 §8.19`/`§8.26` · slice
  spec: `slices/13-2.2d-ui-consistency-cleanup.md` (full audit findings + build instructions).
- **Iron:** no regression to §2.2b/§2.2c's optimistic local-first offline behaviour.
- **Owner sees:** every screen reads in one language; the empty-state "Create list" button
  actually creates a list; every open list has a working search icon that opens Add/Search.

### §2.3 — Sync engine (last-write-wins, no conflict UI)
- **Goal:** the queued mutations flush to the server idempotently; server `updated_at` last-write-wins; the only recency signal is "updated X ago."
- **Dep:** §2.2
- **Canon:** `07 §5` (queue flush) · `10 §1`/`§7.6` (no conflict/merge UI ever) · `11` cross-cutting truths.
- **Iron:** `client_uuid` idempotency (§2.6).
- **Owner sees:** edits the same list from two sessions; later write wins, **no merge screen** appears, "updated X ago" reflects recency.

### §2.3a — Wpdb null-safe value binder (hardening, added 2026-06-17)
- **Goal:** no `Repositories/Wpdb` class can silently write `0`/`''` for a `null` value again — one shared binder, used everywhere a nullable column is written.
- **Dep:** §2.3 (retrofits its repositories)
- **Canon:** `01 §5` rule 2 (amended 2026-06-17) · `decisions.md` "Resolved — sync-pipeline incident" (2026-06-17) · full findings: `slices/13-2.3a-wpdb-null-safe-binder.md`.
- **Iron:** only `Repositories/Wpdb` touches `$wpdb`, prepared statements exclusively (§5 rule 2) — this slice tightens that rule, doesn't loosen it.
- **Owner sees:** adding a brand-new term/item no longer 500s; nothing else changes visibly.

### §2.3b — Unify the mutation pipeline (hardening, added 2026-06-17)
- **Goal:** one shared `sendMutation` function used by both the immediate "try now" attempt and the background queue flush — no screen hand-rolls its own copy.
- **Dep:** §2.3, §2.3a (cleanest once the backend stops 500ing on the same paths)
- **Canon:** `07 §5.5` (added 2026-06-17) · `decisions.md` "Resolved — sync-pipeline incident" (2026-06-17) · full findings: `slices/13-2.3b-unify-mutation-pipeline.md`.
- **Iron:** no regression to optimistic local-first behaviour (§2.2/§2.3); `client_uuid` idempotency unchanged (§2.6).
- **Owner sees:** creating a list and adding an item behave identically under the same network conditions — no more "one works, the other doesn't."

### §2.3c — `SyncStatusIndicator` redesign: icon-only cue + offline banner (UX, added 2026-06-17)
- **Goal:** no visible badge while synced/online; a persistent thin offline banner only when actually offline; an icon (not text) for genuinely pending/failed mutations.
- **Dep:** §2.3b (the indicator must reflect the now-unified queue, not the old duplicated paths)
- **Canon:** `10 §7`/`§8.19` (banner vs inline-cue variants, three distinct states) · `07 §5.3` (flush triggers) · `design/screens2.jsx` line 72 + `design/app.css` lines 248-254 (exact offline-banner markup/copy/style to port) · full spec + build instructions: `slices/13-2.3c-sync-indicator-offline-banner.md`.
- **Iron:** no conflict-resolution UI (`10 §7.6`); sync-failed stays a distinct, never-hidden state (`10 §7`).
- **Owner sees:** lists/items sync silently and invisibly while online; an "Офлайн" strip appears only with no connection; a small icon (not a text badge) appears only for something genuinely stuck.
- **Supersedes `§2.2d` SCOPE item 1** (dedupe `SyncStatusIndicator`) — this slice replaces both inline copies anyway; skip that item if `§2.2d` runs after this one.

### §2.4 — Families: create, email-token invite, accept deep-link, roles
- **Goal:** create a family, invite by email, accept via the emailed token deep-link; family-owned lists/terms resolve owner = family.
- **Dep:** §2.3
- **Canon:** `06 §6` (family endpoints; note `DELETE /families/{id}` is still open — D §14) · `10 §4` · `11 Flow 7`–`Flow 9` · `decisions.md` D-2 (membership lifecycle) · `04` family tables.
- **Iron:** owner = family if family-owned else individual (§3); `family_ids[]` in the JWT claim set (§5).
- **Owner sees:** invites a second account by email; that account accepts via the link and sees the shared list.
- **Build order note (2026-06-15):** moved later in the *build sequence* — see "Re-sequencing"
  below. Dependency stays §2.3; only the order it's tackled in changed.

### §2.5 — Owner-scoped favorites / recent / frequent quick-add
- **Goal:** `is_favorite` on UserProduct; recently/frequently-bought derived from `purchase_log`, scoped to the **list's owner** (family vs user).
- **Dep:** §2.4
- **Canon:** `10 §4.2`/`§6` (owner-context, no global catalog picker, no history screen) · `04 §7.3`/`§7.5` (purchase_log shape; frequent = ≥3 in rolling 8wk) · `decisions.md` §14.
- **Iron:** demand-first, search only owner's own terms — no global product picker (`10`, D §14); soft-delete via `is_archived` (D §14).
- **Owner sees:** stars a term; it surfaces in quick-add for that owner; a different owner's list doesn't show it.
- **Build order note (2026-06-15):** moved later in the *build sequence* — see "Re-sequencing"
  below. Dependency stays §2.4; only the order it's tackled in changed.

-----

## Re-sequencing (2026-06-17, revised) — build order vs. dependency order

The numbering above (§2.4/§2.5 before M3/M4) reflects **dependency order** and stays as the
canonical reference for *what depends on what*. The actual **build order** diverges from it.

**Revised build order (2026-06-17, updated same day):**

```
§2.3 (done) → §3.1 (done) → §4.0 (done) → §2.3a → §2.3b → §2.3c → §2.2d → §3.2 → §3.3 → §4.1 → §4.2 → §4.3 → §2.4 → §2.5 → M5
```

**§2.3a/§2.3b/§2.3c (added 2026-06-17, ahead of §2.2d)** — a production incident the same day
(every list/item stuck `sync-pending` forever) traced to a stacked set of bugs, two of which are
data-integrity/reliability defects (a Wpdb null-binding bug that 500s on every brand-new term, and
four independent hand-rolled copies of the same mutation-send logic). These jump ahead of the
cosmetic §2.2d cleanup because they are live correctness bugs, not UI polish. §2.3c (the UX
redesign of the sync indicator + offline banner, the Owner's original ask before the incident)
sits after them because it would otherwise be built on top of the broken duplicated pipeline it's
trying to display the state of. Full incident writeup: `decisions.md` "Resolved — sync-pipeline
incident" (2026-06-17).

**§2.2d (added 2026-06-17)** — small, low-risk UI cleanup slotted in before §3.2 since it's pure
frontend, touches the same files §2.2c/§4.0 just touched (best done while that context is fresh),
and unblocks nothing but is unblocked by nothing either.

**Why this order:**

- **§4.0 (next)** — navigation shell + Add/Search screen first. Pure frontend, no dependency
  on offers or ingestion. Gets the Owner a real second screen immediately.
- **§3.2 → §3.3 (before §4.1)** — IngestionService and cron come right after §4.0, while
  §4.1/§4.2/§4.3 are being designed. When §4.1 ships, there will already be real offers in
  the DB from the crawler — the Owner sees real prices from day one, not an empty state.
- **§4.1 → §4.2 → §4.3** — the full comparison flow, now backed by real data.
- **§2.4 (Family) then §2.5 (Favorites)** — dependency-safe; nothing in §3.x or §4.x
  depends on them.
- **M5** unchanged at the end.

If a future session re-derives the build order from this file without reading this note, the
numeric §2.x/§3.x/§4.x ordering above is **dependency order, not build order** — check this
section first.

-----

## M3 — Crawl & ingestion (real store offers exist in the DB)

*Operator-facing milestone — no app screen changes for the end user yet. Closes when the Owner can
trigger a crawl from the Admin/CLI and watch real offers land, bucketed.*

### §3.1 — `HttpClient` interface + `WpHttpClient` + `AbstractCrawler`
- **Goal:** the crawler base: fetch via the injected `HttpClient`, parse with built-in DOM/XPath, emit `RawOffer` DTOs.
- **Dep:** §0.3 (Money), §0.2
- **Canon:** `05 §2`/`§3` · `01 §5` rule 3, `§7` (the network seam) · `03 §3.1` (built-in DOM/XPath).
- **Iron:** crawlers never write the DB; emit `RawOffer` to ingestion; depend on `HttpClient`, not WP HTTP (§2.3).
- **Owner sees:** (operator) `bin/crawl.php --chain=X --dry-run` prints parsed `RawOffer` rows to the console without DB writes.

### §3.2 — `IngestionService`: validate → categorize (lenient) → persist
- **Goal:** ingestion validates `RawOffer`s, persists `store_products` + `price_entries`, and assigns `category_id` leniently; unbucketable offers are dropped, never block ingestion.
- **Dep:** §3.1, §1.1, §0.4
- **Canon:** `05 §4`/`§5` · `04 §4.5`/`§7.4` (`price_entries` single table; category on `store_products.category_id`) · `01 §5` rule 5 · `CLAUDE.md §2.9` (lenient, non-blocking, no moderation queue).
- **Iron:** categorization lenient/non-blocking, no admin queue (§2.9); money integer cents (§2.4); "current" price from validity query not a flag (§2.5).
- **Owner sees:** (operator) a real (or fixtured) crawl run lands offers; Admin shows counts; a deliberately weird offer is skipped without failing the run.

### §3.3 — CLI cron entry points + Admin crawl dashboard
- **Goal:** `bin/crawl.php` (full/delta) and `bin/prune.php` run resumably under the `GET_LOCK` guard; an Admin page shows status, counts, errors, resume state.
- **Dep:** §3.2
- **Canon:** `01 §6.3` (CLI bootstraps `wp-load.php`, one process/chain, `GET_LOCK`, chunked+resumable, 8-week raw retention) · `05` schedules · `01 §5` Admin rule (calls the same services).
- **Iron:** Admin contains zero business logic / zero SQL (`01 §5` rule 4); crawlers don't write DB — ingestion does (§2.3).
- **Owner sees:** (operator) triggers a crawl from Admin/CLI, watches the dashboard update; re-running resumes rather than duplicating.
- **Open Q (defer, don't invent):** SuperHosting `memory_limit`/`max_execution_time` + MySQL version (D §14) — flag if a run hits a host limit.

-----

## M4 — Matching by selection & comparison (the payoff: prices, promos, cheapest store)

*The product's reason to exist. Closes when the Owner opens a term, sees real cross-store
candidates with promos marked, picks one, and sees a trustworthy cheapest-store comparison.*

### §4.0 — Navigation shell + Add/Search screen (new, added 2026-06-15)
- **Goal:** add the tab-bar/menu navigation that §2.2c deliberately omitted (no second screen to
  navigate to at the time), and build the **Add/Search** screen (`11` B.5) as that second screen —
  search the owner's own terms, coin a new term, with `QuickAddSection` ×3 present but allowed to
  render empty/static until §2.5 (favorites/recent/frequent) lands. Wires List screen's add-item
  affordance to navigate to this screen instead of (or in addition to) the inline add-bar.
- **Dep:** §2.2c (existing screens), §2.1 (UserProduct create-on-write — search/coin needs it)
- **Canon:** `11` B.5 (Add/Search screen), B.10 (tab bar — was correctly omitted by §2.2c, now has
  a second destination) · `10 §8.12` (`SearchBar`) · `10 §8.13` (`QuickAddSection`, may be
  empty-state per-section until §2.5) · `11 Flow 3`/`Flow 11`.
- **Iron:** search is **owner's own terms only** — no global product-catalog picker (`CLAUDE.md
  §3`, `10` §2.6).
- **Owner sees:** a tab bar / nav affordance now exists; tapping it opens a real Add/Search screen
  (not a dead end); typing a term that doesn't exist yet offers "add as new term," never an error.
- **Note:** this slice did not exist in the original M2→M5 plan — added per the 2026-06-15
  re-sequencing (see note above M3) to avoid the app staying at "two screens" for the duration of
  M3.

### §4.1 — Candidate read for a UserProduct (broad by default, promos marked)
- **Goal:** opening a UserProduct returns every candidate offer across stores for its bucket, promos flagged; empty bucket returns `200` + empty `candidates[]` + `category_id: null` ("matching in progress").
- **Dep:** §3.2, §2.1, §4.0 (Product Detail is reached from the Add/Search screen built in §4.0)
- **Canon:** `06 §10`/`§12` (candidate shape; empty-bucket `200` not `409`; `basis` field) · `10 §3` · `11 Flow 10` · `CLAUDE.md §3` (broad by default, opt-in brand).
- **Iron:** broad by default, opt-in brand anchor (§3); "current" price via validity query, Thu→Wed promo week (§2.5); REST response shape is a guarded contract (§5).
- **Owner sees:** opens "мляко", sees offers from multiple stores with promo ones marked; a brand-new term shows "matching in progress," not an error.

### §4.2 — Matching by selection + opt-in brand anchor
- **Goal:** choosing a candidate *is* the match (no yes/no dialog); the user may opt into a `brand_anchor` token if brand matters.
- **Dep:** §4.1
- **Canon:** `10 §3` (match-by-selection, no confirmation UX) · `04 §7.2` (`brand_anchor`/`brand_normalized`) · `decisions.md` D-1 (brand-chip label) · `11 Flow 10`.
- **Iron:** matching by selection, no confirmation dialog (§3); brand is an opt-in anchor, not a fourth layer (D §14).
- **Owner sees:** taps an offer and it's selected with no confirm popup; optionally anchors a brand and candidates narrow to it.

### §4.3 — Basket comparison: per-store totals + cheapest store with coverage gaps
- **Goal:** the comparison view computes per-store totals from the broad-item basis (cheapest in-category per store), ranks stores, and always shows each store's `missing_items` count; "matching in progress" items are excluded from totals and shown distinctly from `not_available`.
- **Dep:** §4.2, §2.5
- **Canon:** `10 §5` (excl. uncategorized from totals; always show `missing_items`; cheapest ranking) · `06 §10`/`§12` (`basis` field, totals shape) · `11 Flow 11` · `decisions.md` §14 (broad-item contribution).
- **Iron:** money integer cents (§2.4); response shape guarded (§5); demand-first broad basis (§3).
- **Owner sees:** a multi-item list shows a cheapest store with its missing-items count beside its total; brand-new terms don't silently distort the totals.

-----

## M5 — PWA hardening & ship (installable, resilient, launch-ready)

*Closes the MVP: the things that make it a real installable app rather than a demo.*

### §5.1 — Service worker, offline reads withheld-not-faked, install prompt
- **Goal:** the PWA is installable; server-derived reads (candidates, comparison) are **withheld** offline, never faked; the install prompt appears after the user has created/opened a list.
- **Dep:** §4.3, §2.3
- **Canon:** `07 §3`/`§4` (PWA, offline-first, withheld reads) · `07 §3.4` (install-prompt timing — surface is Open-for-design, `11`) · `11 Flow 13`.
- **Iron:** offline-first; server reads withheld not faked (`11` cross-cutting; §2 demand-first integrity).
- **Owner sees:** installs to home screen; offline, the list still works but comparison shows a withheld state, not stale/fake prices.

### §5.2 — Prune, retention, backup cadence, launch checklist
- **Goal:** `bin/prune.php` wired on schedule (raw offers/logs/expired tokens, 8-week); off-host backup cadence decided and documented; the `09` hardening checklist walked.
- **Dep:** §3.3, §5.1
- **Canon:** `01 §6.3`/`§9` · `09 §7`/`§8` (backup cadence — currently unset, D §14) · `05` prune schedule.
- **Iron:** security defaults intact (§2.8); prepared statements (§2.8).
- **Owner sees:** (operator) prune runs on schedule and removes aged rows; a backup exists per the decided cadence.
- **Open Q (decide & record, don't invent):** off-host backup cadence; analytics (Plausible vs none); barcode MVP-vs-Stage-2 (all D §14).

-----

## Dependency spine (at a glance)

```
M0 skeleton/spine ──► M1 auth ──► M2 lists/terms/families
                                        │
M0 ─► M3 crawl/ingestion ───────────────┤
                                        ▼
                              M4 matching + comparison ──► M5 PWA hardening / ship
```

M3 depends only on M0 (Money + schema + repositories), so **crawl/ingestion can be built in
parallel with M1–M2** if the Owner wants two Codex tracks running — but M4 needs **both** M2 (terms)
and M3 (offers) closed. Within each milestone, build top-to-bottom.

**This diagram is dependency order, not build order** — see "Re-sequencing (2026-06-17)" above
M3 for the actual order Slices are tackled in (§3.1 done → §4.0 → §3.2 → §3.3 → §4.1 → §4.2 →
§4.3 → §2.4 → §2.5 → M5).

-----

## Resolved-vs-open at build time

Everything sequenced above rests on **closed** decisions in `00`–`11` + `decisions.md`. The handful
of **open** items (D §14) that a Slice may touch are flagged inline (§3.3 host limits; §4 brand
representation is closed to "opt-in anchor token"; §5.2 backup cadence / analytics /
barcode). Per `CLAUDE.md §6`, when one of these blocks a Slice, **flag it and defer to a
`decisions.md` decision — never invent a value**; that is an escalation **type 5** (`12 §5`).

-----

*Last updated: June 2026 · canonical for the **ordered MVP build line**: six milestones M0→M5
(spine → auth → lists/terms/families → crawl/ingestion → matching+comparison → PWA hardening),
each Slice a stub Claude expands into a combined Slice document per `12 §2`, closed by the two-gate
rule (`12 §3`). Sequences only — decides no product/architecture content (`00`–`11` + `decisions.md`
stay canonical for *what*; `12` for *how the loop runs*). Table prefix **resolved** to
`oCk_si_` (`$wpdb->prefix` + `si_`, D §6/§14).*
