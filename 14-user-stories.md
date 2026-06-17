# 14 — User Stories

> **Load when:** writing or reviewing acceptance criteria for a build ticket; checking that a
> Slice's `ACCEPTANCE CRITERIA` actually serves a real user need; onboarding someone to *why* a
> screen exists, not just what it does.
> **Depends on:** `decisions.md` (canon) · `11-user-flows.md` (PRIMARY — every story here is the
> "so that" restatement of an already-traced flow) · `10-ux-rules.md` (the behaviour each story's
> acceptance criteria points back to).
> **Standalone for:** the **"as a user, I want, so that"** layer — the *motivation* behind each
> flow in `11`, grouped by feature, in a format a Slice's acceptance criteria can quote directly.
> It invents no behaviour `10`/`11` don't already define. Where a story would need behaviour that
> doesn't exist yet, it is marked **GAP** instead of inventing one.

-----

## 0. Purpose & boundary

`11-user-flows.md` already traces the thirteen MVP flows step-by-step (action → component →
endpoint → rule). This document does **not** repeat those steps. It restates each flow as the
**user story** behind it — who, what, why — so that:

- a Slice's acceptance criteria can be written against a story instead of a vague feature name;
- a reviewer can ask "does this still serve the story?" instead of just "does this match the
  mock?";
- gaps in the canon (a story with no flow to satisfy it) are surfaced explicitly, not silently
  assumed.

Every story below cites the `11-user-flows.md` flow(s) and `10-ux-rules.md` rule(s) it is built
on. **A story with no citation is a GAP** — flagged in §8, never invented.

-----

## 1. Lists — create, open, edit, delete

### US-1.1 — Create a personal list
**As** a solo user, **I want** to start a new shopping list in one tap, **so that** I can begin
adding items immediately, even before I'm sure what I need.
- Flow: `11` Flow 2. Rules: `10 §4.1`, `§8.21`.
- Acceptance: tapping the create affordance and entering a name produces a list row **immediately**
  (optimistic, keyed by `client_uuid`), openable at once in planning mode, even offline.

### US-1.2 — Create a family list
**As** a family member, **I want** to create a list that every family member can see and edit,
**so that** household shopping doesn't depend on one person's phone.
- Flow: `11` Flow 2 (family variant), Flow 9d. Rules: `10 §4.1`.
- Acceptance: choosing `owner_type: family` requires membership (`403 not_a_member` otherwise);
  the family option only appears once the user belongs to ≥1 family.

### US-1.3 — See all my lists at a glance
**As** a user with both personal and shared lists, **I want** one overview showing every list I
can see, **so that** I don't have to remember which list has what.
- Flow: `11` Flow 1 step 5, Flow 9d. Rules: `10 §8.21`, `§4.6`.
- Acceptance: Lists overview shows personal + every family list, each with an ownership cue and
  item count; empty state offers a clear create CTA, no clutter for a solo user.

### US-1.4 — Rename or delete an entire list — **GAP, see §8.1**
**As** a user who created a list by mistake or no longer needs it, **I want** to rename or delete
the whole list, **so that** my Lists overview stays accurate and uncluttered.
- **No flow, no endpoint, and no UI satisfies this today.** `06-api-auth.md` defines `GET/POST
  /lists` and `GET /lists/{id}` but **no `PATCH` or `DELETE` on `/lists/{id}` itself** — only on
  individual items (`06` lines 241–298). This is a real product gap, not a documentation
  omission. See §8.1 for the flag and recommended next step.

-----

## 2. Items on a list — add, quantity, remove, archive

### US-2.1 — Add an item by typing its name
**As** a user planning a shop, **I want** to type the name of something I need and have it appear
on the list instantly, **so that** I never lose a thought waiting for a network round-trip.
- Flow: `11` Flow 3, Flow 11. Rules: `10 §2.1`, `§8.12`.
- Acceptance: typing a new term and confirming adds a row **instantly** (optimistic), works
  offline, and never presents a global product catalog to pick from — the term *is* the
  UserProduct.

### US-2.2 — Reuse a term I've used before
**As** a returning user, **I want** my own past terms to autocomplete as I type, **so that** I
don't re-type "мляко" every week and don't end up with two different rows for the same thing.
- Flow: `11` Flow 3 (existing-term branch), Flow 11. Rules: `10 §2.6`, `§6.2`.
- Acceptance: matches are drawn from **my own terms only**; picking one reuses
  `user_product_id`, never creating a duplicate.

