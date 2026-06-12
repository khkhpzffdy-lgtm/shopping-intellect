# 02 — Domain Model

> **Load when:** modelling a new feature; deciding which context owns a concept;
> resolving where a field or rule belongs; reviewing a PR that crosses two contexts.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton).
> **Standalone for:** bounded contexts, entities, value objects, invariants, the
> relationships between them, and which entities cross context boundaries. For physical
> tables/indexes → `04` · crawler parsing internals → `05` · endpoint shapes → `06`.

-----

## 1. Purpose

This document fixes the **vocabulary and the boundaries**: what concepts exist, which
context owns each, the invariants that must always hold, and how concepts reference one
another. It is deliberately **storage-free** — no columns, no indexes, no SQL. Those are
`04`’s job. When this document and `04` seem to overlap, this one is canonical for
*meaning* and `04` is canonical for *representation*.

Conventions already fixed in arch. §8 (UTC storage, `Europe/Sofia` business calendar,
the Thu→Wed promo week, `BIGINT` server IDs, `client_uuid` for offline-born entities,
`normalized_name`) are assumed here, not restated.

**Demand-first model (D §1/§4/§9/§10).** The catalog is no longer one canonical product
table. It is built from **real user demand** and matched against the offers we already
crawl — *crawl broadly, normalize narrowly*. Three product layers replace the old single
canonical `Product`: **UserProduct** (the user’s own term) → **CategoryBucket** (a
neutral normalized concept, *not* a brand) → **StoreProduct / StoreOffer** (a concrete
chain offer). The user sees the **broad** bucket by default and may **opt in** to anchor
a term to a specific brand. This shift moves human judgment from an admin queue to the
end user’s eyes (D §4) and reshapes the Catalog and Shopping List contexts below.

-----

## 2. Bounded contexts at a glance

Seven contexts, matching the service seams in arch. §5. The split follows *rate of
change* and *ownership*, not table count — Crawling churns when chains change their
sites; Catalog identity improves on its own schedule; Pricing is append-mostly truth.

|Context                 |Owns (the answer to…)                         |Core entities                                           |Changes when…                           |
|------------------------|----------------------------------------------|--------------------------------------------------------|----------------------------------------|
|**Identity / Auth**     |Who is this person, and may they act?         |User, Credential, AuthSession                           |Auth providers / token policy change    |
|**Family**              |Who shares with whom, and in what role?       |Family, FamilyMembership, FamilyInvitation              |Sharing rules evolve (Stage 2)          |
|**Shopping List**       |What does this household intend to buy?       |ShoppingList, ListItem, UserProduct, PurchaseLogEntry   |List UX / offline-sync / metadata change|
|**Catalog**             |Which bucket does *this offer* belong in?     |CategoryBucket, StoreProduct, StoreOffer, Store, Barcode|Categorization improves / buckets grow  |
|**Pricing / Promotions**|What does this cost, where, and until when?   |PriceEntry, Promotion (+ `Money`, validity)             |New crawl publishes; promo week rotates |
|**Crawling / Ingestion**|What did we just fetch, and is it trustworthy?|CrawlRun, RawOffer (+ data-quality)                     |Chain sites change; rules tighten       |
|**Price Comparison**    |Where is this basket cheapest right now?      |BasketComparison (derived, non-persistent)              |Comparison policy changes               |

The boundaries are conceptual; in Stage 1 they are PHP service classes in one plugin,
not deployables. The point is that each context can be reasoned about — and later
extracted — without dragging the others along.

-----

## 3. Cross-cutting value objects

These are owned by no single context; they are the shared currency between them. All
are immutable plain-PHP `Models/` (arch. §5), constructed valid or not at all.

### `Money` (arch. §8 — canonical)

Integer **euro cents** + a `currency` code that is constant `EUR` in Stage 1. Never a
float. Arithmetic (sum a basket, apply a promo price) lives on the object. BGN figures
met during the 2026 dual-display period are converted **at construction** at the fixed
**1.95583 BGN/EUR**, rounded half-up to the cent; the source offer is flagged
`converted_from_bgn` for audit. Comparison, totalling and formatting all route through
`Money` so rounding happens once, predictably.

### `Validity` (a `valid_from` / `valid_to` pair)

