# 11 — User Flows & Screen Inventory

> **Load when:** scoping a build ticket, writing acceptance criteria, sequencing screens for
> a sprint, or checking that a screen/state has a flow that reaches it; onboarding a designer
> or engineer to the end-to-end MVP paths.
> **Depends on:** `decisions.md` (always loaded — the canon) · `10-ux-rules.md` (PRIMARY:
> the screen-state & component-behaviour rules every step maps to) · `07-frontend.md` (client
> mechanics: two-mode list, offline/sync queue, silent-refresh boot) · `06-api-auth.md` (the
> `si/v1` endpoint each step calls).
> **Standalone for:** the end-to-end MVP **user flows** and the **screen inventory** derived
> from them. For *what a screen/state looks like and how a component behaves* → `10` (canonical;
> never re-decided here). For *client architecture & offline mechanics* → `07`. For *wire shapes*
> → `06`. For *meaning/scope* → `02` / `00` / `D`. This document **traces** decided behaviour;
> it invents no steps, screens, or features.

-----

## 0. Purpose & boundary

This document does exactly one thing: it **traces the user's step-by-step path** through the
already-decided behaviour in `10`, and from those paths **derives the list of distinct screens
and their states**. It is the bridge between the component/state rulebook (`10`) and the build
backlog.

It deliberately does **not**:

- design screens, wireframes, layouts, or visuals (that is the designer's craft, on top of `10`);
- re-decide any product behaviour (every rule in `10 §1–7` and `07` is **closed**);
- introduce a step, screen, or feature not already present in `10`/`07`/`06`. Where a path would
  need behaviour the rules don't define, it is **flagged in "Open for design"**, never invented.

**Conventions used in every flow.** Each happy-path step is written as
**action → component (`10 §8.n`) → endpoint (`06 §n`) → rule (`10 §n` / `07 §n`)**. Endpoints are
relative to `…/wp-json/si/v1`. Where a step is pure client state with no server call, the endpoint
slot reads **(local / Zustand)**. "Q" = the offline mutation queue (`07 §5`).

Two cross-cutting truths govern **every** flow and are therefore not repeated step-by-step:

- **Offline-first (`10 §1.3`, `07 §4`).** Any list/item/term/favorite/anchor edit applies
  optimistically to Zustand+IndexedDB and queues; the user never waits on the network. Server-
  derived reads (candidates, comparison) are **withheld, never faked**, offline.
- **No conflict UI (`10 §1`, §7.6).** Sync is last-write-wins on server `updated_at`; the only
  recency signal anywhere is **"updated X ago."** No merge screen, no version chooser — ever.

-----

# Part A — User Flows

Thirteen MVP flows. The eleven requested, plus **#12 (Sign out)** and **#13 (Cold/offline boot —
no session)** which the requested set touches but does not isolate. Deferred-feature paths
(barcode, recipes, notifications, link-share, real-time presence, native onboarding) are **not**
written; where one is adjacent it is flagged, not traced.

-----

## Flow 1 — First run / onboarding (register + silent-refresh boot + first empty state)

- **Trigger** — user opens `app.<domain>` for the first time (or after the refresh lineage
  expired).
- **Preconditions** — no valid refresh cookie, or a fresh install.

**Happy path:**

1. App shell paints from the SW precache, instantly → `SkeletonLoader`/shell (`10 §8.29`) →
   **(local / SW cache)** → `07 §3.1`.
2. Silent boot fires `POST /auth/refresh` with `credentials:'include'` → no UI → `POST /auth/refresh`
   (`06 §7.1`) → `07 §3.2`. On **`401 token_invalid`** → route to **Auth screen**.
3. User registers / logs in: email+password **or** Google — identical outcome, provider-blind →
   Auth screen → `POST /auth/login` **or** `POST /auth/google` (`06 §6.1`, §7.2) → `07 §3.2`.
4. On `200`: access JWT held **in memory only**; silent re-refresh scheduled ~1 min before `exp` →
   no UI → `07 §3.2`.
5. Land on **Lists overview**, which is empty → `EmptyState` `context="no-lists"` + create CTA
   (`10 §8.26`, §8.21) → `GET /lists` (`06 §6.2`) → `10 §4.6`.
6. Solo user: **no family clutter**; a single clear "create a family" CTA is available but not
   forced (`10 §4.6`).

**Branches / edge cases:**

- **Offline at boot** → see Flow 13. Registration/login require network; the Auth screen shows a
  clear "you're offline — connect to sign in" state (login cannot be optimistic — it mints the
  session). `07 §3.3`.
- **`401 credentials_invalid` / `google_verification_failed`** → inline error on the Auth screen
  via the `code` (`06 §10`); never reveal which field. `429 rate_limited` → show `Retry-After`
  wait (`06 §9.2`).
- **Install-as-app** prompt is *not* shown here; it surfaces only **after** the user has created
  or opened a list (`07 §3.4`) — see Flow 2 end state.

**Screens touched** — App shell, Auth, Lists overview (empty).
**End state** — authenticated session (in-memory JWT + refresh cookie); Lists overview, empty,
inviting the first list.

-----

## Flow 2 — Create a list (personal)

- **Trigger** — user taps the create CTA on the Lists overview (or the `EmptyState` CTA).
- **Preconditions** — authenticated.

**Happy path:**

