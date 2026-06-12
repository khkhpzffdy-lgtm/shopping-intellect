# 10 — UX Rules (Screen-State & Component Behaviour)

> **Load when:** designing or reviewing any PWA screen, state, or component; deciding how a
> UserProduct / brand anchor / family role / comparison / favorite / offline state should
> *look and behave*; writing acceptance criteria for a UI ticket.
> **Depends on:** `decisions.md` (always loaded) · `00-overview.md` (MVP in/out) ·
> `02-domain-model.md` (entity meaning) · `06-api-auth.md` (the response shapes the UI
> receives, incl. `basis`) · `07-frontend.md` (client architecture & the two-mode mechanics).
> **Standalone for:** screen-state and component-level UX behaviour — the rules a designer
> needs so that building a screen requires **zero product decisions**. For client
> architecture, offline storage, the sync queue, and the two-mode *mechanics* → `07` (still
> canonical there). For entity meaning → `02` · wire shapes → `06` · scope → `00` / `D`.

-----

## 0. Purpose & the boundary

This document is canonical for **what the user sees and what it does** — every screen state,
every component-level behaviour, every empty/loading/error/offline variant — for the
demand-first MVP. It is the layer between architecture and visual design: it lets a designer
build screens **without making a single product decision**.

It deliberately does **not** design screens. No wireframes, no layouts, no visual hierarchy,
no colour, no component anatomy — those are §8 / §9 (next session) and the designer’s visual
craft. This document fixes **behaviour and state**, not pixels.

Two canonical boundaries with `07`:

- `07` stays canonical for **client architecture and the two-mode (planning / shopping)
  *mechanics*** — IndexedDB, the sync queue, Zustand↔TanStack-Query, the mode toggle as
  client state. This document references those, never re-specifies them.
- This document is canonical for **screen-state and component-level UX** — what each surface
  shows at rest, on load, when empty, when offline, when anchored, per role, etc.

Where the five source docs were silent at screen/component level, this document fills the gap
**only at that level**. It re-decides no product behaviour; every closed decision in
`decisions.md` is treated as fixed. New screen-level resolutions are recorded in the fold-back
at the end; genuine gaps that need a product/contract call are in **Decision Required**.

-----

## 1. UX Principles — the rules everything obeys

Five principles govern every screen. When a design choice is unclear, resolve it by these,
in this order.

|#|Principle               |What it forces on every screen                                                                                                                                                                                                                                                                                                                                         |
|-|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1|**Broad by default**    |A term shows the *whole category across all stores*, never “the product.” Brand is an **opt-in anchor**, never a step, never a layer. Clearing an anchor always widens back to broad. The UI never presents one canonical product as the answer. (D §4, 02 §7)                                                                                                         |
|2|**Match by selection**  |Browsing candidates and **choosing is the match**. There is **no “is this the same product? yes/no” dialog anywhere in the product** — not on add, not on first open, not on categorization doubt. A debatable candidate is just an odd extra row the eye ignores; it never blocks. (D §4, 02 §7, 06 §8)                                                               |
|3|**Offline-first**       |The list is **always editable**, online or off. Edits apply optimistically and queue; nothing the user *intends* blocks on the network. Server-derived data (comparison, candidates) is **never shown stale-as-fresh** — when it can’t be fresh, it is withheld with a clear reason, not faked. (D §7, 07 §4/§7)                                                       |
|4|**Owner-level metadata**|Favorites, recently-bought, and frequently-bought belong to the **owner** — the family if the list is family-owned, otherwise the user. The same person sees *different* favorite/recent/frequent sets depending on whether they are acting in a personal or a family context. Counts and thresholds are **server-supplied; never hardcode them**. (D §9, 02 §6, 07 §8)|
|5|**Calm in store**       |Shopping mode is a low-friction, large-target checklist. The comparison is out of the way. **No surprises mid-aisle** — no automatic mode switches, no price tables competing for attention, no network dependency for checking off. (D §9, 07 §7.2)                                                                                                                   |

Two pervasive corollaries (consequences of the five, not separate principles):

- **Transparency over suppression.** Staleness and doubt are *shown*, never hidden:
  “updated X ago”, “matching in progress”, “not available”, “comparison unavailable”. The UI
  never silently substitutes a guess for missing truth. (D §4, 02 §3, arch. §12 via `07`)
- **No conflict UI.** Sync is **last-write-wins on server `updated_at`**. There is no merge
  screen, no conflict dialog, no “which version do you want?” — ever, in MVP. The only
  recency signal is “updated X ago.” (D §9, 07 §4.3)

-----

## 2. UserProduct Rules

A **UserProduct** is the user’s own term for a thing (“мляко”, “прах Ariel”) — the entry
point and the unit the whole UI is built around (02 §6, D §4). The user **never picks from a
global product catalog**; their term is what they type.

### 2.1 What a UserProduct carries at rest

At rest — before any candidates load — a UserProduct holds **only owner-side data**:

- the **term** as typed,
- a **category attachment**: either a resolved bucket, or `category_id: null` →
  **“matching in progress”** (the crawler hasn’t bucketed it yet — 06 §6.3, resolved as the
  `200`-empty state in D §14),
- an **`is_favorite`** flag,
- an optional **brand anchor** (a brand token; absent = broad — §3),
- on a list line: a **quantity / unit** and an **`is_checked`** state.

**No store products and no prices exist on a UserProduct at rest.** A resting list row shows
the term, quantity, checked state, the favorite mark, and a brand chip *iff* anchored — and
nothing about any store or any price.

### 2.2 When store products and prices appear

Store offers and prices appear **only on explicit demand**, never inline on a resting row:

|Trigger                           |What loads                                                           |Source                      |
|----------------------------------|---------------------------------------------------------------------|----------------------------|
|Open **Product Detail** for a term|Every in-bucket candidate offer across all stores, with promo markers|`GET …/candidates` (06 §6.3)|
|Open **Comparison** for a list    |Per-store contributions + totals + every candidate behind expansion  |`GET …/comparison` (06 §6.4)|

Both are **online-dependent and volatile** (they need current server-side prices); they are
never written to IndexedDB and never shown offline as fresh (07 §4.1). Offline, both degrade
(§7), while the list itself stays editable.

### 2.3 Broad vs anchored — the two states of a term

|State                |Meaning                           |Candidate set                                                |Comparison contribution                                                                     |On-row indicator                 |
|---------------------|----------------------------------|-------------------------------------------------------------|--------------------------------------------------------------------------------------------|---------------------------------|
|**Broad** (default)  |“Show me this category everywhere”|All in-bucket offers, all stores (`broad: true`)             |*Representative* per store = cheapest in-category (`basis: cheapest_in_category`)           |Category/term only, no brand chip|
|**Anchored** (opt-in)|“I care about this brand”         |Narrowed to the anchored brand across stores (`broad: false`)|Only the anchored brand’s offer, or **not available** where absent (`basis: brand_anchored`)|A **brand chip** on the row      |

Anchoring and clearing are covered in §3.

### 2.4 The “matching in progress” state (category_id = null)

A brand-new term often has no bucket yet. This is a **normal state, never an error**:

- Product Detail shows an explicit **“matching in progress”** message with an empty candidate
  list — **not** a failure, **not** a spinner that never resolves, **not** a “no results”
  dead-end. (06 §6.3 note; D §14 resolved `200`-empty.)
- The row stays fully usable: it can be checked off, quantity-edited, favorited, kept on the
  list. Only the *price comparison* for that single term is pending.
- In Comparison it is handled per §5.6.

### 2.5 Two distinct destructive actions (do not conflate)

- **Remove a list line** (`DELETE …/items/{id}`) — removes the line from *this list*. It does
  **not** delete the term, its favorite, or its purchase history; the term outlives the line
  (06 §6.2, 04 `RESTRICT` via D).
- **Archive a term** (`PATCH …/{id}` `is_archived`) — the soft-delete of the UserProduct
  itself; frees the `(owner, normalized_term)` slot while **preserving purchase history**
  (D §14). Archived terms do not appear in active lists or the Add surface; re-typing the same
  term un-archives/reuses the existing row (06 §6.3).

The designer must surface these as **separate** actions; “remove from list” must never read as
“delete forever.”

### 2.6 Representation across surfaces (summary)

|Surface                     |What a UserProduct looks like                                                                                                                                                                  |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Shopping List (planning)**|Term · quantity/unit · favorite mark · brand chip if anchored · expandable to candidates. No inline price.                                                                                     |
|**Shopping List (shopping)**|Large checklist row: term · quantity · check target · `added_by` attribution on family lists. No price, no expansion. (§4.4, §5)                                                               |
|**Add / Search**            |Matches the **owner’s own terms**; offers favorites / recent / frequent quick-add and category/promotion browse. **No global product-catalog picker.** A new term → a new UserProduct. (§2, §6)|
|**Product Detail**          |Term · favorite toggle · quantity/unit edit · **candidates across all stores** with promo markers · the anchor action (§3). Where prices live. “Matching in progress” if no bucket.            |
|**Comparison**              |A row contributing to each store’s total (broad → representative; anchored → the brand offer or *not available*), expandable to all candidates (§5).                                           |