A half-open UTC interval expressing “when is this price/promo in force.” “Current” is
**derived** by asking a `Validity` whether it contains *now* (Sofia-resolved) — never a
boolean flag someone forgets to flip (arch. §8). A promo week is just the `Validity`
Thu 00:00 → Wed 23:59 Sofia.

### `Quantity`

An amount + unit (`g`, `kg`, `l`, `ml`, `bucket`, `piece`…). Used by `ListItem`
(how much the user wants) and inside categorization (normalising “400 г” vs “0.4
кг” when fitting a `StoreOffer` to a bucket). Unit normalisation rules belong to Catalog
(§7); the value object just carries the pair immutably.

### `RawOffer` (Crawling’s output contract — arch. §5 rule 3)

The normalized DTO a crawler emits per parsed offer: raw product name (Bulgarian, as
crawled), extracted `Quantity`, a `Money` price, store reference, `source_url`, a source
content hash, and the `converted_from_bgn` flag. It is **not** a persisted domain
entity in its own right at emission time — it is the hand-off across the
Crawling→Ingestion seam. (It *is* staged to a table for audit/re-categorization; that
staged form is `04`’s concern. Its lifecycle is §10.)

### `DataQualityScore`

A small computed value (the outcome of D §4’s rule-based validation: reject / ceiling /

> 50 % deviation flag) attached to a `PriceEntry` and to the staged `RawOffer`. It is
> advisory metadata, never a gate that hides data — staleness and doubt are surfaced in
> UI, not suppressed (D §4, arch. §12).

-----

## 4. Identity / Auth context

Answers *who is this and may they act*. Thin by deliberate design: Stage 1 reuses
`wp_users` behind `AuthProvider` / `UserRepository` (arch. §3, §8), so this context owns
the **concept** of a user while WordPress owns the **storage** — the seam that makes a
Stage-2/3 standalone auth service an export, not a migration.

**User** — a person with an account. Identity anchor referenced by every other context
via `user_id`. App users carry the zero-capability `si_user` role and have no wp-admin
reach (arch. §3). Invariant: a `User` is uniquely identified by email within the app;
the same person never holds two app accounts.

**Credential** — *how* a user proves identity, abstracted over provider:
email/password (verified against `wp_users` hashing) or Google (verified token →
find-or-create). The domain rule: **the rest of the system cannot tell providers apart**
— both paths terminate in the identical JWT + refresh pair (D §8, arch. §6.1). A `User`
may have more than one `Credential` (email *and* Google) resolving to the same identity.

**AuthSession** — the refresh-token lifecycle: a rotating refresh token (httpOnly
cookie) and the short ~15-min access JWT minted from it. The **JWT claim set is the
contract** (`user_id`, `family_ids[]`, `roles[]`) — arch. §7. Invariant: claims are a
*snapshot*; membership changes propagate at next refresh (≤15 min), and family-mutating
endpoints return a fresh token to shortcut the staleness (arch. §6.1).

-----

## 5. Family context

Answers *who shares with whom, in what role*. Owns the group concept that Shopping List
leans on for shared ownership — including the **owner** of UserProducts and the
purchase log (§6).

**Family** — a named sharing group; the unit a shared `ShoppingList` (and the
owner-level product metadata in §6) can belong to. Created by a `User` who becomes its
first admin.

**FamilyMembership** — the join of `User` ↔ `Family` plus a `role` (`admin` | `member`).
Invariants: a family always has **at least one admin** (the last admin cannot simply
leave without promotion/transfer); a user’s membership is unique per family. Roles gate
mutation — e.g. removing members or deleting the family is admin-only.

**FamilyInvitation** — a pending offer to join, keyed by an email + opaque token with an
expiry and a `status` (`pending` | `accepted` | `expired` | `revoked`). Lifecycle:
*pending → accepted* (creates a `FamilyMembership`) | *→ expired* (past `expires_at`) |
*→ revoked* (admin cancels). Invariant: accepting is idempotent and one-shot — a
consumed or expired token creates nothing. **No link-sharing with non-family users in
MVP** (D §9) — invitations are the only entry path.

`family_ids[]` in the JWT (Identity §4) is a denormalised projection of this context’s
memberships — the deliberate per-request DB-avoidance of arch. §6.1.

-----

## 6. Shopping List context