1. Tap create → name input → `ListCard` create affordance / `EmptyState` CTA (`10 §8.21`, §8.26).
2. Enter a name; owner defaults to **personal** (`owner_type: user`) → (local) → `10 §4.1`.
3. Confirm → a list row appears immediately (optimistic), keyed by `client_uuid` →
   `POST /lists` (`06 §6.2`) → `07 §4.1`/§5. `OwnershipBadge` shows **personal** (`10 §8.16`).
4. Open the new list → **List screen**, planning mode, empty → `EmptyState` `context="empty-list"`
   (`10 §8.26`) + `ModeToggle` defaulting to planning (`10 §8.18`).

**Branches / edge cases:**

- **Offline** → the list is created locally and queued; it carries only `client_uuid` until sync,
  and shows the **sync-pending** cue (`10 §8.19`, §7). Fully openable and editable meanwhile.
- **Family list variant** → choosing `owner_type: family` requires `owner_id ∈ family_ids[]`;
  `POST /lists` may return `403 not_a_member` (`06 §6.2`). The family option is only offered when
  the user belongs to ≥1 family (`10 §4.1`, §4.6); see Flow 9.
- **`409 duplicate_client_uuid`** on replay → **not** an error: server returns the existing list;
  queue marks done (`06 §6.2`, `07 §5.3`).
- **Install-as-app** may surface now (first list created — `07 §3.4`).

**Screens touched** — Lists overview, List screen (empty).
**End state** — an empty personal list, open in planning mode.

-----

## Flow 3 — Add a product (type a term → UserProduct, often offline)

- **Trigger** — user adds an item to an open list (taps add / focuses the search bar).
- **Preconditions** — a list is open.

**Happy path:**

1. Open Add/Search → `SearchBar` (`10 §8.12`), `ownerType`+`ownerId` resolved to **this list's
   owner** (`10 §4.2`).
2. With no query, the surface shows quick-add blocks → `QuickAddSection` ×3 (`10 §8.13`) →
   `GET /user-products?section=favorites|recent|frequent` (`06 §6.3`) → `10 §6.2` (covered fully
   in Flow 10).
3. Type a new term (e.g. "прах Ariel") → `SearchBar` matches the **owner's own terms only**; no
   match → **"add as new term"** affordance, never a dead end (`10 §8.12`) → `10 §2`, §6.2.
4. Confirm add → a list row appears **instantly** (optimistic), with a **new UserProduct** born
   locally (`client_uuid`) and the line linked in one mutation → `ShoppingListItem` (`10 §8.1`) →
   `POST /lists/{id}/items` with inline `user_product` (`06 §6.2`) → `07 §4.2`, §8.
5. The new row shows **term · qty · favorite mark · no price**, and — since the crawler hasn't
   bucketed it yet — is in **matching-in-progress** at the term level (`category_id: null`) but
   **fully usable** (`10 §2.1`, §2.4).

**Branches / edge cases:**

- **Offline** (the routine case, in-store) → identical, all local + queued; the **sync-pending**
  cue shows N pending (`10 §8.19`, §7; `07 §4.2`).
- **Existing term picked** → the line references the existing `user_product_id`; no new term
  (`06 §6.2`).
- **Two devices coin the same term offline** → server merges to one row on sync; the user simply
  sees **one** row, **no duplicate/merge prompt** (`10 §7.6`, `07 §4.3`).
- **`409 duplicate_client_uuid`** → returns existing item, queue done (`06 §6.2`).
- **`404 list_not_found`** (list deleted elsewhere) → the queued item moves to **sync-failed**, a
  non-blocking notice for *that* change; the queue is not wedged (`10 §7`, §8.19; `07 §5.3`).
- **Edit quantity/unit** on the row → `QuantityStepper` (`10 §8.14`) → `PATCH …/items/{id}`
  (`06 §6.2`) → optimistic + queued.
- **Remove the line** vs **archive the term** are **distinct** (`10 §2.5`): remove →
  `DELETE …/items/{id}` (`06 §6.2`, no term/history loss); archive → `PATCH /user-products/{id}
  { is_archived }` (`06 §6.3`), confirmed via a `destructive` `Modal` (`10 §8.28`). "Remove from
  list" must never read as "delete forever."

**Screens touched** — List screen, Add/Search.
**End state** — the term is on the list (matching-in-progress until bucketed), persisted or queued.

-----

## Flow 4 — Open product → browse candidates across stores → match by selection

- **Trigger** — user taps a list row in **planning** mode to expand it.
- **Preconditions** — online for prices (degrades offline, below).

**Happy path:**

1. Tap the row → **Product Detail** opens → `ProductCard` (`10 §8.2`).
2. Candidates load across **all stores, broad by default**, each with promo markers →
   `CandidateOfferRow` list (`10 §8.3`) + `PromotionBadge` (`10 §8.10`) + `MoneyDisplay`
   (`10 §8.11`) → `GET /user-products/{id}/candidates` (`06 §6.3`) → `10 §2.2`, §1.1.
3. While loading → `SkeletonLoader shape="candidate"` (`10 §8.29`).
4. The user reads the offers and **chooses** — browsing *is* the match. **There is no
   "is this the same product? yes/no" dialog anywhere** (`10 §1.2`, §2.2). A debatable candidate is
   just an odd extra row the eye ignores; it never blocks.