-----

## 3. Brand Anchor Rules

### 3.1 Meaning to the user

An anchor says **“for this term I care about this specific brand — show me only it.”** The
default is always **broad**; anchoring is a deliberate, reversible narrowing the user opts
into, never a required step and never a separate catalog layer (D §4, 02 §13).

### 3.2 Creating an anchor

- The anchor action lives **on a candidate in Product Detail**. The user picks one candidate
  offer and chooses to anchor the term to that offer’s brand; the server copies that offer’s
  `brand_normalized` into the term’s `brand_anchor` (`POST …/anchor` — 06 §6.3, 04 §7.2).
- There is **no separate “choose a brand” catalog** and **no yes/no confirmation** — picking
  the candidate *is* the anchor act, consistent with match-by-selection (§1.2).

### 3.3 Removing / widening

- Clearing the anchor (`brand_anchor: null`) **always widens back to broad** and is always
  available wherever the anchored state is shown (the brand chip is the affordance). (06 §6.3)
- Widening is non-destructive: nothing about the term, its favorite, or its history changes.

### 3.4 Anchored vs non-anchored representation

- **Non-anchored:** term/category only; no brand marker anywhere.
- **Anchored:** a **brand chip** on the list row, in Product Detail, and in Add/Search results.
  The chip is also the clear-anchor control (tap → back to broad).
- **Chip label (resolved — was D-1):** the chip shows the **`brand_normalized` token,
  title-cased client-side at render** (Cyrillic-aware — e.g. `ariel` → “Ariel”,
  `coca cola` → “Coca Cola”, `верея` → “Верея”) — **the brand only**, no offer name. The
  token stays the cross-store match key; only the *rendered* text is title-cased. No new
  schema, no lookup. At Stage 2 the chip’s text source swaps to the `brands` display name
  **with no UX change**; an optional tiny client-side exception map (≤5–10 brands) covers
  typography edge cases (“LIDL”, etc.) and also retires at Stage 2. The **“Anchor” action is
  offered only for a candidate that carries a brand token** (no anchoring to an empty brand).
  (Closed in `decisions.md §14`.)

### 3.5 Comparison & candidate behaviour when anchored

- **Candidates** narrow to the anchored brand across stores (`broad: false` — 06 §6.3).
- **Comparison** contributes only the anchored brand’s offer per store, or an explicit
  **not available** where that store lacks it (`basis: brand_anchored`, `null` contribution —
  06 §6.4, 02 §12).
- **Search/Add** shows the brand chip on the anchored term so the user recognises it as
  narrowed, not broad.

-----

## 4. Family Ownership Rules

### 4.1 The three ownership shapes

|Shape       |`owner_type`|Who sees it                                                                                 |Whose metadata applies                                 |
|------------|------------|--------------------------------------------------------------------------------------------|-------------------------------------------------------|
|**Personal**|`user`      |Only the owner                                                                              |The individual’s favorites / recent / frequent         |
|**Family**  |`family`    |**All current members** of that family                                                      |The **family’s** favorites / recent / frequent (shared)|
|**Shared**  |—           |“Shared” is simply a *family* list seen by other members; items carry `added_by` attribution|The family’s                                           |

A list belongs to a user **or** a family, never both; ownership is fixed at creation (no
transfer flow in MVP — 02 §6). A user may belong to **several** families (`family_ids[]`).

### 4.2 The owner-context rule (critical, easy to miss)

UserProducts, favorites, and the purchase log are **owner-scoped** exactly like lists (02 §6).
Therefore the favorites / recent / frequent the user sees **while adding to a list depend on
that list’s owner**: in a personal list they see their personal sets; in a family list they
see the family’s shared sets. The Add/Search surface must resolve these against the **owner of
the list currently in context**, not against the logged-in user globally. (folded back below.)

### 4.3 Roles, gating, and the states that exist

|Capability                                              |Member|Admin|UI rule                                                                        |
|--------------------------------------------------------|:----:|:---:|-------------------------------------------------------------------------------|
|Create / edit lists & items, check off, favorite, anchor|✓     |✓    |Available to all members                                                       |
|Invite by email                                         |✗     |✓    |Admin-only; **hide or disable** for members, never error-on-tap                |
|Revoke a pending invitation                             |✗     |✓    |Admin-only                                                                     |
|**Change a member’s role** (admin↔member)               |✗     |✓    |Admin-only; the hand-off control (§4.5); demoting the last admin → `last_admin`|
|Remove a member                                         |✗     |✓    |Admin-only; **last admin cannot be removed** → block with `last_admin` (§4.5)  |
|**Leave the family** (self-leave)                       |✓     |✓    |Any member may leave themselves; a sole admin must hand off first (§4.5)       |
|Delete the family                                       |✗     |✓    |Admin-only                                                                     |

The UI must **gate by role visibly** (admin actions hidden/disabled for members) and show each
member’s role. Role comes from `GET /families` (`role`) and the JWT (06 §6.6, §4.3).

### 4.4 Family lists in shopping mode

- Each item shows **who added it** (`added_by_user_id` — 02 §6) so a shared list reads as a
  collaboration.
- Any member may check any item; checking is **last-write-wins**, surfaced only as “updated X
  ago” — never a conflict dialog (§1, §7).

### 4.5 Invitations & membership lifecycle

- **Invite path:** by **email only** — the sole join path in MVP. No link-sharing, no public
  join (D §9, 02 §5).
- **Inbound acceptance:** the invitee receives an emailed token and accepts via the
  **deep-link that opens the app to an accept screen** (`POST /invitations/{token}/accept`).
  There is **no in-app “pending invitations” inbox** in MVP — the app exposes no list-my-pending
  endpoint (06 §6.6). (folded back below.)
- **Invitation states** the accept screen must render: `pending` → accept succeeds;
  `expired` → `invitation_expired` (410); `already_accepted` → idempotent success;
  `revoked` / unknown token → not-found. (02 §5, 06 §6.6/§10.)
- **Membership exits (resolved — was D-2):**
  - **Any member can leave themselves** (`DELETE …/members/{me}` — auth widened to admin-or-self,
    06 §6.6). On leaving, their view drops the family at once (fresh token); other members see it
    at their next refresh (≤15 min).
  - **An admin hands off** by promoting another member to admin first (`PATCH …/members/{id}`
    `role: admin` — 06 §6.6), then leaving. The promote control is the admin’s hand-off
    affordance (§4.3).
  - **Last-admin block:** a sole admin **cannot** leave/be removed while other members remain
    (`409 last_admin`); the UI must explain *why* and route them to **promote a member first**.
  - **Solo member leaving:** if they are the only member, leaving **succeeds and deletes the
    now-empty family** server-side (06 §6.6) — surface this as “leave & delete family,” not a
    silent no-op.

### 4.6 Family empty / edge states

- **Solo user (no family):** personal lists only; a clear CTA to create a family. No family UI
  clutter until one exists.
- **Membership change:** a removed member’s view corrects at their **next refresh (≤15 min)**;
  the actor’s own view updates immediately via the fresh token (06 §4.2). The UI must not
  promise instant propagation to *other* devices.

-----

## 5. Comparison Rules

Comparison is the **planning-mode deciding surface**: “where do I buy this basket cheapest?”
It is **online-only**, reads **only published current prices**, makes **no request-time crawl**,
and degrades offline per §5.7 (D §10, 02 §12, 06 §6.4, 07 §7.1).

### 5.1 What shows first (the summary band)

On open, the top-level answer is the **per-store decision summary**:

- each store’s **basket total**,
- the **cheapest store** highlighted (`cheapest_store`),
- each store’s **`missing_items` count** shown *next to its total* — always, so a low total
  isn’t misread (a store wins on price partly because it lacks items). **A store total is never
  presented as “cheapest” without its missing-items count visible** beside it. (06 §6.4.)

### 5.2 What’s behind expansion (per item)

Below the summary, **one row per list item**, each collapsed to its **per-store contribution**
(`store_contribution`). Expanding an item reveals **every in-bucket candidate per store with
promo markers** (`candidates_by_store`) — broad by default, not a single cheapest (D §10).

### 5.3 Multiple offers per store for one item

A store may have several candidates for one item (the array). The **contribution** uses the
*representative* (broad → cheapest-in-category; anchored → the brand offer); the **expansion**
lists all candidates so the user can see what the representative was chosen from. Never collapse
multiple offers into a single number with no way to see the rest.

### 5.4 Promotions