Answers *what does this household intend to buy*. The most write-heavy, most
offline-exposed context — its rules are shaped by the offline-first decision (D §7,
arch. §6.5). Under the demand-first model it also owns the **UserProduct** (the first
catalog layer) and the **purchase log** that drives owner-level metadata (D §4, D §9).

**UserProduct** — the user’s **own term** for a thing (“мляко”, “яйца”, “прах Ariel”) —
the first demand-first layer (D §4). Born the moment a term is first written into a
list, and owned **polymorphically** by the list owner (a `User` *or* a `Family`, same
rule as `ShoppingList`). It carries the term as typed, a `normalized_term`, an `is_favorite`
flag, and two attachments into Catalog: a default link to a **CategoryBucket** (the broad
concept it maps to, nullable until categorized) and an optional **brand anchor** (set only
if the user opts in to a specific brand — §7). Invariant: a UserProduct is unique per
(owner, `normalized_term`), so re-entering the same term reuses the existing one and its
favorite/history persist. Owner-scoping is deliberate: a messy personal term list never
pollutes the shared Catalog (D §12). *How* a term is normalized is **resolved** (D §14,
`04` §7.1): a deterministic dedup-key normalizer — NFC + lowercase + trim +
whitespace-collapse + punctuation-strip, with **no stemming on the key** (any light
stemming feeds categorization only, never the unique).

**ShoppingList** — a named collection of intended purchases with a **polymorphic owner**:
it belongs to *either* a `User` *or* a `Family` (`owner_type` = user | family), never
both. Invariant: a family-owned list is visible to **all** current members of that
family (Family §5); ownership is fixed at creation in MVP (no transfer flow).

**ListItem** — one line: a reference to a **`UserProduct`** (the demand-first change —
*not* a canonical product and *not* a free-text string), a desired `Quantity`, an
`is_checked` flag, and `added_by_user_id` (attribution within a shared list).
Offline-born items — and the UserProducts they create at write time — carry a
**`client_uuid`** so replays from the background-sync queue are **idempotent** and
offline-created entities merge without ID collisions (arch. §6.5, §8). Invariants: an
item references a `UserProduct`, which is what keeps comparison meaningful (free text
would defeat it; a *bare* canonical product would defeat broad-by-default); **last-write-
wins on server `updated_at`** is the conflict rule, surfaced as “updated X sec ago” — no
real-time sync, no merge-conflict UX in MVP (D §9).

**PurchaseLogEntry** — an **append-only** record of one “checked / bought” event
(D §9): the owner, the `UserProduct`, and a `purchased_at` timestamp; plus a reference to
the chosen `StoreProduct`/offer and its price — snapshot columns **defined now, populated
lazily** (D §14, `04` §7.3). It is **separate from** `is_checked` (the in-list checked
state) precisely so it survives list edits and item deletion. It is the *only* substrate
for the owner-level metadata below.

### Owner-level product metadata (D §9)

All of these live at the **owner** level — the family if the owner is a family, otherwise
the individual — following the same polymorphic-owner rule as lists and UserProducts:

- **Favorite** — the `is_favorite` flag on a `UserProduct`.
- **Recently bought** — derived: the most recent `purchased_at` per `UserProduct`.
- **Frequently bought** — derived: a count of `PurchaseLogEntry` per `UserProduct`. The
  window and threshold are **resolved** (D §14, `04` §7.5): a rolling **8-week** window
  with a **≥ 3-buys** threshold, both operator-tunable with no migration.

A `UserProduct` (via its CategoryBucket attachment) is the seam where Shopping List meets
Catalog: the list owns the *term* and its bucket/brand attachment, and owns nothing about
any store’s prices.

-----

## 7. Catalog context

Answers the demand-first question — *which bucket does this offer belong in* — and holds
the shared, canonical product layers (D §4, arch. §5 rule 5). The old single canonical
`Product` is gone: identity is now expressed as **product-to-category**, which is
markedly easier than deduplicating “this exact Lidl milk == that exact Kaufland milk.”
Catalog owns the shared layers (CategoryBucket, StoreProduct/StoreOffer); the
**UserProduct** layer lives in Shopping List (§6) because it is owner-scoped.