5. From here the user may anchor a brand (Flow 5), toggle favorite (`FavoriteToggle`, `10 §8.15`),
   edit quantity (`QuantityStepper`, full variant), or archive the term (`10 §2.5`).

**Branches / edge cases:**

- **Matching in progress** (`category_id: null`) → `MatchingInProgressState` variant `detail`
  (`10 §8.20`): an explicit "matching in progress" message + an **empty** candidate list — **not**
  "no results", **not** a never-resolving spinner. The row stays usable (`10 §2.4`). `06 §6.3` note
  (`200`-empty preferred).
- **Offline** → candidates are **withheld** (volatile, never cached fresh); Product Detail shows
  the unavailable state while the term's own data (favorite, qty) stays editable (`10 §7`,
  `07 §4.1`). `ProductCard` Empty/Disabled per `10 §9.2`.
- **Candidate fetch error** (online) → inline error + retry; term data still editable (`10 §9.2`).
- **Already anchored** → candidates arrive **narrowed** to the brand (`broad: false`); the brand
  chip is shown (Flow 5).

**Screens touched** — List screen, Product Detail.
**End state** — the user has seen the full candidate set; any selection/anchor they made persists.

-----

## Flow 5 — Anchor a brand / remove an anchor (broad ⇄ anchored)

- **Trigger** — in Product Detail, the user decides brand matters (anchor) or no longer matters
  (clear).
- **Preconditions** — Product Detail open with candidates (anchoring needs a candidate that
  carries a brand token).

**Happy path (anchor):**

1. Pick the candidate whose brand to anchor → `CandidateOfferRow` (`10 §8.3`), `canAnchor: true`.
2. Tap **anchor** — picking *is* the anchor act; **no separate brand catalog, no yes/no confirm**
   (`10 §3.2`, §1.2) → `BrandAnchorControl` (`10 §8.4`) → `POST /user-products/{id}/anchor
   { brand_anchor }` (`06 §6.3`) → optimistic + queueable.
3. A **brand chip** appears on the row, in Product Detail, and in Add/Search results → the chip
   label is the **`brand_normalized` token, title-cased client-side, Cyrillic-aware** →
   `BrandAnchorChip` (`10 §8.5`, D-1) → `10 §3.4`.
4. Candidates narrow to that brand across stores (`broad: false`) on next fetch (`10 §3.5`,
   `06 §6.3`).

**Happy path (clear / widen):**

1. Tap the **brand chip** (the chip *is* the clear control) → `BrandAnchorChip` (`10 §8.5`) →
   `POST …/anchor { brand_anchor: null }` (`06 §6.3`) → widens back to **broad**; non-destructive
   (`10 §3.3`).

**Branches / edge cases:**

- **Candidate has no brand token** → the anchor action is **disabled/absent** (`canAnchor: false`);
  no anchoring to an empty brand (`10 §3.4`, §8.4 Disabled).
- **Offline** → both anchor and clear queue; the chip appears/disappears optimistically and rebases
  on refetch (`10 §9.4`, §7).
- **Anchored item in comparison** → contributes only the brand's offer or **not available**
  (`basis: brand_anchored`) — see Flow 6.

**Screens touched** — Product Detail (also surfaces the chip on List screen & Add/Search).
**End state** — term is anchored (chip shown) or broad (no chip).

-----

## Flow 6 — Compare basket → read per-store totals → decide where to shop

- **Trigger** — in planning mode, the user opens Comparison for the list.
- **Preconditions** — **online** (comparison is online-only and degrades offline).

**Happy path:**

1. Open Comparison → **Comparison screen** → `SkeletonLoader shape="comparison"` (`10 §8.29`) →
   `GET /lists/{id}/comparison` (`06 §6.4`) → `10 §5`, `07 §7.1`.
2. The **summary band** answers "where do I shop": each store's basket total, the **cheapest
   store highlighted**, and **each store's `missing_items` count beside its total — always** →
   `ComparisonSummaryBand` (`10 §8.6`) + `StoreCard` (`10 §8.9`) → `10 §5.1`. A total is **never**
   shown as cheapest without its missing count visible.
3. Below, **one row per item**, collapsed to its per-store contribution →
   `ComparisonItemRow` (`10 §8.7`) + `StoreContributionCell` (`10 §8.8`) + `MoneyDisplay`/
   `PromotionBadge` → `10 §5.2`.
4. **Not-available** offers render as an explicit "not available" (`null`), **unmistakable from
   `0`/blank**, and increment that store's `missing_items` (`10 §5.5`, §8.8).
5. **Broad vs anchored** contributions are distinguished by `basis`
   (`cheapest_in_category` representative vs `brand_anchored` exact), surfaced however lightly
   (`10 §5.5`).
6. Expand a row → every in-bucket candidate per store with promo markers →
   `CandidateOfferRow` (read-only `comparison-expansion` variant, `10 §8.3`) → `10 §5.2`/§5.3.
7. The user reads totals **together with** missing counts and decides where to shop (`10 §5.1`,
   §5.7).

**Branches / edge cases:**

- **Matching-in-progress items** (`category_id: null`) → listed and labelled, **visually separated**
  from not-available, and **excluded from per-store totals and the cheapest-store calc** →
  `MatchingInProgressState` variant `comparison` (`10 §8.20`) → `10 §5.6`. Only categorized-but-
  absent offers count toward `missing_items`.