`is_promo: true` is shown as a **promo marker** on the candidate *and* on the contribution it
feeds. Promo is a *flag on a price*, not a separate surface (02 §8). Where a promo price is the
current price, it is the price shown (no parallel “regular vs promo” toggle in MVP).

### 5.5 Not-available items & per-store totals

- A missing offer is an **explicit “not available”** (`null`), **never `0` or a blank**
  (06 §6.4/§8, 02 §12). “Not available” and “free/zero” must be visually unmistakable.
- Each not-available offer increments that store’s `missing_items` (§5.1).
- The **per-store total** is the sum of contributions: broad items contribute the
  cheapest-in-category representative (`basis: cheapest_in_category`); anchored items contribute
  their brand’s offer (`basis: brand_anchored`). The `basis` field drives whether a contribution
  is labelled as a *representative of a category* vs the *exact anchored brand* — surface that
  distinction, however lightly, so a broad contribution is not mistaken for an exact pick.

### 5.6 “Matching in progress” items in comparison (screen-level fill)

A term still awaiting a bucket (`category_id: null`) has no candidates anywhere yet. To keep the
where-to-shop decision trustworthy:

- it is **listed in the item rows, labelled “matching in progress”**, visually separated from
  genuinely *not-available* items;
- it is **excluded from the per-store totals and from the cheapest-store calculation**, so a
  household’s brand-new term cannot distort the decision;
- only **categorized-but-absent** offers count toward a store’s `missing_items` — a
  not-yet-matched term is not the same as “this store doesn’t carry it.” (folded back below.)

### 5.7 Partial matches & offline

- **Partial availability** (available at some stores, not others) is normal: not-available
  flags at the missing stores, counted in `missing_items`, contributing to those store totals
  as absent. The cheapest-store badge is read **together with** missing counts (§5.1).
- **Offline:** Comparison shows **“comparison unavailable — reconnect to compare”** and renders
  nothing stale; the list stays fully editable beneath it (07 §7.1). Comparison data is never
  cached as fresh (07 §4.1).

-----

## 6. Favorites Rules

Four related-but-distinct concepts. The designer must keep them **semantically separate**; they
are not interchangeable.

|Concept              |Source                                                                  |User action         |Purpose                                   |Owner-scoped?|
|---------------------|------------------------------------------------------------------------|--------------------|------------------------------------------|:-----------:|
|**Favorite**         |`is_favorite` flag on the UserProduct (manual)                          |**Toggle** (a heart)|“Keep this handy” — explicit intent       |✓            |
|**Recently bought**  |Derived: max `purchased_at`                                             |**None** (automatic)|Fast re-add of what was just bought       |✓            |
|**Frequently bought**|Derived: count in the server’s window (default 8-week / ≥3, **tunable**)|**None** (automatic)|Surface the household’s staples           |✓            |
|**Purchase history** |The append-only `purchase_log` substrate                                |**None**            |The *source* of recent/frequent — see §6.4|✓            |

### 6.1 Favorite

- A **toggle** on the UserProduct, present wherever the term appears (list row, Product Detail,
  Add/Search). Offline-safe and queued (`PATCH /user-products/{id}` — 06 §6.3, 07 §8).
- It lives on the **term**, not the list line, so it **persists across lists** and across
  add/remove of lines.
- Badge: a **filled vs empty heart** (semantic: present/absent). Glyph choice is the designer’s.

### 6.2 Recently & frequently bought

- Both are **read-only, derived sections** in the Add/Search surface, from
  `GET /user-products?section=recent|frequent` (06 §6.3). They are **quick-add sources**, not
  lists, not editable.
- **Recently bought** orders by recency; a “bought X ago” style recency cue is appropriate
  (semantic, not a specific glyph).
- **Frequently bought** may show the server’s **`purchase_count_window`**; the client renders
  **whatever count the server returns and must never hardcode the window or threshold** (D §14,
  06 §6.3 note, 07 §8/§10). If the server returns no count, show none — don’t invent one.

### 6.3 Overlap & placement

- An item can be in **several** sections at once (e.g. favorite *and* frequent). Show the
  favorite heart wherever it appears; do **not** treat the sections as mutually exclusive and do
  not de-duplicate them into one merged list — they answer different questions.
- All four are **owner-scoped** (§4.2): in a family context they reflect the *family’s* behaviour.

### 6.4 No standalone purchase-history screen in MVP

The purchase log is the **substrate**, surfaced to the user **only** as recently / frequently
bought. There is **no browsable per-item purchase-history view** in MVP (no endpoint exists for
it — 06). A designer should not build one; if the need is raised, it is out of MVP scope, flag
it. (folded back below.)

-----

## 7. Offline Rules

The list is **offline-authoritative**; server-derived reads are **never trusted offline**
(07 §6.3). Below is exactly what the user sees in each state. **There is no conflict state** —
see §7.6.

|State                          |Trigger                                                   |What the user sees                                                                                                                                           |What stays usable                                                                 |
|-------------------------------|----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|
|**Offline**                    |No connection                                             |A clear, persistent **offline indicator**; lists open and edit from local storage; Comparison/Detail show **“comparison unavailable — reconnect to compare”**|Full list editing, checking, favoriting, quantity edits, adding terms (07 §3.3/§4)|
|**Sync pending**               |Queued mutations awaiting flush (incl. while reconnecting)|A subtle, **non-blocking** “syncing… / N changes pending” cue                                                                                                |Everything; the user never waits on it (07 §5)                                    |
|**Sync failed**                |A real rejection (e.g. list deleted elsewhere → `404`)    |A **non-blocking notice** for *that* change; it never wedges the queue or blocks other edits                                                                 |Everything else; the failed item is surfaced, not hidden (07 §5.3)                |
|**Data stale**                 |Local mirror older than server                            |**“updated X ago”** from the meta store; Comparison is **withheld** offline rather than shown stale (never stale-as-fresh)                                   |List editing; the indicator informs, doesn’t block (07 §4.3)                      |
|**Queue has pending mutations**|≥1 unsynced edit                                          |Same as *Sync pending*: a count + flush on reconnect/focus                                                                                                   |Everything (07 §5.3)                                                              |

### 7.6 Conflicts: none — last-write-wins, stated explicitly

There is **no conflict resolution UI in MVP**, by decision (D §9). When the same item is edited
on two devices, the server resolves by **last-write-wins on server `updated_at`**; the client
**rebases silently** on the next refetch. The user is shown **only “updated X ago”** — never a
merge screen, a version chooser, or a “conflict detected” prompt. **Do not design one.**

A related invisible case: if two devices coin the same term offline, the server **merges them to
one row** on sync (`(owner, normalized_term)` unique). The user simply sees **one** row
afterwards — **no “duplicate found” warning, no merge prompt** (07 §4.3).

-----

## 8. Component Inventory

> The reusable MVP component catalog implied by §§1–7. **One component per concept, with
> variants** — a component that appears on several surfaces (e.g. the list row in planning vs
> shopping mode) is **one** component with a `variant` prop, not three. Each entry maps back to
> the rule(s) it satisfies. No visuals — inventory only; per-component specs are in §9.
>
> Naming is React-flavoured (PascalCase component, camelCase props) so this feeds the build
> phase directly. Money is the `{ price_cents, currency }` pair everywhere (06 §3); **the client
> formats, the server never sends a formatted string.** No component holds server-derived price
> data offline (§7, 07 §4.1).

### 8.0 Catalog at a glance

| # | Component | Primary rule(s) | Added beyond baseline? |
|---|----------|-----------------|:----------------------:|
| 1 | `ShoppingListItem` | §2.6, §4.4, §7 | baseline |
| 2 | `ProductCard` | §2.6, §6 | baseline |
| 3 | `CandidateOfferRow` | §2.2, §3.5, §5.3 | **added** |
| 4 | `BrandAnchorControl` | §3.2, §3.3 | **added** |
| 5 | `BrandAnchorChip` | §3.4 | **added** |
| 6 | `ComparisonSummaryBand` | §5.1 | baseline (Comparison Card, split) |
| 7 | `ComparisonItemRow` | §5.2, §5.3, §5.6 | baseline (Comparison Card, split) |
| 8 | `StoreContributionCell` | §5.2, §5.4, §5.5 | **added** |
| 9 | `StoreCard` | §5.1 | baseline |
| 10 | `PromotionBadge` | §5.4 | baseline |
| 11 | `MoneyDisplay` | D §4 currency, §5 | **added** |
| 12 | `SearchBar` | §2.6, §6.2 | baseline |
| 13 | `QuickAddSection` | §6.2, §6.3 | **added** |
| 14 | `QuantityStepper` | §2.1, §2.6 | baseline |
| 15 | `FavoriteToggle` | §6.1 | baseline (was "Ownership Badge" mis-named; see note) |
| 16 | `OwnershipBadge` | §4.1 | baseline |
| 17 | `AttributionChip` | §4.4 | **added** |
| 18 | `ModeToggle` | §1.5, 07 §7.3 | **added** |
| 19 | `SyncStatusIndicator` | §7 | **added** |
| 20 | `MatchingInProgressState` | §2.4, §5.6 | **added** |
| 21 | `ListCard` | §4.1, §4.6 | **added** |
| 22 | `FamilyMemberRow` | §4.3, §4.5 | **added** |
| 23 | `FamilyInviteForm` | §4.5 | **added** |
| 24 | `AcceptInvitationScreen` | §4.5 | **added** |
| 25 | `RoleGatedAction` | §4.3 | **added** (cross-cutting wrapper) |
| 26 | `EmptyState` | §4.6, §6, §7 | baseline |
| 27 | `Toast` | §7 | baseline |
| 28 | `Modal` | §2.5, §4.5 | baseline |
| 29 | `SkeletonLoader` | §2.2, §5 | baseline |