**CategoryBucket** — a **neutral, normalized concept** (“milk”, “eggs”, “bread”), *not* a
brand — the second demand-first layer (D §4). It is what a `UserProduct` attaches to by
default and what a `BasketComparison` is computed over. Buckets fill **lazily**: ~20–30
popular categories *may* be admin-seeded up front so day-one demand lands somewhere
sensible, and everything beyond that is created **on demand** — when a user term or a
crawl needs a bucket that doesn’t yet exist (D §4). This replaces the earlier
“pre-seed ~200 individual staples” plan: a handful of *buckets*, not a long list of
*products*. Invariant: a bucket is the categorization *target* — many `StoreOffer`s
resolve into one bucket. Admin **merge/split** of buckets survives only as catalog
hygiene (de-duping two “milk” buckets), *not* a per-offer review step (D §4).

**StoreProduct** — the same goods **as listed by one specific store** (the chain’s own
naming/listing). It belongs to exactly one `Store` and is the thing a `StoreOffer`
prices. It may be **temporarily uncategorized** (awaiting categorization) without breaking
anything — uncategorized store products simply don’t yet appear in any bucket and don’t
participate in comparison.

**StoreOffer** — a concrete **offer or promotion** for a `StoreProduct` from one chain —
the third demand-first layer (D §4). It is what gets categorized into a `CategoryBucket`
and what a user *sees and chooses among* (§ user matching below). Post-MVP, a `StoreOffer`
may additionally be **enriched from receipts** (a future paid-price source, D §4) — the
layer is shaped to accept that, but it is **not built in MVP**.

**Store** — a grocery chain presence (Lidl, Kaufland, Billa, Fantastico — D §3). In MVP,
Sofia-scoped (D §2); the regional-pricing-per-location dimension is a Stage-2 additive
extension, not modelled now.

**Barcode** — an optional strong signal on a `StoreProduct`, powering **Phase 2**
categorization (D §4). Where present it sharpens which bucket an offer lands in; absence
is normal and not an error.

### Matching — two halves, neither a confirmation dialog (D §4)

Matching changes shape under the demand-first model and splits cleanly in two:

**(a) Categorization — the *system’s* job: `StoreOffer` → `CategoryBucket`.** This is
*product-to-category*, not product-to-product identity. It is a *behaviour* of this
context (the `CategorizationService`/`MatchingService`, arch. §5 rule 5), not an entity,
and runs in phases: fuzzy name (Phase 1, normalized name + weight/volume) → barcode
(Phase 2) → ML-assisted (Phase 3, Stage 3). It is **lenient on purpose**: a debatable
offer landing in a roughly-right bucket costs nothing, because the user sees every
candidate and judges by eye — mis-categorization degrades gracefully (an odd extra
candidate) rather than corrupting a trusted identity. Key domain property unchanged:
staged raw offers can be **re-categorized offline** when the algorithm improves, without
re-crawling.

**(b) User matching — the *user’s* job: by selection, no confirmation UX.** There are
**no “is this the same product? yes/no” dialogs.** The user opens a `UserProduct`, sees
the candidate `StoreOffer`s across all stores with promos marked (§12), and
**browsing/choosing *is* the match**. Optionally they **anchor** the UserProduct to one
brand (the opt-in narrowing of D §4); otherwise it stays **broad**. How a “brand” is
represented is **resolved** (D §14, `04` §7.2): a **brand token** — `brand_normalized` on
`StoreProduct` + a `brand_anchor` on the `UserProduct`, matched across stores (a `brands`
lookup table is deferred to Stage 2).

**Representation note (`04` §7.4/§4.5).** These are *meaning*-level statements; `04` owns
how they are stored. Two physical-layout calls are flagged so this document and `04` read
as one: **(1)** the `StoreOffer → CategoryBucket` categorization link is persisted on the
**store-product identity** (`store_products.category_id`), and an offer’s bucket is
*derived* through its product — a bucket is invariant across a product’s many weekly
offers, so re-categorization touches one row, not N; **(2)** `StoreOffer` and `Promotion`
are **not** separate tables — both are `price_entries` rows (`Promotion` = `is_promo = 1`).
The *vocabulary* here (StoreOffer and Promotion as distinct concepts) is unchanged; only
the physical layout is `04`’s.

-----

## 8. Pricing / Promotions context

Answers *what does this cost, where, until when*. Append-mostly truth; the read target
of Price Comparison.

**PriceEntry** — a **published, validated** price for a `StoreProduct` over a `Validity`
interval, expressed as `Money`, carrying its `DataQualityScore` and `source_url` for
audit (D §4). This is the *only* thing comparison reads (arch. §6.2 invariant). It is
never the raw crawl — a `PriceEntry` exists only after Ingestion validates and publishes
a `RawOffer`. “Current price” = the `PriceEntry` whose `Validity` contains now.