- **Empty / nothing priced yet** → calm "nothing to compare yet" `EmptyState` (`10 §9.6`); matching-
  in-progress items don't count.
- **Offline** → Comparison is **withheld**: "comparison unavailable — reconnect to compare";
  nothing stale is rendered; the **list beneath stays fully editable** (`10 §5.7`, §8.6 Disabled;
  `07 §7.1`).
- **Comparison fetch error** (online) → same "comparison unavailable" surface as offline
  (`10 §9.6`).
- **Promotions** are a flag on a price (`is_promo`), marked on both candidate and the contribution
  it feeds; no parallel regular/promo toggle (`10 §5.4`).

**Screens touched** — List screen (planning), Comparison.
**End state** — the user has a per-store decision; no data is mutated by comparison (read surface).

-----

## Flow 7 — Switch to shopping mode → check items in-store (offline) → append purchase log

- **Trigger** — at the store, the user flips the list to shopping mode.
- **Preconditions** — a list with items; **often offline**.

**Happy path:**

1. Flip the toggle → `ModeToggle` (`10 §8.18`) → **(local / Zustand)** → `07 §7.3`. The switch is
   **always manual** — the app may *suggest* shopping but never auto-switches mid-aisle (`10 §1.5`).
   Mode is remembered per list.
2. The List screen becomes a **calm, large-target checklist**: each row is `ShoppingListItem`
   variant `shopping` — term · quantity · large check target · **no price, not expandable**
   (`10 §8.1`, §2.6, §5/§1.5). On family lists, each row shows **who added it** →
   `AttributionChip` (`10 §8.17`, §4.4).
3. Tap to check an item → flips `is_checked` **instantly, offline-safe** (Zustand/IndexedDB) and
   queues → `PATCH /lists/{id}/items/{itemId} { is_checked: true }` (`06 §6.2`) → `07 §7.2`.
4. The check is also what **appends a `purchase_log` row** server-side on sync (`is_checked`
   false→true) — the recently/frequently-bought substrate (`06 §6.2`, `07 §7.2`, `10 §6`). No
   purchase-history screen exists (`10 §6.4`).

**Branches / edge cases:**

- **Offline** is the *designed* case — checking never depends on the network (`07 §7.2`, `10 §1.5`).
- **Family list, two members check the same item** → last-write-wins, surfaced only as
  "updated X ago"; **no conflict dialog** (`10 §4.4`, §7.6).
- **Sync-failed for a check** (e.g. list deleted elsewhere → `404`) → non-blocking notice for that
  change; other checks unaffected (`10 §7`; `07 §5.3`).
- **No automatic mode switch back** — the user toggles back to planning manually (`10 §1.5`).

**Screens touched** — List screen (shopping variant).
**End state** — items checked locally (and queued); on sync, purchase log grows → feeds Flow 10.

-----

## Flow 8 — Reconnect → queue flush → reconciliation (+ the sync-failed branch)

- **Trigger** — connectivity returns (OS `online` event, app focus, or SW Background Sync).
- **Preconditions** — ≥1 queued mutation.

**Happy path:**

1. While offline/queued, a subtle **non-blocking** "syncing… / N changes pending" cue is shown →
   `SyncStatusIndicator` state `sync-pending` (`10 §8.19`, §7).
2. On reconnect the queue flushes **FIFO within a list** (parents before children) →
   `POST /lists` → `POST …/items` → `PATCH …`/anchor/favorite as queued (`06 §6.2`/§6.3) →
   `07 §5.2`/§5.3.
3. Each `2xx`: client writes the server `id` back into the IndexedDB mirror (keyed by
   `client_uuid`), updates `meta.last_sync`, and invalidates the matching TanStack-Query keys →
   open Comparison/Product-Detail views **refetch fresh server truth** → `07 §5.4`, §6.3.
4. The list **rebases** onto server truth (last-write-wins); merged duplicate terms collapse to
   one row — **silently, no prompt** (`10 §7.6`, `07 §4.3`).
5. On full success → `SyncStatusIndicator` returns to **synced**, showing only "updated X ago"
   (`10 §8.19`, §7).

**Branches / edge cases:**

- **`409 duplicate_client_uuid`** → **not** a failure: server already has it; mark `done`,
  reconcile the server `id` (`07 §5.3`, `06 §8`).
- **Real `4xx`** (e.g. `404 list_not_found` — list deleted elsewhere) → that record moves to
  **sync-failed**: a non-blocking `Toast`/inline notice for *that* change, with optional retry; it
  **never wedges the queue** and other edits keep flowing → `SyncStatusIndicator` `sync-failed`
  (`10 §8.19`, §8.27) → `07 §5.3`.
- **`5xx`/network** → exponential backoff retry (`07 §5.3`); stays `sync-pending`.
- **iOS Safari (no Background Sync)** → the in-app `online`/on-focus flush covers it (`07 §5.3`).
- **Comparison/candidates** were never in IndexedDB → nothing to merge, only to refetch
  (`07 §6.3`).

**Screens touched** — whichever surface is open (List / Comparison / Product Detail); the sync
indicator and Toast are cross-cutting overlays, not a screen.
**End state** — queue drained; mirror reconciled to server `id`s; any failed item surfaced
(not hidden), queue healthy.

-----