### US-2.3 — Set and change how much I need
**As** a user adding "yogurt," **I want** to set a quantity and unit, and change it later if my
needs change, **so that** the list reflects exactly what I'm buying.
- Flow: `11` Flow 3 (edit-quantity branch). Rules: `10 §2.1`, `§8.14` (`QuantityStepper`).
- Acceptance: quantity/unit is editable both at add time and **after** the item is already on the
  list, via the same stepper control everywhere it appears (list row compact, Product Detail
  full) — see **§8.2 GAP**: today, quantity can only be set once, at add time; there is no
  affordance to change it afterward.

### US-2.4 — Remove an item from this list (without losing its history)
**As** a user who decided not to buy something this week, **I want** to remove it from *this*
list without erasing the fact that I've ever bought it, **so that** my favorites and "frequently
bought" stay accurate.
- Flow: `11` Flow 3 (remove-vs-archive branch). Rules: `10 §2.5`.
- Acceptance: "remove from list" (`DELETE …/items/{id}`) never deletes the underlying term or its
  purchase history; it must never read as "delete forever."

### US-2.5 — Retire a term I'll never buy again
**As** a user who's stopped buying a product permanently, **I want** to archive its term, **so
that** it stops cluttering my Add/Search suggestions while keeping my purchase history intact for
already-checked-off purchases.
- Flow: `11` Flow 3 (archive branch). Rules: `10 §2.5`.
- Acceptance: archiving is a **separate, explicitly distinct** action from removing a list line,
  confirmed via a destructive `Modal`, never conflated in copy or placement with "remove."

-----

## 3. Browsing & matching — candidates, brand anchor

### US-3.1 — See every store's offer for one term
**As** a price-conscious shopper, **I want** to see every store's version of "yogurt" in one
place, **so that** I can judge for myself which is the best fit, without the app guessing for me.
- Flow: `11` Flow 4. Rules: `10 §1.1`, `§2.2`, `§8.3`.
- Acceptance: candidates load broad by default, across all stores, with promo markers; there is
  never a "is this the same product?" confirmation dialog.

### US-3.2 — Stick to a brand I trust
**As** a user loyal to one yogurt brand, **I want** to tell the app to only show me that brand
going forward, **so that** I stop having to re-pick it every week.
- Flow: `11` Flow 5. Rules: `10 §3.2`, `§8.4`/`§8.5`.
- Acceptance: picking a candidate's brand *is* the anchor action (no separate confirmation); a
  brand chip appears everywhere the term does and is itself the one-tap "go back to broad" control.

-----

## 4. Comparison

### US-4.1 — Know where to shop before I leave the house
**As** a planner, **I want** to see which store is cheapest for my whole basket before I go, **so
that** I don't end up paying more than I had to.
- Flow: `11` Flow 6. Rules: `10 §5.1`.
- Acceptance: a per-store total is **never** shown as "cheapest" without its missing-items count
  next to it — a store can look cheap only because it lacks half the basket.

### US-4.2 — Trust the total even with a brand-new item on my list
**As** a user who just added something the crawler hasn't categorized yet, **I want** that item to
not silently distort which store looks cheapest, **so that** my decision is still trustworthy.
- Flow: `11` Flow 6 (matching-in-progress branch). Rules: `10 §5.6`.
- Acceptance: an uncategorized item is listed and labelled "matching in progress," visually
  separate from "not available," and **excluded** from per-store totals and the cheapest-store
  calculation.

-----

## 5. Shopping (in-store)

### US-5.1 — Shop with a calm, large-target checklist
**As** a shopper standing in an aisle, **I want** a big, simple checklist with no prices
competing for my attention, **so that** I can move fast and not get distracted mid-aisle.
- Flow: `11` Flow 7. Rules: `10 §1.5` (Calm in store), `§8.1` shopping variant.
- Acceptance: shopping mode shows large check targets, no price, not expandable; the mode never
  switches automatically — only the user's manual toggle changes it.

### US-5.2 — Check things off without worrying about signal
**As** a shopper in a store with bad reception, **I want** checking an item off to work instantly
regardless of connectivity, **so that** a dead spot in the store never blocks me.
- Flow: `11` Flow 7. Rules: `10 §1.3`, `§7`.
- Acceptance: `is_checked` flips instantly from local state and queues; a sync failure for one
  check never blocks any other check.

### US-5.3 — See who on my family added or is buying what
**As** a member of a household sharing a list, **I want** to see who added each item, **so that**
shopping together feels like collaboration, not guessing.
- Flow: `11` Flow 7, Flow 9d. Rules: `10 §4.4`, `§8.17` (`AttributionChip`).
- Acceptance: every item on a **family** list shows `added_by`; personal lists show no
  attribution chip at all.