**Promotion** — a price in force only for a bounded promo `Validity` (the Thu→Wed week,
arch. §8), flagged as promotional so the UI and comparison can mark it. Modelled as a
qualified `PriceEntry` rather than a separate pricing universe: a basket total is just a
sum of currently-valid `PriceEntry`s, some flagged promo. Invariant: a `Promotion`’s
validity cannot outlive its declared promo week; overlapping regular and promo prices
resolve to the promo while its `Validity` is current. (Physically, a Promotion is a
`price_entries` row with `is_promo = 1` — `04` §4.5; the meaning here is unchanged.)

This context owns no product identity — it prices a `StoreProduct` and trusts Catalog to
have categorized that store product’s offers into the right bucket.

-----

## 9. Crawling / Ingestion context

Answers *what did we just fetch and is it trustworthy*. Highest-churn context (chains
change their sites — arch. §5 rule 3); isolated precisely so that churn stays contained.

**CrawlRun** — the record and **source of truth for crawler health** (arch. §9): which
chain, `full` | `delta` mode (D §4), status, counts, error summary, and **resume state**
(runs are chunked + resumable so a host-side kill continues rather than restarts —
arch. §6.3). Powers the Admin dashboard and the `/health` endpoint. One run per chain per
schedule; concurrency guarded by the MySQL `GET_LOCK` named lock (arch. §6.3, §9).

**RawOffer** — introduced as a value object in §3; *within this context* it is also the
**staged, persisted** parsed offer (raw name + parsed fields + source hash +
`converted_from_bgn`), retained **8 weeks** then pruned (arch. §6.3). Two reasons it
persists: forensic audit, and **offline re-categorization** when the categorization
algorithm improves (§7). It is the explicit hand-off DTO across the **Crawling →
Ingestion** seam: crawlers emit `RawOffer[]`; **crawlers never write prices** (arch. §5
rule 3).

**Ingestion** is the behaviour that turns a `RawOffer` into truth: validate (D §4 rules)
→ categorize the resulting `StoreOffer` into a `CategoryBucket` (Catalog §7) → publish a
`PriceEntry`/`Promotion` (Pricing §8). It is the only bridge from the high-churn crawl
world into the stable pricing world. Crucially, the demand-first model means
categorization is *lenient and non-blocking*: an offer that can’t be confidently bucketed
is still validated and published as a (temporarily uncategorized) StoreProduct/offer —
it just doesn’t surface in a bucket until categorized (no admin queue gates it, D §4).

-----

## 10. RawOffer lifecycle (the spine of the data pipeline)

The single most important lifecycle in the system — it is where untrusted external data
becomes trusted, *categorized* domain truth. Each transition is owned by a different
context, which is why the boundaries are drawn where they are. The final step is
**“categorized into a bucket,”** not “matched to a canonical product identity.”

```
  (Crawling)        (Ingestion)         (Ingestion)        (Catalog)              (Pricing)
   fetched  ──────►  parsed   ──────►  validated  ──────►  categorized  ──────►  published
   raw HTML          RawOffer          + DataQuality       StoreOffer → a         PriceEntry /
   per chain         emitted/staged    score; reject /     CategoryBucket         Promotion in
   site              (8-wk retain)     ceiling / >50%       (lenient; or left      force over its
                                       deviation flag       uncategorized →        Validity
        │                                   │               awaits re-categorize)
        └─ source hash drives the           └─ rejected offers are retained, not published:
           daily delta check (arch. §6.4)      visible in Admin, never surfaced to users
```

- **parsed → validated** never silently drops data: rejects and flags are recorded
  (`DataQualityScore`), staleness is shown, doubt is transparent (D §4, arch. §12).
- **validated → categorized** is *lenient and may stall*: an offer with no confident
  bucket is held as an uncategorized `StoreProduct`/offer and re-attempted when
  categorization improves — no re-crawl, no admin approval queue (§7, D §4).
- **categorized → published** produces the `PriceEntry`; comparison reads nothing earlier
  in this chain (arch. §6.2). (Publication of the price and bucket categorization are
  distinct: a price can be published while its offer is still settling into a bucket —
  it simply isn’t basket-visible until bucketed.)