## Flow 9 — Family: create, invite (admin-only), accept, roles, shared visibility

- **Trigger** — the solo user wants to share lists; or an admin manages members; or an invitee
  opens an emailed link.
- **Preconditions** — authenticated.

### 9a — Create a family

1. From the Lists overview empty/clutter-free state, tap **create a family** → `EmptyState`
   `context="no-family"` CTA (`10 §8.26`, §4.6).
2. Name it → `POST /families` (`06 §6.6`) → caller becomes first **admin**; **↻ fresh token** so
   the new `family_id` enters `family_ids[]` at once (`06 §4.2`/§7.4).
3. The **Family screen** opens, listing the sole member (self, admin) → `FamilyMemberRow`
   (`10 §8.22`).

### 9b — Invite a member (admin only)

1. On the Family screen, the admin uses the invite form → `FamilyInviteForm` (`10 §8.23`),
   **email only** → `POST /families/{id}/invitations { invited_email, invited_role }`
   (`06 §6.6`) → `10 §4.5`.
2. The form (and all admin controls) is wrapped so **members see it hidden/disabled, never
   error-on-tap** → `RoleGatedAction` (`10 §8.25`, §4.3).
3. The admin may **revoke a pending invitation** → `DELETE …/invitations/{invId}` (`06 §6.6`).
   There is **no in-app pending-invitations inbox** (`10 §4.5`).

### 9c — Accept an invitation (the invitee)

1. The invitee receives an email and taps the **deep-link**, which opens the app to the
   **Accept-invitation screen** → `AcceptInvitationScreen` (`10 §8.24`) → `10 §4.5`.
2. Accept → `POST /invitations/{token}/accept` (`06 §6.6`) → membership created; **↻ fresh token**
   so the accepter's `family_ids[]` updates immediately (`06 §4.2`).
3. The screen must render **all** token states: `pending` → accept succeeds; `expired` →
   `410 invitation_expired`; `already_accepted` → idempotent success (accept disabled, success
   shown); `revoked`/unknown → not-found — each with a clear next step (`10 §8.24`, §4.5;
   `06 §6.6`/§10).

### 9d — Roles, shared visibility, attribution

- **Member vs admin** capabilities are gated **visibly** (admin actions hidden/disabled for
  members); each member's role is shown → `FamilyMemberRow` + `RoleGatedAction` (`10 §4.3`).
  Role comes from `GET /families` (`role`) + the JWT (`06 §6.6`).
- **Shared-list visibility**: a family list is seen by **all current members**; the Lists overview
  shows family lists alongside personal ones → `ListCard` + `OwnershipBadge` family (`10 §8.21`,
  §8.16) → `GET /lists` (`06 §6.2`), `10 §4.1`.
- **`added_by` attribution**: every family-list item shows who added it →
  `AttributionChip` (`10 §8.17`, §4.4) — present on family lists, absent on personal.
- **Owner-context rule**: favorites/recent/frequent shown while adding to a family list are the
  **family's** sets, not the user's personal ones (`10 §4.2`) — see Flow 10.

### 9e — Membership lifecycle (hand-off, self-leave) — D-2

- **Any member leaves themselves** → `FamilyMemberRow` leave (self) → `DELETE …/members/{me}`
  (admin-or-self; **↻ fresh token**) → their view drops the family at once; others correct at next
  refresh ≤15 min (`10 §4.5`, §4.6; `06 §6.6`).
- **Admin role change / hand-off** → admin promotes/demotes → `PATCH …/members/{userId}
  { role }` (`06 §6.6`); **not** ↻ fresh token (per-family role read each request).
- **Last-admin block** → demoting/removing/leaving the sole admin while members remain →
  **`409 last_admin`**: the UI **explains why and routes to "promote a member first"**, not a bare
  error (`10 §4.5`, §9.22).
- **Solo member leaving** → leave **succeeds and deletes the now-empty family**, surfaced as
  "leave & delete family" via a `destructive` `Modal` (`10 §4.5`, §8.28), not a silent no-op.

**Branches / edge cases:**

- `POST /families/{id}/invitations` → `403 not_admin` is unreachable from the UI (gated) but
  enforced server-side; `409 already_member` → inline message (`06 §6.6`).
- A removed member's other devices correct only at next refresh (≤15 min); the UI **must not**
  promise instant propagation to other devices (`10 §4.6`).

**Screens touched** — Lists overview, Family screen, Accept-invitation screen.
**End state** — family exists with correct membership/roles; shared lists visible to members with
attribution.

-----

## Flow 10 — Favorites + recently/frequently-bought → fast re-add

- **Trigger** — user wants to re-add a known item to a list.
- **Preconditions** — a list is open; some purchase history and/or favorites exist (else empty
  states).

**Happy path:**

1. Open Add/Search with no query → three quick-add blocks: **favorites · recently bought ·
   frequently bought** → `QuickAddSection` ×3 (`10 §8.13`) →
   `GET /user-products?section=favorites|recent|frequent` (`06 §6.3`), **scoped to this list's
   owner** (`10 §4.2`) → `10 §6.2`.
2. The four concepts stay **semantically distinct** and are **not de-duplicated**; an item can be
   in several at once, and the **favorite heart** shows wherever the term appears (`10 §6.3`,
   §8.15).