-----

## 6. Favorites & fast re-add

### US-6.1 — Mark staples so they're always one tap away
**As** a user who buys bread every week, **I want** to favorite it once, **so that** I never have
to type "bread" again.
- Flow: `11` Flow 10. Rules: `10 §6.1`, `§8.15` (`FavoriteToggle`).
- Acceptance: the heart toggle lives on the **term**, appears wherever the term appears, and
  persists across every list it's added to.

### US-6.2 — Get smart suggestions instead of typing from scratch
**As** a returning user opening Add/Search, **I want** to see what I bought recently and what I
buy often, **so that** restocking the household is mostly tapping, not typing.
- Flow: `11` Flow 10. Rules: `10 §6.2`, `§8.13` (`QuickAddSection`).
- Acceptance: favorites / recently-bought / frequently-bought are three **distinct**, non-deduped
  sections; the frequent count is whatever the server returns, never a hardcoded number.

### US-6.3 — Have the right suggestions for the right list
**As** a member of both a personal life and a family, **I want** my quick-add suggestions to match
*whose* list I'm adding to, **so that** I don't see my personal snack favorites while shopping for
the family.
- Flow: `11` Flow 10 (owner-context). Rules: `10 §4.2`.
- Acceptance: favorites/recent/frequent shown while adding to a list are scoped to **that list's
  owner** (the family if family-owned, the individual otherwise) — never the logged-in user
  globally.

-----

## 7. Family sharing

### US-7.1 — Turn my personal lists into a shared household list
**As** a solo user moving in with family, **I want** to create a family and invite them, **so
that** we stop texting each other shopping lists.
- Flow: `11` Flow 9a/9b. Rules: `10 §4.1`, `§4.5`.

### US-7.2 — Accept an invite without hunting for it
**As** an invitee, **I want** to tap a link in my email and land directly in the family, **so
that** joining takes one tap, not a search through app menus.
- Flow: `11` Flow 9c. Rules: `10 §4.5`, `§8.24`.
- Acceptance: the accept screen renders all four token states (`pending`, `expired`,
  `already_accepted`, `revoked`/unknown) with a clear next step for each.

### US-7.3 — Leave a family without breaking it for everyone else
**As** a family member moving out, **I want** to leave on my own, **so that** I don't have to ask
an admin to remove me — but if I'm the only admin, **I want** to be told clearly why I can't just
leave, and what to do instead.
- Flow: `11` Flow 9e. Rules: `10 §4.5` (D-2).
- Acceptance: any member can self-leave; a sole admin attempting to leave while others remain gets
  `409 last_admin` explained in-UI with a "promote someone first" route, never a bare error.

-----

## 8. Open gaps (flagged, not invented)

These are stories a real user would expect, with **no flow or endpoint in the canon to satisfy
them today**. Per this document set's own rule (`10`/`11`'s "Open for design" / "Decision
Required" convention), they are flagged here rather than silently designed around.

### 8.1 — No way to rename or delete a whole list
US-1.4 above. `06-api-auth.md` has no `PATCH`/`DELETE /lists/{id}`. Today the only way to "remove"
a list is to remove every item from it one at a time, which is not the same thing and leaves an
empty list sitting in the overview forever. **Recommendation:** raise this in `decisions.md §14`
as an open question before scheduling a Slice for it — it needs a product decision on cascade
behaviour (does deleting a family list need admin-only gating, like other destructive family
actions in `10 §4.3`?) before it can be specified at flow level.

### 8.2 — No way to edit an item's quantity after it's added
US-2.3 above. `10 §8.14` defines `QuantityStepper` with a `compact` (list row) and `full` (Product
Detail) variant, and `06 §6.2` already supports `PATCH …/items/{id}` for quantity/unit — the
**contract exists**, but no flow in `11` traces a path to it from an already-added row, and (per
the implementation audit accompanying this document) no UI control currently calls it. This is
closer to an implementation gap than a canon gap — see the accompanying Slice
(`slices/13-2.2d-ui-consistency-cleanup.md`) for the concrete fix, and `13-implementation-line.md`
§4.1/§4.2 (Product Detail) for where the `full` variant lands.

-----

*Last updated: June 2026. Restates `11-user-flows.md`'s thirteen flows as user stories, grouped by
feature. Introduces no new product behaviour; flags two genuine gaps (§8) for `decisions.md §14`
rather than inventing resolutions.*