-----

## 11. Relationships & the entities that cross boundaries

```
User ──< FamilyMembership >── Family ──< FamilyInvitation
 │                              │
 │ owns (user)                  │ owns (family)        owner-scoped (user OR family)
 ▼                              ▼                       ┌───────────────────────────┐
ShoppingList ──< ListItem >──► UserProduct ────────────┤ is_favorite               │
                                  │  │                   │ PurchaseLogEntry (append) │
                  default attach  │  │ opt-in brand      └───────────────────────────┘
                                  ▼  └────► (brand anchor — a brand token; §14 / 04 §7.2)
                            CategoryBucket ◄──categorized── StoreOffer ─► StoreProduct >── Store
                                  ▲                            ▲                │
                                  │                            │                │ priced by
                                  │                  CrawlRun ──< RawOffer       ▼
                                  │                       └─(ingest)─► PriceEntry / Promotion
                                  │                                    (Money + Validity)
                                  │                                         ▲
                                  └──────── BasketComparison (derived) reads only published,
                                                                       current PriceEntry ─┘
```

**Entities that deliberately cross context boundaries** — these are the seams to guard:

|Boundary-crossing reference  |From → To                             |Why it’s the seam it is                                                                      |
|-----------------------------|--------------------------------------|---------------------------------------------------------------------------------------------|
|`user_id`                    |everywhere → Identity                 |Universal identity anchor; the JWT carries it so no per-request DB hit (arch. §6.1)          |
|`family_ids[]`               |Identity (JWT) → Family               |Denormalised projection of memberships; stale ≤15 min by design (arch. §6.1)                 |
|`owner_id` + `owner_type`    |Shopping List → User *or* Family      |Polymorphic ownership of lists, UserProducts, and the purchase log                           |
|`user_product_id`            |Shopping List (ListItem) → UserProduct|A list intends the *user’s term*, which then attaches to a bucket — keeps it broad-by-default|
|`category_id` (default)      |Shopping List (UserProduct) → Catalog |The default broad attachment: a term maps to a *bucket*, not a brand (D §4)                  |
|brand anchor (opt-in)        |Shopping List (UserProduct) → Catalog |Optional narrowing to a specific brand; a brand token (D §14 / `04` §7.2)                    |
|`StoreOffer → CategoryBucket`|Catalog (internal)                    |The categorization link; product-to-category, lenient — the trust hinge (D §4)               |
|`StoreProduct` ref           |Pricing → Catalog                     |Pricing prices a store listing; trusts Catalog to have categorized it                        |
|`RawOffer` → `PriceEntry`    |Crawling/Ingestion → Pricing          |The untrusted→trusted bridge; the only producer of published prices                          |

-----

## 12. Price Comparison context (derived, non-persistent)

Answers *where is this basket cheapest right now*. Owns **no stored entity** — it is a
pure read-and-compute over Pricing + Catalog (arch. §6.2, D §10).

**BasketComparison** — a transient result computed from a list of `UserProduct`s (each
resolving to its `CategoryBucket`, or to a brand-anchored offer) + `Quantity`. For each
item it shows **every** in-bucket candidate `StoreOffer` across all stores with promos
marked — *broad by default*, not just the single cheapest (D §10) — plus per-store basket
totals, the cheapest store highlighted, and `not available` / `promo` flags. Invariants:
it reads **only published, current `PriceEntry`s** and makes **no external call at
request time** (the whole point of proactive crawling — D §4); a missing
`StoreProduct`/price for a store yields an explicit *not available* rather than a silent
zero.

**Per-store basket total — contribution rule (D §10):** a **brand-anchored** item
contributes only its anchored brand’s offer (or *not available* where that store lacks
it); a **broad (category)** item contributes a *representative* in-category price per
store. The representative is **resolved** (D §14): the **cheapest in-category offer per
store**, carried on the wire as a `basis` field (`cheapest_in_category` | `brand_anchored`
— `06` §12) so the representative can change without a response-shape change.

Deferred (D §10): multi-store split optimisation, travel/route cost, budget-constrained
planning — none are modelled now.

-----

## 13. Deliberate modelling absences