3. **Frequently bought** may show the **server's `purchase_count_window`** rendered **verbatim** —
   the client **never hardcodes** the window/threshold; if the server returns no count, show none
   (`10 §6.2`, `07 §8`/§10).
4. Tap a term → it's **quick-added** to the current list instantly (optimistic) →
   `ShoppingListItem` appears (`10 §8.1`) → `POST /lists/{id}/items { user_product_id }`
   (`06 §6.2`).
5. **Toggle favorite** anywhere the term appears → `FavoriteToggle` (`10 §8.15`) →
   `PATCH /user-products/{id} { is_favorite }` (`06 §6.3`) → the flag lives on the **term**, so it
   **persists across lists**; offline-safe/queued (`10 §6.1`).

**Branches / edge cases:**

- **Empty sections** → "no favorites yet" / "nothing bought yet" `EmptyState` per section
  (`10 §9.13`, §8.26); never a dead-end.
- **Offline** → **favorites** show where mirrored (owner metadata); **recent/frequent** are
  server-derived and may be **unavailable** offline — show the section as unavailable, don't
  fabricate (`10 §6.2`, §9.13; §7).
- **Section fetch error** → show the section unavailable, never invent counts (`10 §6.2`).
- **Owner context** → in a family list these reflect the **family's** behaviour, not the user's
  (`10 §4.2`).

**Screens touched** — Add/Search, List screen.
**End state** — the chosen term is on the list; favorite state updated where toggled.

-----

## Flow 11 — Search → results → add from search

- **Trigger** — user types into the Add/Search bar to find a term.
- **Preconditions** — a list is open.

**Happy path:**

1. Type a query → `SearchBar` (`10 §8.12`) searches the **owner's own terms only** (`10 §4.2`,
   §6.2). **There is no global product-catalog picker** (`10 §2.6`).
2. **Matches** → existing terms (with the favorite heart, and a brand chip if anchored) → pick one
   → `POST /lists/{id}/items { user_product_id }` (`06 §6.2`).
3. **No match** → an **"add as new term"** affordance → creates a new UserProduct + line in one
   mutation (Flow 3 step 4) → `POST …/items` inline `user_product` (`06 §6.2`).

**Branches / edge cases:**

- **Offline** → search still runs over the local owner term set and **still creates terms**
  (offline-born) (`10 §8.12`, §7; `07 §4.2`).
- **Create failure** → queued + non-blocking cue; the term still appears optimistically
  (`10 §9.12`, §7).
- **Anchored result** → the brand chip is shown so the user recognises it as narrowed, not broad
  (`10 §3.5`).
- **Category / promotion browse** (passive discovery) uses the public `GET /categories` /
  `GET /promotions` (`06 §6.5`) and is short-TTL edge-cacheable; it is a browse aid alongside
  search (`10 §2.6`). *(No global catalog picker is implied — these are browse chips, not a
  product picker.)*

**Screens touched** — Add/Search, List screen.
**End state** — the chosen/created term is on the list.

-----

## Flow 12 — Sign out

- **Trigger** — user signs out.
- **Preconditions** — authenticated.

**Happy path:**

1. Tap sign out → `POST /auth/logout` (`06 §6.1`) → revokes the current refresh lineage, clears the
   cookie (`204`) → `06 §5.2`.
2. The in-memory access JWT is discarded; route to the **Auth screen** (`07 §3.2`).

**Branches / edge cases:**

- **Offline sign-out** → logout needs the network to revoke the lineage; if offline, the client can
  drop the in-memory token locally but the lineage is revoked on next reach. *This precise offline-
  logout behaviour is not specified in `10`/`07`/`06` —* see **Open for design**.

**Screens touched** — (current surface) → Auth screen.
**End state** — no session; Auth screen.

-----

## Flow 13 — Cold / offline boot with an existing session

- **Trigger** — a returning user opens the app, possibly with no signal.
- **Preconditions** — a previously stored refresh cookie and IndexedDB mirror.

**Happy path (online):** identical to Flow 1 steps 1–2; on `200` the user lands on their populated
**Lists overview** rather than the empty state.

**Offline boot:**

1. The shell paints from SW cache instantly (`07 §3.1`, §3.3).
2. Cached **lists open and are editable from IndexedDB**; refresh is deferred, mutations queue →
   `SyncStatusIndicator` `offline` **banner** (`10 §8.19`) + "updated X ago" staleness from `meta`
   (`07 §3.3`, §4.3; `10 §7`).
3. Server-derived surfaces (Comparison, Product-Detail candidates) show **"unavailable —
   reconnect"**, never stale-as-fresh (`10 §7`, §5.7).

**Branches / edge cases:**

- **`401` on refresh** (lineage expired/revoked) → route to login (`07 §3.2`); offline boot skips
  the refresh attempt and runs on cache until reconnect (`07 §3.3`).
- On reconnect → Flow 8 (queue flush + reconciliation).

**Screens touched** — App shell, Lists overview, List screen — all in offline/stale states.
**End state** — the user is working offline on cached data; the queue drains on reconnect.

-----

# Part B — Screen Inventory (derived from Part A)

Every **distinct screen/surface** the flows touch, listed **once**, with its purpose, the states it
can take, and the `10 §8` components it composes. Cross-cutting overlays (sync indicator, toast,
modal) are listed at the end as non-screen surfaces. Components every authenticated screen carries
(`SyncStatusIndicator`, `Toast`) are noted once there and not repeated per screen.