**Note on baseline rename:** the baseline list names a "Quantity Stepper" *and* an "Ownership
Badge"; it does not name a Favorite toggle even though §6.1 makes it a first-class control. The
heart is split out as `FavoriteToggle` (15), and `OwnershipBadge` (16) is kept for its actual
§4.1 meaning (personal/family list shape). They are **not** the same component.

-----

### 8.1 `ShoppingListItem`
- **Purpose** — one list line. The single most-used component; renders in both list modes (§2.6, §4.4).
- **Props/data** — `item` (`id`, `client_uuid`, `term`, `category_id`, `brand_anchor`, `quantity`, `unit`, `is_checked`, `added_by_user_id`, `updated_at` — 06 §6.2); `variant: 'planning' | 'shopping'`; `ownerType: 'user' | 'family'`; `isFavorite`.
- **User actions** — check/uncheck; edit quantity/unit; toggle favorite; expand to Product Detail; remove line (≠ archive — §2.5).
- **States** — unchecked / checked; broad / anchored (brand chip shown iff `brand_anchor`); matching-in-progress (`category_id: null`); offline-editable; sync-pending. **No price ever** (§2.1).
- **Variants** — `planning` (term · qty · favorite · brand chip · expandable, no price) vs `shopping` (large checklist row · qty · check target · `added_by` on family lists · not expandable).

### 8.2 `ProductCard`
- **Purpose** — the Product Detail surface for one UserProduct: where candidates and prices live (§2.6, §2.2).
- **Props/data** — `userProduct` (`id`, `term`, `category_id`, `brand_anchor`, `is_favorite`); `candidates` (06 §6.3 `…/candidates`); `broad` flag.
- **User actions** — toggle favorite; edit quantity/unit; anchor/clear brand (via 4/5); archive term (§2.5).
- **States** — loading candidates; broad / anchored; **matching-in-progress** (renders 20 instead of a candidate list); offline (candidates withheld — §7).
- **Variants** — none structurally; content driven by `broad`.

### 8.3 `CandidateOfferRow` *(added)*
- **Purpose** — one concrete store offer inside Product Detail / comparison expansion. The atom of "match by selection" (§2.2, §5.3).
- **Props/data** — `candidate` (`store`, `store_product` name, `price` `{price_cents,currency}`, `is_promo`, `valid_from/to` — 06 §6.3); `canAnchor` (true iff offer carries a brand token — §3.4); `isAnchored`.
- **User actions** — anchor the term to this offer's brand (the anchor act *is* the selection — §3.2); no yes/no dialog.
- **States** — promo / regular (`PromotionBadge`); anchorable / not; currently-anchored highlight.
- **Variants** — `detail` (full, with anchor affordance) vs `comparison-expansion` (read-only, no anchor).
- **Added because** the baseline omits the demand-first candidate atom; it is required by §2.2 and §5.3 and is distinct from `ProductCard`.

### 8.4 `BrandAnchorControl` *(added)*
- **Purpose** — the affordance that creates an anchor from a candidate, and clears it (§3.2, §3.3).
- **Props/data** — `userProductId`; `brandToken` (`brand_normalized` of the chosen offer); `isAnchored`.
- **User actions** — anchor (`POST …/anchor { brand_anchor }`); clear/widen (`brand_anchor: null`) — both offline-queueable (07 §5).
- **States** — anchorable (offer has a brand token); disabled (no brand token — §3.4); anchored.
- **Variants** — inline-on-candidate (the anchor entry point) vs the chip-as-clear-control (delegates to 5).

### 8.5 `BrandAnchorChip` *(added)*
- **Purpose** — shows a term is narrowed to a brand, and is itself the clear-anchor control (§3.4).
- **Props/data** — `brandToken` (`brand_normalized`); label = token **title-cased client-side, Cyrillic-aware** (D-1).
- **User actions** — tap → clear anchor → widen back to broad (§3.3).
- **States** — present only when anchored; never shown broad.
- **Variants** — appears on list row, Product Detail, Add/Search result (§3.4) — same component, placement only.

### 8.6 `ComparisonSummaryBand`
- **Purpose** — the top-level "where do I shop" answer: per-store basket totals + cheapest store (§5.1).
- **Props/data** — `storeTotals` (`{ store: { price_cents, currency, missing_items } }`); `cheapest_store` (06 §6.4).
- **User actions** — none decisional (read surface); may scroll to item rows.
- **States** — loading; loaded; **offline → withheld** ("comparison unavailable — reconnect to compare", §5.7); empty list.
- **Variants** — none. **Each store total always renders its `missing_items` beside it** (§5.1 — never optional).

### 8.7 `ComparisonItemRow`
- **Purpose** — one list item inside comparison: collapsed contribution per store, expandable to all candidates (§5.2).
- **Props/data** — `item` with `store_contribution` (per store: `{price_cents,currency,is_promo,basis}` or `null`) and `candidates_by_store` (06 §6.4); `brand_anchor`.
- **User actions** — expand/collapse to reveal `CandidateOfferRow`s per store.
- **States** — collapsed / expanded; broad (`basis: cheapest_in_category`) vs anchored (`basis: brand_anchored`); **matching-in-progress** (listed, labelled, **excluded from totals** — §5.6).
- **Variants** — none; `basis` drives the representative label.

### 8.8 `StoreContributionCell` *(added)*
- **Purpose** — what one item adds to one store's total — the cell where `null` must read as "not available", never `0` (§5.5).
- **Props/data** — `contribution`: `{price_cents,currency,is_promo,basis}` **or** `null`; `store`.
- **User actions** — none.
- **States** — priced (regular / promo); **not-available (`null`)** — visually unmistakable from zero (§5.5); representative-of-category vs exact-anchored-brand distinction surfaced from `basis` (§5.5).
- **Variants** — none.
- **Added because** §5.5's "`null` ≠ `0`" and the `basis` distinction need a dedicated cell; folding it into `MoneyDisplay` would lose the not-available and basis semantics.

### 8.9 `StoreCard`
- **Purpose** — represent one chain (Lidl / Kaufland / Billa / Fantastico) in the summary band and elsewhere (§5.1).
- **Props/data** — `store` (key, display name); `total` `{price_cents,currency}`; `missing_items`; `isCheapest`.
- **User actions** — none in MVP (no per-store drill screen).
- **States** — cheapest-highlighted; has-missing-items; loading.
- **Variants** — `summary` (with total + missing count) vs `label` (name/logo only, e.g. on a candidate row).

### 8.10 `PromotionBadge`
- **Purpose** — mark a price as promotional (`is_promo: true`) — a flag on a price, not a surface (§5.4).
- **Props/data** — `isPromo`; optional `valid_to` (06 §6.3).
- **User actions** — none.
- **States** — shown iff `is_promo`; otherwise absent.
- **Variants** — on a `CandidateOfferRow` and on the `StoreContributionCell` it feeds (§5.4) — same badge.

### 8.11 `MoneyDisplay` *(added)*
- **Purpose** — the single place money is formatted, from the `{price_cents,currency}` pair (D §4, 06 §3). Centralises the 2026 BGN dual-display rule.
- **Props/data** — `money` (`{price_cents,currency}`); `showBgn?` (optional secondary BGN line for the 2026 dual-display period, computed client-side at fixed **1.95583**, rounded half-up — D §4). Never receives a pre-formatted string.
- **User actions** — none.
- **States** — value; null/absent (delegates "not available" rendering to `StoreContributionCell`, §8.8 — `MoneyDisplay` itself never invents `0`).
- **Variants** — `eur-only` vs `dual` (EUR primary + BGN secondary). Currency is constant `EUR` in Stage 1; the prop exists for forward-safety.
- **Added because** the baseline lacks a money primitive and the dual-display rule has no home otherwise; one component keeps formatting consistent and the conversion in exactly one place.