|Absent from the model         |Until / why                                                                        |
|------------------------------|-----------------------------------------------------------------------------------|
|Recipe, MealPlan, Ingredient  |Stage 2 (D §1); Family is shaped to gain them additively (D §9)                    |
|Receipt as a StoreOffer source|Post-MVP enrichment (D §4); StoreOffer is shaped to accept it, not built           |
|Region / store-location price |Stage 2 regional pricing (D §2); MVP is Sofia-flat                                 |
|Country / currency-as-variable|Stage 3 multi-country (D §2); `currency` exists but is constant `EUR`              |
|Notification, Subscription    |Deferred (D §1)                                                                    |
|Real-time sync / merge entity |Stage 2 (D §9); MVP is last-write-wins, no conflict entity                         |
|Non-family share link         |Deferred (D §9); invitations are the only join path                                |
|ML categorization model       |Phase 3 / Stage 3 (D §4); MVP categorization is fuzzy + barcode                    |
|Brand as a first-class layer  |Not a layer (D §4); brand is an *opt-in anchor* — a brand token (D §14 / `04` §7.2)|

-----

## 14. Modelling decisions deferred to `decisions.md` §14

The demand-first questions this document raised are now **resolved** in `decisions.md §14`
(most as `04` representation calls). They are referenced here so the model points to where
each landed; detail is not duplicated:

- **UserProduct term normalization** → resolved: a deterministic dedup-key normalizer
  (NFC + lowercase + trim + whitespace-collapse + punctuation-strip; no stemming on the
  key). (D §14, `04` §7.1 · §6 here)
- **Brand representation for opt-in anchoring** → resolved: a **brand token**
  (`brand_normalized` on `StoreProduct` + `brand_anchor` on `UserProduct`), matched across
  stores; `brands` lookup table deferred to Stage 2. (D §14, `04` §7.2 · §7 here)
- **Broad-item contribution to a basket total** → resolved: the cheapest in-category offer
  per store, carried on the wire as a `basis` field. (D §14, `06` §12 · §12 here)
- **“Frequently bought” window & threshold** → resolved: rolling **8-week** window,
  **≥ 3** buys, operator-tunable. (D §14, `04` §7.5 · §6 here)
- **Purchase-log offer snapshot** → resolved: snapshot columns (`store_product_id` /
  unit price / currency) defined now, populated lazily. (D §14, `04` §7.3 · §6 here)

Genuinely open items remaining in `decisions.md §14` — host
`memory_limit`/`max_execution_time` + exact MySQL version, analytics, the barcode-scanner
stage, the off-host backup cadence, and the Stage-3 managed-DB provider — are **not**
modelling questions and do not touch this document.

-----

## 15. Entity → document map

|Concept                                     |Representation / detail lives in   |
|--------------------------------------------|-----------------------------------|
|Tables, columns, indexes, raw-offer stage   |`04-database.md`                   |
|UserProduct keying, purchase_log schema     |`04-database.md` (per D §9/§14)    |
|Per-stage technology for each context       |`03-tech-stack.md`                 |
|Crawler parsing → `RawOffer` construction   |`05-crawlers.md`                   |
|Categorization pipeline internals           |`05-crawlers.md` (+ Catalog §7)    |
|JWT claim internals, auth endpoints         |`06-api-auth.md`                   |
|List/sync request & response shapes         |`06-api-auth.md` · `07-frontend.md`|
|Comparison response shape (broad candidates)|`06-api-auth.md` (per D §10)       |
|Two-mode list (planning / shopping) UI      |`07-frontend.md` (per D §9)        |

-----

*Last updated: June 2026 · Session 2 of 6 (Opus 4.8, High effort, Thinking OFF) ·
**demand-first re-sync**: Catalog rebuilt on the three layers (UserProduct → CategoryBucket
→ StoreProduct/StoreOffer); `ListItem` now references `UserProduct`; matching split into
lenient StoreOffer→bucket categorization + user matching-by-selection; RawOffer lifecycle
ends at “categorized into a bucket”; Shopping List gains UserProduct, PurchaseLogEntry and
owner-level favorite/recently/frequently-bought; relationship map and boundary table updated.
· **§14 consolidation reconcile:** the five demand-first questions are now resolved in
`decisions.md §14` (term normalizer, brand token, broad-item `basis`, frequently-bought
8-week/≥3, purchase-log snapshot) and referenced as resolved here; a `04` representation
note added to §7 (categorization on `store_products.category_id`; StoreOffer/Promotion are
`price_entries` rows).*