| # | Screen / surface | Flows |
|---|------------------|-------|
| 1 | App shell | 1, 13 |
| 2 | Auth | 1, 12 |
| 3 | Lists overview | 1, 2, 9, 13 |
| 4 | List screen (two-mode) | 2–7, 10, 11, 13 |
| 5 | Add / Search | 3, 10, 11 |
| 6 | Product Detail | 4, 5 |
| 7 | Comparison | 6 |
| 8 | Family screen | 9 |
| 9 | Accept-invitation screen | 9 |
| — | Cross-cutting overlays | all |

### B.1 App shell
- **Purpose** — instant first paint + the silent-refresh boot host; the frame every screen renders
  inside (`07 §3`).
- **States** — booting (skeleton from cache); online-authenticated (→ Lists overview);
  offline-boot (cache-only, deferred refresh); unauthenticated (→ Auth). Also the host for the
  **install-as-app** prompt, surfaced *after* a list is created/opened (`07 §3.4`).
- **Components** — `SkeletonLoader` (`§8.29`), `SyncStatusIndicator` banner (`§8.19`).

### B.2 Auth
- **Purpose** — register / log in via email-password **or** Google; provider-blind outcome
  (`06 §7.2`).
- **States** — idle; submitting; error (`credentials_invalid` / `google_verification_failed` /
  `rate_limited` — `06 §10`); offline ("connect to sign in" — login can't be optimistic). Reached
  on first run, on `401`, and after sign-out.
- **Components** — auth form (presentation; no dedicated `§8` component — it is a leaf screen),
  `Toast` (`§8.27`).

### B.3 Lists overview
- **Purpose** — all lists the user can see — **personal + every family list** (`06 §6.2`).
- **States** — empty (`no-lists` → create CTA); empty-of-family (`no-family` → create-family CTA,
  solo user, no family clutter — `10 §4.6`); populated (personal + family cards); loading;
  offline/stale ("updated X ago", cached cards still openable); fetch-error (retry, cached still
  open).
- **Components** — `ListCard` (`§8.21`), `OwnershipBadge` (`§8.16`), `EmptyState` (`§8.26`),
  `SkeletonLoader` (`§8.29`), `SyncStatusIndicator` (`§8.19`).

### B.4 List screen (two-mode)
- **Purpose** — the workhorse: view/edit one list's lines; the host for both **planning** and
  **shopping** modes and the entry to Product Detail, Comparison, and Add/Search (`07 §7`).
- **States** —
  - **mode:** planning (expandable rows, no inline price) vs shopping (large checklist, no price,
    not expandable) — manual toggle, remembered per list (`10 §1.5`, §2.6);
  - **content:** empty (`empty-list` CTA) / with-items;
  - **per-row:** unchecked / checked; broad / anchored (brand chip); matching-in-progress
    (`category_id: null`); `added_by` attribution on family lists;
  - **ownership:** personal / family (`OwnershipBadge`);
  - **connectivity:** offline-editable / sync-pending / sync-failed / synced ("updated X ago").
- **Components** — `ShoppingListItem` (`§8.1`, both variants), `ModeToggle` (`§8.18`),
  `QuantityStepper` (`§8.14`), `FavoriteToggle` (`§8.15`), `BrandAnchorChip` (`§8.5`),
  `AttributionChip` (`§8.17`), `OwnershipBadge` (`§8.16`), `MatchingInProgressState` (`§8.20`),
  `EmptyState` (`§8.26`), `SyncStatusIndicator` (`§8.19`), `Modal` (`§8.28`, remove-line vs
  archive-term — distinct).

### B.5 Add / Search
- **Purpose** — add to the current list: search the **owner's own terms only**, quick-add from
  favorites/recent/frequent, or coin a new term. **No global product-catalog picker**
  (`10 §2.6`, §6.2).
- **States** — no query (shows the three quick-add sections); typing; matches (with heart / brand
  chip); no-match ("add as new term", never a dead end); section-empty (per section `EmptyState`);
  offline (still creates terms; recent/frequent may be unavailable, favorites where mirrored);
  create-error (queued + cue).
- **Components** — `SearchBar` (`§8.12`), `QuickAddSection` ×3 (`§8.13`), `FavoriteToggle`
  (`§8.15`), `BrandAnchorChip` (`§8.5`), `EmptyState` (`§8.26`), `SkeletonLoader` (`§8.29`).

### B.6 Product Detail
- **Purpose** — one UserProduct's detail: **where candidates and prices live**; the match-by-
  selection and anchor surface (`10 §2.6`, §2.2).
- **States** — loading candidates (skeleton); broad (all stores) / anchored (narrowed, brand chip);
  **matching-in-progress** (explicit message + empty candidate list — not "no results", not an
  endless spinner); offline (candidates withheld; term data still editable); candidate-fetch-error
  (inline + retry); anchor disabled where no candidate carries a brand token.
- **Components** — `ProductCard` (`§8.2`), `CandidateOfferRow` (`§8.3`, detail variant),
  `BrandAnchorControl` (`§8.4`), `BrandAnchorChip` (`§8.5`), `PromotionBadge` (`§8.10`),
  `MoneyDisplay` (`§8.11`), `FavoriteToggle` (`§8.15`), `QuantityStepper` (`§8.14`, full),
  `MatchingInProgressState` (`§8.20`, detail), `SkeletonLoader` (`§8.29`), `Modal` (`§8.28`,
  archive-term).

### B.7 Comparison
- **Purpose** — the planning-mode deciding surface: "where do I buy this basket cheapest?"
  **online-only** (`10 §5`, `07 §7.1`).
- **States** — loading (skeleton); loaded (summary band + per-item rows, collapsed/expanded);
  not-available cells (explicit, ≠ `0`); broad-vs-anchored contribution (`basis`); matching-in-
  progress items (listed, separated, **excluded from totals**); empty ("nothing to compare yet");
  **offline/error → withheld** ("comparison unavailable — reconnect to compare").
- **Components** — `ComparisonSummaryBand` (`§8.6`), `StoreCard` (`§8.9`), `ComparisonItemRow`
  (`§8.7`), `StoreContributionCell` (`§8.8`), `CandidateOfferRow` (`§8.3`, comparison-expansion,
  read-only), `PromotionBadge` (`§8.10`), `MoneyDisplay` (`§8.11`), `MatchingInProgressState`
  (`§8.20`, comparison), `EmptyState` (`§8.26`), `SkeletonLoader` (`§8.29`).

### B.8 Family screen
- **Purpose** — view/manage one family: members, roles, invitations, the membership lifecycle
  (`10 §4`).
- **States** — single-member (just-created, self as admin); multi-member; member view (admin
  controls hidden/disabled, never error-on-tap); admin view (invite, revoke, promote/demote,
  remove); **last-admin blocked** (explain + route to "promote first"); invite idle/submitting/
  success/error; no-pending-invitations (no inbox). Solo-leave → "leave & delete family" confirm.
- **Components** — `FamilyMemberRow` (`§8.22`), `FamilyInviteForm` (`§8.23`), `RoleGatedAction`
  (`§8.25`), `OwnershipBadge` (`§8.16`), `Modal` (`§8.28`, destructive: leave/delete),
  `EmptyState` (`§8.26`), `Toast` (`§8.27`).

### B.9 Accept-invitation screen
- **Purpose** — the **deep-link target** that accepts an emailed invitation; there is **no in-app
  pending-invitations inbox** (`10 §4.5`).
- **States** (must render all) — resolving token; `pending` → accept succeeds (↻ fresh token);
  `expired` → `410 invitation_expired`; `already_accepted` → idempotent success (accept disabled);
  `revoked`/unknown → not-found — each with a clear next step.
- **Components** — `AcceptInvitationScreen` (`§8.24`), `Toast` (`§8.27`).

### B.10 Cross-cutting overlays (not screens)
- **`SyncStatusIndicator`** (`§8.19`) — offline banner / sync-pending cue / sync-failed notice /
  synced "updated X ago"; on every authenticated surface; **no conflict state** (`10 §7.6`).
- **`Toast`** (`§8.27`) — transient non-blocking notice, chiefly sync-failed-for-this-change;
  never blocks editing.
- **`Modal`** (`§8.28`) — focused confirm for genuinely destructive, **separated** actions
  (remove-line ≠ archive-term; leave-&-delete-family); **never** a match/anchor/conflict confirm.

-----

## Open for design

Genuinely undecided at flow level (not invented here). Everything else traces a closed rule.

1. **Offline sign-out behaviour (Flow 12).** `POST /auth/logout` revokes the lineage server-side
   (`06 §5.2`); `10`/`07`/`06` do **not** specify what a sign-out tap does while **offline** (drop
   the in-memory token locally and reconcile revocation on reconnect, vs block the action). A small
   client-mechanics call for `07`; flagged, not invented.
2. **Auth screen is a leaf screen with no `10 §8` component.** `10`'s catalog (built from §1–7)
   names no auth/login component — auth is out of the screen-state rulebook's scope. The Auth
   screen's presentation is therefore unspecified at component level; it needs either a designer
   call or a small catalog addition. Flagged so it isn't mistaken for an omission in this document.
3. **"Install as app" prompt placement.** `07 §3.4` fixes *that* it appears "after the user has
   created or opened a list" but not *which surface/moment*; `10` names no component for it. A
   presentation/timing call.

All three are presentation- or client-mechanics-level. No **product** behaviour is missing, and no
flow required a step absent from `10 §1–7`. The deliberately-excluded surfaces remain excluded and
were **not** given flows: barcode scanner, recipes/meal-plan, notifications, non-family share-link,
real-time presence, native onboarding, conflict/merge, standalone purchase-history, pending-
invitations inbox (each excluded by an explicit rule — `10` Open-for-design, §7.6, §6.4, §4.5,
D §1).

-----

*Last updated: June 2026 · canonical for **end-to-end MVP user flows** and the **screen inventory**
derived from them. Traces decided behaviour only: broad-by-default, match-by-selection (no yes/no
dialog), opt-in brand anchoring, owner-level favorites + purchase log, offline-first lists with
last-write-wins (no conflict UI), email-only family invites with the deep-link accept screen.
`10` stays canonical for screen-state & component behaviour; `07` for client mechanics; `06` for
wire shapes; `02`/`00`/`D` for meaning & scope. Thirteen flows · nine screens (+ three cross-cutting
overlays). Table prefix not referenced (this document is flow/screen-level).*