### 8.12 `SearchBar`
- **Purpose** — the Add/Search entry: searches **the owner's own terms only**; a new term creates a UserProduct (§2.6, §6.2).
- **Props/data** — `query`; `ownerType` + `ownerId` (resolves which owner's terms/metadata — §4.2); results = owner's matching terms.
- **User actions** — type; pick an existing term; submit a new term (→ inline `user_product` create on add, 06 §6.2).
- **States** — empty; typing; matches; **no-match → "add as new term" affordance** (never a dead end); offline (still creates terms — §7).
- **Variants** — none. **No global product-catalog picker** (§6.2 — explicit).

### 8.13 `QuickAddSection` *(added)*
- **Purpose** — the favorites / recently / frequently-bought quick-add blocks in Add/Search (§6.2, §6.3).
- **Props/data** — `section: 'favorites' | 'recent' | 'frequent'`; items from `GET /user-products?section=…` scoped to the **list's owner** (§4.2); for `frequent`, the server's `purchase_count_window` (rendered verbatim, **never hardcoded** — §6.2).
- **User actions** — tap a term to quick-add it to the current list.
- **States** — loading; populated; empty (`EmptyState`); offline (favorites are owner metadata mirrored where available; recent/frequent are server-derived and may be unavailable offline — §7).
- **Variants** — three (`favorites` shows the heart; `recent` shows a "bought X ago" recency cue; `frequent` shows the server count if present). **Not mutually exclusive and not de-duplicated** (§6.3).
- **Added because** §6.2/§6.3 define three distinct read-only quick-add sources the baseline doesn't name; one component with a `section` variant avoids three near-duplicates.

### 8.14 `QuantityStepper`
- **Purpose** — edit quantity/unit on a line or in Product Detail (§2.1, §2.6).
- **Props/data** — `quantity`; `unit`; bounds.
- **User actions** — increment/decrement; change unit (`PATCH …/items/{id}` or queued — 06 §6.2).
- **States** — editable; at-min (decrement disabled); offline-queued.
- **Variants** — `compact` (list row) vs `full` (Product Detail).

### 8.15 `FavoriteToggle`
- **Purpose** — the heart: manual `is_favorite` on the **term**, present wherever the term appears (§6.1).
- **Props/data** — `userProductId`; `isFavorite`.
- **User actions** — toggle (`PATCH /user-products/{id} { is_favorite }` — offline-safe/queued, §6.1).
- **States** — filled (favorite) / empty; offline-queued. Lives on the term → **persists across lists** (§6.1).
- **Variants** — none (size only).

### 8.16 `OwnershipBadge`
- **Purpose** — show whether a list is personal or family-owned (§4.1).
- **Props/data** — `ownerType: 'user' | 'family'`; optional `familyName`.
- **User actions** — none.
- **States** — personal / family.
- **Variants** — none. (Distinct from `AttributionChip`, which is per-*item* authorship — §8.17.)

### 8.17 `AttributionChip` *(added)*
- **Purpose** — "added by …" on a family list item, so a shared list reads as collaboration (§4.4).
- **Props/data** — `addedByUserId` → display name; shown **only** when `ownerType === 'family'`.
- **User actions** — none.
- **States** — present on family items; absent on personal lists.
- **Variants** — none.
- **Added because** §4.4's `added_by` attribution is a named requirement with no baseline component, and is semantically separate from `OwnershipBadge` (list-level) and `FavoriteToggle`.

### 8.18 `ModeToggle` *(added)*
- **Purpose** — flip a list between planning and shopping mode (§1.5, 07 §7.3).
- **Props/data** — `mode: 'planning' | 'shopping'`; `listId` (mode is remembered per list).
- **User actions** — toggle. **Pure Zustand/UI state, no server round-trip, works offline** (07 §7.3).
- **States** — planning / shopping; the app may *suggest* shopping but the switch is **always manual** — no automatic changes (§1.5).
- **Variants** — none.
- **Added because** the two-mode list is core (07 §7) and the toggle is its only control; the baseline omits it.

### 8.19 `SyncStatusIndicator` *(added)*
- **Purpose** — surface offline / sync state without ever blocking editing (§7). **Three states are distinct** (the task's explicit requirement).
- **Props/data** — `state: 'offline' | 'sync-pending' | 'sync-failed' | 'synced'`; `pendingCount`; `lastSyncAt` (for "updated X ago" — §7).
- **User actions** — none required (non-blocking); a failed item may offer retry (queue handles backoff — 07 §5).
- **States** — **offline** (persistent indicator + "comparison unavailable" downstream); **sync-pending** (subtle "syncing… / N pending", non-blocking); **sync-failed** (non-blocking notice for *that* change, never wedges the queue — §7); **synced/stale** ("updated X ago"). **No conflict state** (§7.6).
- **Variants** — `banner` (offline, persistent) vs `inline-cue` (pending/failed). Failed-item notice may also surface as a `Toast`.
- **Added because** §7 defines offline, sync-pending, and sync-failed as **distinct** states the baseline collapses; they must be visibly different.

### 8.20 `MatchingInProgressState` *(added)*
- **Purpose** — the `category_id: null` state: a normal "matching in progress", never an error, never a dead-end spinner (§2.4, §5.6).
- **Props/data** — `context: 'detail' | 'comparison'`.
- **User actions** — none (the row stays otherwise usable — check, qty, favorite — §2.4).
- **States** — in Product Detail: explicit message + **empty candidate list** (not a failure, not "no results"); in Comparison: **listed, labelled, visually separated** from not-available, and **excluded from totals** (§5.6).
- **Variants** — `detail` vs `comparison`.
- **Added because** §2.4/§5.6 make this a first-class, recurring state distinct from both empty and error; the baseline has no component for it.

### 8.21 `ListCard` *(added)*
- **Purpose** — one list in the lists overview (personal + every family list — 06 §6.2 `GET /lists`).
- **Props/data** — `list` (`id`, `name`, `owner_type`, `updated_at`); item count; `OwnershipBadge` data.
- **User actions** — open; create (the empty-state CTA); (no transfer/rename-of-owner in MVP — §4.1).
- **States** — personal / family; updated-X-ago; empty-of-items.
- **Variants** — none.
- **Added because** the lists overview needs a card; the baseline names item/product cards but not the list card.

### 8.22 `FamilyMemberRow` *(added)*
- **Purpose** — one member in a family, with role and role-gated controls (§4.3, §4.5).
- **Props/data** — `member` (`user_id`, display name, `role`); `viewerIsAdmin`; `isSelf`.
- **User actions** — promote/demote (admin, `PATCH …/members/{userId}` — §4.5); remove (admin); leave (self — §4.5). All wrapped in `RoleGatedAction`.
- **States** — admin / member; self; last-admin (promote/remove/leave **blocked with explanation** routing to "promote first" — §4.5).
- **Variants** — none.
- **Added because** §4.3/§4.5 define the role/membership UI explicitly; no baseline component covers it.

### 8.23 `FamilyInviteForm` *(added)*
- **Purpose** — invite a member **by email only** (the sole join path — §4.5).
- **Props/data** — `familyId`; `invited_email`; `invited_role` (default `member`).
- **User actions** — submit (`POST …/invitations` — admin-only, §4.5); revoke a pending invitation (admin).
- **States** — idle; submitting; success (`pending` created); error. **Admin-only — hidden/disabled for members, never error-on-tap** (§4.3).
- **Variants** — none. No link-share / public-join control (§4.5).
- **Added because** §4.5's email-only invite is a named MVP surface with no baseline component.

### 8.24 `AcceptInvitationScreen` *(added)*
- **Purpose** — the deep-link target that accepts an emailed invitation (§4.5). **There is no in-app pending-invitations inbox** (§4.5).
- **Props/data** — `token` (from the deep-link); resolved invitation `status`.
- **User actions** — accept (`POST /invitations/{token}/accept` → ↻ fresh token — §4.5).
- **States** — **must render all of:** `pending` → accept succeeds; `expired` → `invitation_expired` (410); `already_accepted` → idempotent success; `revoked`/unknown → not-found (§4.5).
- **Variants** — none.
- **Added because** §4.5 specifies this exact screen and its four states with no baseline equivalent.

### 8.25 `RoleGatedAction` *(added, cross-cutting)*
- **Purpose** — wrap any admin-only control so members see it **hidden or disabled, never an error on tap** (§4.3).
- **Props/data** — `requiredRole: 'admin'`; `viewerRole`; `mode: 'hide' | 'disable'`; `children`.
- **User actions** — passes through when permitted; inert otherwise.
- **States** — permitted / hidden / disabled-with-reason.
- **Variants** — `hide` vs `disable`.
- **Added because** §4.3 mandates *visible* role gating as a consistent rule; a single wrapper enforces "never error-on-tap" everywhere rather than re-implementing per control.

### 8.26 `EmptyState`
- **Purpose** — the calm, actionable empty surface for any list/section with no data (§4.6, §6, §7).
- **Props/data** — `context` (e.g. `no-family`, `no-lists`, `no-favorites`, `empty-list`); CTA.
- **User actions** — the context CTA (e.g. "create a family" for the solo user — §4.6; "add an item").
- **States** — one per context; never a dead-end.
- **Variants** — per context (copy + CTA differ).

### 8.27 `Toast`
- **Purpose** — transient, **non-blocking** notice — chiefly sync-failed-for-this-change (§7) and confirmations.
- **Props/data** — `message`; `severity`; optional `action` (e.g. retry).
- **User actions** — dismiss; optional action.
- **States** — info / success / error (failed-sync); auto-dismiss. **Never blocks editing** (§7).
- **Variants** — none.

### 8.28 `Modal`
- **Purpose** — focused confirmation for genuinely destructive actions kept **separate** (§2.5) — e.g. archive-term vs remove-line; leave-&-delete-family (§4.5). **Never a match/anchor confirmation** (§1.2 — none exists).
- **Props/data** — `title`; `body`; `confirm`/`cancel`.
- **User actions** — confirm / cancel.
- **States** — open / closed; confirming.
- **Variants** — `destructive` (archive, delete family) vs `neutral`. **No conflict/merge modal** (§7.6).

### 8.29 `SkeletonLoader`
- **Purpose** — placeholder while server-derived reads (candidates, comparison) load (§2.2, §5). **Never a never-resolving spinner for matching-in-progress** (that's 20, not loading — §2.4).
- **Props/data** — `shape: 'candidate' | 'comparison' | 'card'`; `count`.
- **User actions** — none.
- **States** — animating; replaced on load or by `MatchingInProgressState` / `EmptyState` / error as appropriate.
- **Variants** — per `shape`.

-----

## 9. Component Specifications

> Per-component spec: **Description · Inputs · Outputs · User actions · Loading · Empty · Error ·
> Disabled · Mobile.** A designer should be able to build each with **zero product decisions**.
> Where a state is genuinely N/A it is marked `—`. All offline/queue mechanics defer to 07; this
> section only states what the user *sees*.

### 9.1 `ShoppingListItem`
- **Description** — one list line; the workhorse, in planning or shopping variant (§2.6, §4.4).
- **Inputs** — `item` (06 §6.2 shape), `variant`, `ownerType`, `isFavorite`.
- **Outputs** — check-toggle, quantity/unit change, favorite-toggle, expand, remove-line events.
- **User actions** — check/uncheck; edit qty (planning); favorite; open Product Detail (planning); remove line (≠ archive, §2.5).
- **Loading** — line renders from local mirror instantly; no price, so nothing to load on the row itself.
- **Empty** — — (a row is never empty; the *list* empties via `EmptyState`).
- **Error** — failed sync for this line → non-blocking cue via `SyncStatusIndicator`/`Toast`; the row stays editable (§7).
- **Disabled** — never fully disabled; checking works offline (§7).
- **Mobile** — shopping variant = **large tap target**, arm's-length legible, one-tap check, minimal chrome (§1.5, 07 §7.2).

### 9.2 `ProductCard`
- **Description** — Product Detail for one term; where prices live (§2.6).
- **Inputs** — `userProduct`, `candidates` (06 §6.3), `broad`.
- **Outputs** — favorite, qty edit, anchor/clear, archive events.
- **User actions** — toggle favorite; edit qty/unit; anchor or clear brand; archive term.
- **Loading** — `SkeletonLoader shape="candidate"` for the candidate list.
- **Empty** — `category_id: null` → `MatchingInProgressState` (variant `detail`), **not** "no results" (§2.4).
- **Error** — candidate fetch fails → inline error + retry; the term's own data (favorite, qty) still editable.
- **Disabled** — anchor disabled where no candidate carries a brand token (§3.4).
- **Mobile** — full-height sheet; candidate rows are comfortable tap targets.

### 9.3 `CandidateOfferRow`
- **Description** — one store offer; selecting it (to anchor) *is* the match (§2.2, §3.2).
- **Inputs** — `candidate` (06 §6.3), `canAnchor`, `isAnchored`.
- **Outputs** — anchor-to-this-brand event.
- **User actions** — anchor (no yes/no dialog, §1.2).
- **Loading** — rendered as part of the candidate list skeleton (9.2).
- **Empty** — — (rows only exist when candidates exist).
- **Error** — — (errors handled at the list level in `ProductCard`).
- **Disabled** — anchor affordance disabled/absent when `canAnchor` is false (no brand token, §3.4).
- **Mobile** — full-width row; `PromotionBadge` and `MoneyDisplay` inline; anchor is a clear secondary action.

### 9.4 `BrandAnchorControl`
- **Description** — creates/clears a brand anchor (§3.2, §3.3).
- **Inputs** — `userProductId`, `brandToken`, `isAnchored`.
- **Outputs** — `POST …/anchor { brand_anchor }` or `{ brand_anchor: null }` (queueable).
- **User actions** — anchor; clear/widen.
- **Loading** — optimistic; chip appears/disappears immediately, reconciles on sync.
- **Empty** — —.
- **Error** — failed anchor sync → non-blocking cue; optimistic state rebases on refetch (§7).
- **Disabled** — when the candidate has no brand token (§3.4).
- **Mobile** — anchor is a tap on the candidate; clear is a tap on the chip.

### 9.5 `BrandAnchorChip`
- **Description** — shows a term is narrowed to a brand; tap clears (§3.4).
- **Inputs** — `brandToken`; label = token **title-cased client-side, Cyrillic-aware** (D-1).
- **Outputs** — clear-anchor event.
- **User actions** — tap → widen to broad (§3.3).
- **Loading** — —.
- **Empty** — absent entirely when broad (never an empty chip).
- **Error** — — (clear failure handled by 9.4).
- **Disabled** — —.
- **Mobile** — compact, tappable; on list row, Product Detail, and Add/Search result (§3.4).

### 9.6 `ComparisonSummaryBand`
- **Description** — per-store totals + cheapest store; the where-to-shop answer (§5.1).
- **Inputs** — `storeTotals` (`{store:{price_cents,currency,missing_items}}`), `cheapest_store` (06 §6.4).
- **Outputs** — none decisional.
- **User actions** — scroll to item rows.
- **Loading** — `SkeletonLoader shape="comparison"`.
- **Empty** — list with zero priced items → calm "nothing to compare yet" (`EmptyState`); matching-in-progress items don't count (§5.6).
- **Error** — comparison fetch fails → "comparison unavailable" message (same surface as offline, §5.7).
- **Disabled** — **offline → withheld**, "comparison unavailable — reconnect to compare"; nothing stale shown (§5.7).
- **Mobile** — horizontally scannable store totals; **`missing_items` always beside each total** (§5.1).

### 9.7 `ComparisonItemRow`
- **Description** — one item's per-store contribution, expandable to candidates (§5.2).
- **Inputs** — `item` with `store_contribution` + `candidates_by_store` (06 §6.4), `brand_anchor`.
- **Outputs** — expand/collapse event.
- **User actions** — expand to see all candidates per store (`CandidateOfferRow`, read-only variant).
- **Loading** — part of the comparison skeleton.
- **Empty** — `category_id: null` → `MatchingInProgressState` (variant `comparison`): listed, labelled, **excluded from totals** (§5.6).
- **Error** — — (handled at band level).
- **Disabled** — expansion has nothing to show for matching-in-progress items.
- **Mobile** — collapsed by default; expansion is a tap; `basis` distinction shown lightly (representative vs exact, §5.5).

### 9.8 `StoreContributionCell`
- **Description** — what one item adds to one store; `null` = not-available (§5.5).
- **Inputs** — `contribution` (`{price_cents,currency,is_promo,basis}` **or** `null`), `store`.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — inherits row skeleton.
- **Empty** — `null` → **explicit "not available"**, unmistakable from `0`/blank (§5.5).
- **Error** — —.
- **Disabled** — —.
- **Mobile** — compact; promo marker if `is_promo`; representative-vs-anchored cue from `basis` (§5.5).

### 9.9 `StoreCard`
- **Description** — one chain in the summary band / as a label (§5.1).
- **Inputs** — `store`, `total`, `missing_items`, `isCheapest`.
- **Outputs** — none (no drill screen in MVP).
- **User actions** — none.
- **Loading** — skeleton with the store name visible.
- **Empty** — store with no contributing items → total shown with full `missing_items` (§5.1).
- **Error** — —.
- **Disabled** — —.
- **Mobile** — `summary` variant fits the scannable total row; `label` variant is a small name/logo.

### 9.10 `PromotionBadge`
- **Description** — flags a promotional price (§5.4).
- **Inputs** — `isPromo`, optional `valid_to`.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — —.
- **Empty** — absent when not a promo.
- **Error** — —.
- **Disabled** — —.
- **Mobile** — small inline marker on candidate row and contribution cell; no parallel regular/promo toggle (§5.4).

### 9.11 `MoneyDisplay`
- **Description** — the one money formatter, from `{price_cents,currency}` (D §4, 06 §3).
- **Inputs** — `money`, `showBgn?`.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — — (formats whatever value it's given; the *value* loads upstream).
- **Empty** — null → renders nothing; not-available semantics belong to `StoreContributionCell` (§8.8), not here.
- **Error** — —.
- **Disabled** — —.
- **Mobile** — `dual` variant stacks EUR (primary) + BGN (secondary, ×1.95583, half-up) for the 2026 dual-display period; `eur-only` otherwise.

### 9.12 `SearchBar`
- **Description** — Add/Search over the **owner's own terms**; new term → new UserProduct (§2.6, §6.2).
- **Inputs** — `query`, `ownerType`, `ownerId` (§4.2).
- **Outputs** — pick-existing / create-new-term events (inline `user_product` on add, 06 §6.2).
- **User actions** — type; pick; add new.
- **Loading** — lightweight; the owner's term set is small/local.
- **Empty** — no query → show `QuickAddSection`s (favorites/recent/frequent).
- **Error** — create failure → queued + non-blocking cue; term still appears optimistically (§7).
- **Disabled** — never; works offline (terms are offline-born, §7).
- **Mobile** — prominent input; **no global catalog picker** (§6.2); no-match always offers "add as new term".

### 9.13 `QuickAddSection`
- **Description** — favorites / recently / frequently-bought quick-add, owner-scoped (§6.2/§6.3).
- **Inputs** — `section`, items from `GET /user-products?section=…` scoped to list owner (§4.2); server `purchase_count_window` for `frequent`.
- **Outputs** — quick-add-term event.
- **User actions** — tap a term → add to current list.
- **Loading** — `SkeletonLoader` rows.
- **Empty** — `EmptyState` per section ("no favorites yet", etc.).
- **Error** — recent/frequent are server-derived; on failure show the section as unavailable, don't fabricate (§6.2).
- **Disabled** — recent/frequent may be unavailable offline (server-derived); favorites still show where mirrored (§7).
- **Mobile** — chips/rows; `frequent` shows the **server's** count only (never hardcoded); sections **not de-duplicated** (§6.3).

### 9.14 `QuantityStepper`
- **Description** — quantity/unit editor (§2.1).
- **Inputs** — `quantity`, `unit`, bounds.
- **Outputs** — quantity/unit change (`PATCH …/items/{id}` or queued).
- **User actions** — +/−, change unit.
- **Loading** — — (operates on local state).
- **Empty** — —.
- **Error** — failed sync → non-blocking; value stays optimistically (§7).
- **Disabled** — decrement at minimum.
- **Mobile** — large +/− targets; `compact` on row, `full` in Product Detail.

### 9.15 `FavoriteToggle`
- **Description** — the heart on the term, everywhere it appears (§6.1).
- **Inputs** — `userProductId`, `isFavorite`.
- **Outputs** — `PATCH /user-products/{id} { is_favorite }` (queueable).
- **User actions** — toggle.
- **Loading** — optimistic; flips instantly.
- **Empty** — —.
- **Error** — failed sync → rebases on refetch; non-blocking (§7).
- **Disabled** — —.
- **Mobile** — filled/empty heart; persists across lists (§6.1).

### 9.16 `OwnershipBadge`
- **Description** — personal vs family list marker (§4.1).
- **Inputs** — `ownerType`, optional `familyName`.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — —.
- **Empty** — —.
- **Error** — —.
- **Disabled** — —.
- **Mobile** — small label/icon on `ListCard` and list header.

### 9.17 `AttributionChip`
- **Description** — "added by …" on family list items (§4.4).
- **Inputs** — `addedByUserId` → display name; shown only on family lists.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — name may resolve from cached members; placeholder until then.
- **Empty** — absent on personal lists.
- **Error** — unresolved name → fall back to a neutral label, never blank-implying-self.
- **Disabled** — —.
- **Mobile** — compact, on shopping-mode family rows (§4.4).

### 9.18 `ModeToggle`
- **Description** — planning↔shopping switch, per list (§1.5, 07 §7.3).
- **Inputs** — `mode`, `listId`.
- **Outputs** — mode-change (Zustand only; no server call).
- **User actions** — toggle; **always manual** (§1.5).
- **Loading** — — (pure client state, instant, offline).
- **Empty** — —.
- **Error** — — (no network).
- **Disabled** — —.
- **Mobile** — obvious, reachable toggle on the list surface; may *suggest* shopping but never auto-switch (§1.5).

### 9.19 `SyncStatusIndicator`
- **Description** — offline / sync-pending / sync-failed, all distinct, all non-blocking (§7).
- **Inputs** — `state`, `pendingCount`, `lastSyncAt`.
- **Outputs** — optional retry trigger (queue owns backoff, 07 §5).
- **User actions** — none required; dismiss/retry on a failed item.
- **Loading** — `sync-pending` *is* the in-flight state ("syncing… / N pending").
- **Empty** — `synced` → quiet "updated X ago" only.
- **Error** — `sync-failed` → non-blocking notice for **that** change; queue not wedged, other edits unaffected (§7).
- **Disabled** — — (never blocks).
- **Mobile** — `banner` for offline (persistent, unobtrusive); `inline-cue`/`Toast` for pending/failed. **No conflict UI** (§7.6).

### 9.20 `MatchingInProgressState`
- **Description** — the `category_id: null` normal state (§2.4, §5.6).
- **Inputs** — `context`.
- **Outputs** — none.
- **User actions** — none here; the underlying row stays usable (§2.4).
- **Loading** — **not** a spinner — an explicit "matching in progress" message (§2.4).
- **Empty** — `detail`: the message + empty candidate list (not "no results"). `comparison`: listed, labelled, separated from not-available, excluded from totals (§5.6).
- **Error** — — (this is explicitly not an error state).
- **Disabled** — comparison expansion has nothing to expand.
- **Mobile** — clear inline label; never a dead-end.

### 9.21 `ListCard`
- **Description** — one list in the overview (§4.1, §4.6).
- **Inputs** — `list` (06 §6.2), item count, ownership.
- **Outputs** — open-list / create-list events.
- **User actions** — open; create (empty-state CTA).
- **Loading** — `SkeletonLoader shape="card"`.
- **Empty** — no lists → `EmptyState` with create CTA; solo user sees no family clutter (§4.6).
- **Error** — list fetch fails → retry; cached lists still openable offline.
- **Disabled** — —.
- **Mobile** — tappable card; shows `OwnershipBadge` + "updated X ago".

### 9.22 `FamilyMemberRow`
- **Description** — one member with role + gated controls (§4.3/§4.5).
- **Inputs** — `member` (`user_id`, name, `role`), `viewerIsAdmin`, `isSelf`.
- **Outputs** — promote/demote, remove, leave events.
- **User actions** — promote/demote (admin); remove (admin); leave (self).
- **Loading** — member list skeleton.
- **Empty** — — (a family always has ≥1 member).
- **Error** — `409 last_admin` → **explain why and route to "promote a member first"** (§4.5), not a bare error.
- **Disabled** — admin-only controls gated via `RoleGatedAction` for members (§4.3).
- **Mobile** — role visible; destructive actions behind a `Modal` confirm.

### 9.23 `FamilyInviteForm`
- **Description** — invite by email only (§4.5).
- **Inputs** — `familyId`, `invited_email`, `invited_role`.
- **Outputs** — `POST …/invitations`; revoke event.
- **User actions** — submit; revoke pending (admin).
- **Loading** — submitting state on the button.
- **Empty** — no pending invites → simple "no pending invitations" (no inbox, §4.5).
- **Error** — invalid email / send failure → inline message.
- **Disabled** — **hidden or disabled for non-admins, never error-on-tap** (§4.3, via `RoleGatedAction`).
- **Mobile** — single email field; no link-share affordance (§4.5).

### 9.24 `AcceptInvitationScreen`
- **Description** — deep-link accept target; no in-app inbox (§4.5).
- **Inputs** — `token`, resolved `status`.
- **Outputs** — `POST /invitations/{token}/accept` (↻ fresh token).
- **User actions** — accept.
- **Loading** — resolving the token's status.
- **Empty** — — (always token-scoped).
- **Error** — render each: `expired` → `invitation_expired` (410); `revoked`/unknown → not-found; with a clear next step (§4.5).
- **Disabled** — accept disabled once `already_accepted` (idempotent success shown instead).
- **Mobile** — standalone screen reached from the email link; single clear primary action.

### 9.25 `RoleGatedAction`
- **Description** — wrapper enforcing visible role gating (§4.3).
- **Inputs** — `requiredRole`, `viewerRole`, `mode`, `children`.
- **Outputs** — passes child events through when permitted.
- **User actions** — child's, when permitted.
- **Loading** — inherits child.
- **Empty** — `hide` mode renders nothing for the unauthorised.
- **Error** — **never error-on-tap** — that's the whole point (§4.3).
- **Disabled** — `disable` mode shows the control inert, optionally with a reason.
- **Mobile** — consistent across every admin control.

### 9.26 `EmptyState`
- **Description** — calm, actionable empty surface (§4.6, §6, §7).
- **Inputs** — `context`, CTA.
- **Outputs** — CTA event.
- **User actions** — the context CTA.
- **Loading** — — (shown *after* load resolves to empty).
- **Empty** — this *is* the empty component.
- **Error** — distinct from error (errors get retry, not a CTA-to-create).
- **Disabled** — —.
- **Mobile** — centered, single clear CTA; never a dead-end.

### 9.27 `Toast`
- **Description** — transient non-blocking notice (§7).
- **Inputs** — `message`, `severity`, optional `action`.
- **Outputs** — dismiss / action events.
- **User actions** — dismiss; optional retry.
- **Loading** — —.
- **Empty** — —.
- **Error** — its main job: failed-sync-for-this-change (§7).
- **Disabled** — —.
- **Mobile** — bottom, thumb-reachable, auto-dismiss; never blocks the list.

### 9.28 `Modal`
- **Description** — confirm for genuinely destructive, **separated** actions (§2.5); never a match/anchor/conflict confirm (§1.2, §7.6).
- **Inputs** — `title`, `body`, confirm/cancel.
- **Outputs** — confirm / cancel events.
- **User actions** — confirm / cancel.
- **Loading** — confirming state.
- **Empty** — —.
- **Error** — action error surfaces inside the modal or as a `Toast`.
- **Disabled** — confirm disabled until valid.
- **Mobile** — focused sheet; "remove from list" and "archive/delete" are **distinct** confirmations (§2.5).

### 9.29 `SkeletonLoader`
- **Description** — placeholder for server-derived reads (§2.2, §5).
- **Inputs** — `shape`, `count`.
- **Outputs** — none.
- **User actions** — none.
- **Loading** — this *is* the loading component.
- **Empty** — on resolve, hands off to `EmptyState` / `MatchingInProgressState` / data.
- **Error** — on failure, hands off to the surface's error view (never spins forever, §2.4).
- **Disabled** — —.
- **Mobile** — shape matches the real content's footprint to avoid layout shift.

-----

### Open for design

These are **presentation-level** choices §§1–7 leave to the designer's craft (not product
behaviour, and not new behaviour). Flagged so they aren't mistaken for omissions:

- **Promo countdown granularity** — `valid_to` exists on candidates (06 §6.3); whether to render
  any expiry cue (and how) is unspecified at rule level. §5.4 only fixes that promo is a *flag*,
  not a surface. No behaviour to invent — purely visual.
- **`basis` representative-vs-anchored cue** — §5.5 requires the distinction be surfaced
  "however lightly"; the exact affordance is a visual call.
- **"updated X ago" recency formatting** — the rule fixes the *signal* (§7, §4.4); the time
  formatting/threshold for "X ago" is presentational.

No component required behaviour absent from §§1–7, so nothing is blocked. There is deliberately
**no** conflict/merge component, **no** barcode-scanner UI, **no** purchase-history screen, **no**
pending-invitations inbox, and **no** notification component — each excluded by an explicit rule
(§7.6, D §1, §6.4, §4.5).

-----

## Decision Required

**None open.** Both items first raised here are now **resolved** (owner-approved; canon:
`decisions.md §14`). Kept below for traceability.

### D-1 — Anchored brand chip label · RESOLVED

Was: MVP stores only `brand_normalized` (no `brands` display-name lookup until Stage 2 —
02 §13, `04` §7.2), so the chip had no display name.

**Resolved:** the chip shows the **`brand_normalized` token, title-cased client-side at
render** (Cyrillic-aware) — **the brand only**, no offer name; the token stays the cross-store
match key. No new schema, no lookup. Stage 2 swaps the text source to the `brands` display name
with **no UX change**; an optional ≤5–10-brand client-side exception map covers typography edge
cases and retires at Stage 2. The “Anchor” action is offered only for a candidate that carries a
brand token. Applied in **§3.4**.

### D-2 — Sole-admin hand-off / member self-leave · RESOLVED

Was: `02 §5` keeps ≥1 admin and `06` enforced `409 last_admin`, but `06` had **no
promote-to-admin and no self-leave endpoint** — a sole admin was stuck and members could not
leave.

**Resolved** with **two additive `06` routes** (reusing existing codes, no `v2`):

- **`PATCH /families/{id}/members/{userId}`** (admin) — role change `admin↔member`; demoting the
  last admin → `409 last_admin`. The admin hand-off control.
- **`DELETE /families/{id}/members/{userId}`** — widened to **admin-or-self**; last admin can’t
  leave while members remain (`409 last_admin` → promote first); a **solo** member leaving
  deletes the empty family server-side. **↻ fresh token** for a self-leaver.

Applied in **§4.3 / §4.5** here and **06 §6.6 (+ §4.2/§4.3)**. One minor item stays open in
`decisions.md §14`: an explicit multi-member `DELETE /families/{id}` dissolve.

-----

## decisions.md fold-back

Paste-ready **new** screen-level UX decisions made in this document (mirrors the `- [x]` style of
`decisions.md §14`). These are presentational resolutions that re-decide no product behaviour.

- [x] **Comparison: not-yet-categorized (“matching in progress”) items are listed but
  **excluded** from per-store totals and the cheapest-store calculation, and are shown
  distinctly from “not available.”** Only categorized-but-absent offers count toward a store’s
  `missing_items`. Keeps the where-to-shop decision trustworthy for brand-new terms. (10 §5.6)
- [x] **Cheapest-store ranking always shows each store’s `missing_items` count beside its
  total.** A store total is never presented as “cheapest” without its missing-items count
  visible, so coverage gaps can’t be misread as price wins. (10 §5.1)
- [x] **The Add/Search surface searches only the owner’s own terms** (plus favorites / recent /
  frequent quick-add and category/promotion browse) — **no global product-catalog picker.** A
  new term creates a new UserProduct. (10 §2.6, §6.2)
- [x] **Inbound family invitations are accepted via the emailed token deep-link; there is no
  in-app “pending invitations” inbox in MVP.** (10 §4.5)
- [x] **No standalone purchase-history screen in MVP** — the `purchase_log` surfaces to users
  only as recently / frequently bought. (10 §6.4)
- [x] **Owner-context rule for surfaced metadata:** the favorites / recent / frequent shown while
  adding to a list are scoped to **that list’s owner** (family vs user), not to the logged-in
  user globally. (10 §4.2)
- [x] **D-1 — Anchored brand chip = the `brand_normalized` token, title-cased client-side**
  (Cyrillic-aware), brand only; no schema, no lookup; Stage-2 `brands` name swaps in with no UX
  change; “Anchor” offered only for a candidate carrying a brand token. (10 §3.4)
- [x] **D-2 — Family membership lifecycle:** two additive `06` routes —
  `PATCH …/members/{userId}` (admin role change, not ↻ fresh token) and an admin-or-self
  `DELETE …/members/{userId}` (member self-leave; solo-leave deletes the empty family);
  last admin must hand off first; reuses existing codes, no `v2`. (10 §4.3/§4.5, 06 §6.6)

> **All Decision Required items are now closed** (D-1, D-2 — owner-approved, folded into
> `decisions.md §14`). One **minor** item stays open in `decisions.md §14` and is **not** owned
> by this document: an explicit multi-member `DELETE /families/{id}` dissolve (a `06` contract
> call, not a screen).

-----

*Last updated: June 2026 · Session 6 of 6 (Opus 4.8) · canonical for **screen-state and
component-level UX**. Built on the **demand-first** canon — broad-by-default, match-by-selection
(no yes/no dialog), opt-in brand anchoring, owner-level favorites + purchase-log metadata,
offline-first lists with last-write-wins (no conflict UI). `07` stays canonical for client
architecture and the two-mode mechanics; `06` for wire shapes; `02` for meaning; `00`/`D` for
scope. §§8–9 (component inventory & specs) are stubbed for the next session. Table prefix
not referenced (this document is presentation-level).*

*Amended — June 2026 · **D-1 and D-2 closed** (owner-approved). **D-1:** anchored brand chip =
title-cased `brand_normalized` token (brand only; §3.4). **D-2:** family membership lifecycle —
member self-leave + admin role-change hand-off + solo-leave family delete (§4.3/§4.5), backed by
two additive `06` routes (06 §6.6). Decision Required section now carries no open items; one
minor `06` item (multi-member family dissolve) tracked in `decisions.md §14`.*