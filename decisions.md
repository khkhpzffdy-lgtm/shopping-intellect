# Grocery Platform — Architectural Decisions

> **Single source of truth.** Every decision made during the discovery phase lives here.
> Load this file as Project Knowledge in every Claude session working on this project.
> When a decision changes, update it here first — the other documents follow this file,
> not the other way around.

-----

## Project Identity

|                 |                                                                                         |
|-----------------|-----------------------------------------------------------------------------------------|
|Working title    |Shopping Intellect (resolved in `01` §14)                                                |
|Team             |2 people, side project                                                                   |
|Location         |Sofia, Bulgaria                                                                          |
|Phase            |Architecture / pre-development                                                           |
|North-star goal  |Validate: families combine promotions + shared lists + cheapest-basket                   |
|Document language|English (consistent across docs; better as Claude Code context + collaborator onboarding)|

-----

## 1. MVP Scope (Stage 1)

The original brief listed 14 modules. The MVP commits to **6**. Everything else is deferred, not abandoned.

### Guiding model — demand-first catalog (new)

The catalog is built from **real user demand**, then that demand is matched against the offers we already crawl. The slogan: **crawl broadly, normalize narrowly.** Concretely, three product layers (detailed in §4):

1. **UserProduct** — how a user/family *names* a thing ("мляко", "яйца", "прах Ariel"). Created the moment it is written into a list; owned by the list owner (user or family, per §9).
1. **Category bucket** (canonical / normalized concept) — the neutral concept a UserProduct sticks to *by default* ("milk"), built up lazily as demand and crawls require — **not** a brand.
1. **StoreProduct / StoreOffer** — a concrete offer or promotion from one chain (and, post-MVP, optionally from a receipt — §4).

This **replaces** the earlier "a list item points directly at one canonical Product" model. The user sees the **broad** category by default and may **opt in** to a specific brand if brand actually matters to them.

### In scope

1. **Users & Auth** — email/password + Google login
1. **Family management** — groups, invitations, roles, shared lists
1. **Shopping lists** — personal + family-shared; with per-item purchase history and owner-level product metadata (§9)
1. **Product catalog** — the three demand-first layers above (user terms → category buckets → store offers); built from demand, not pre-enumerated
1. **Promotions & pricing** — weekly-crawled, with regular prices
1. **Price comparison** — cheapest store for a basket; shows **all** in-category candidates per store, promos marked (§10)
1. **Crawler subsystem** — supporting infrastructure for #4/#5

### Deferred (Stage 2+)

Recipes · Meal planning · AI assistant · Notifications · Subscriptions/billing · PDF brochure OCR · **Receipt scanning** (future StoreOffer enrichment, §4) · Multi-country · Native mobile app (PWA first) · Link-sharing with non-family users · Real-time list sync

**Scope rule:** anything not listed under "in scope" waits. This file is the scope boundary.

-----

## 2. Geographic Scope

- **MVP:** Sofia only
- **Stage 2:** other BG cities (regional pricing per store location)
- **Stage 3:** multi-country (country-scoped data, i18n, multi-currency)

-----

## 3. Target Grocery Chains

Build the crawler abstraction for all 4 from day 1; **launch with the two easiest first.**

|Chain      |Launch   |Difficulty |Notes                                 |
|-----------|---------|-----------|--------------------------------------|
|Lidl BG    |Day 1    |Medium     |Structured catalog, some JSON in pages|
|Kaufland BG|Day 1    |Medium–High|Cloudflare protection likely          |
|Billa BG   |Weeks 3–6|Medium     |Real e-commerce, anti-bot             |
|Fantastico |Weeks 3–6|High       |Less structured, fragile crawler      |

Each crawler ≈ 20–40h initial + 2–5h/month maintenance. Budget 5–10h/month for crawler upkeep across all chains (expect ~1 broken at any time).

-----

## 4. Pricing & Catalog Data Strategy

### Source & model

- **Web crawling**, proactive (crawl everything, store in DB) — **not** on-demand.
  Rationale: on-demand can't power promo discovery, would fire 100+ live requests per basket comparison, and irregular query-time traffic is *more* likely to be blocked than a predictable scheduled crawl.
- **Crawling stays broad — normalization goes demand-first.** We continue to crawl **both** promotional items (200–500/chain) **and** the regular catalog (5k–15k/chain): a typical basket is mostly regular-catalog items, so promo-only data makes comparison useless. What changes under the demand-first model is *what we actively normalize*. Raw offers are crawled and **staged** broadly, but we only spend effort cleaning and categorizing the offers that **real demand** asks for. Buckets fill **lazily** (see "Catalog model"); everything else sits staged, ready to be matched the moment it is requested.
- No PDF brochure OCR in MVP (deferred). **Receipt scanning** is recorded as a *future* StoreOffer-enrichment source, outside MVP (see "Catalog model").

### Currency & money (resolved in `01` §8/§14)

- Prices stored as **integer euro cents** in a `Money` value object — never floats.
- Bulgaria is in the eurozone since 1 Jan 2026; BGN figures met during the 2026 dual-display period are converted at the fixed **1.95583 BGN/EUR**, rounded half-up, and flagged `converted_from_bgn` on the raw offer for audit.
- A `currency` column exists but is constant `EUR` in Stage 1 (cheap future-proofing for §2 Stage 3 multi-currency).

### Schedule

- **Weekly full crawl** — Thursday night (aligns with BG promo rotation).
- **Daily lightweight delta check** — GET promo page + hash compare → trigger partial re-crawl on change.

### Data quality — no ADMIN moderation

The original principle was "no *manual* moderation." It is sharpened here to **no *admin* moderation**, because the demand-first model deliberately moves the human judgment **to the end user**, not away entirely:

- **Auto-publish with rule-based validation only** (unchanged):
  - Reject: price ≤ 0, missing product name, missing store ID.
  - Per-category sane max price ceiling.
  - Flag (but still publish) prices deviating >50% from last known value.
  - Store `data_quality_score` + `source_url` per entry for audit.
- **No admin queue for matching/categorization.** There is no human-in-the-loop approval step gating offers into buckets — categorization is automatic and *lenient* (see "Matching"), and the user resolves any doubt by eye because they see every candidate (§10).
- **Admin merge/split survives, but only as catalog hygiene** — cleaning up duplicate **category buckets** in the canonical layer (e.g. two "milk" buckets that should be one). It is *not* a per-offer review step and *not* on the ingestion hot path.
- UI shows "updated X days ago" — staleness is transparent, never hidden.

Why this still scales for two people: the rules catch garbage automatically, the lenient categorization never blocks data, and the "see all candidates" UI turns the user's own eyes into the moderation layer. No standing human review queue is introduced.

### Catalog model — three demand-first layers

The catalog is no longer a single canonical product table seeded up front. It is three layers, filled from demand:

|Layer                        |What it is                                                                 |Born / built                                             |Owned by                          |
|-----------------------------|---------------------------------------------------------------------------|---------------------------------------------------------|----------------------------------|
|**UserProduct**              |The user's own term for a thing ("мляко", "прах Ariel")                    |Created when first written into a list                   |The list owner (user/family, §9)  |
|**Category bucket**          |A neutral, normalized concept ("milk") a UserProduct attaches to by default|Built **lazily** as demand + crawls require              |Shared / canonical (the whole app)|
|**StoreProduct / StoreOffer**|A concrete offer/promotion from one chain                                  |From crawls (broad); post-MVP also from receipts (enrich)|Shared / canonical                |

Rules:

- **A UserProduct attaches to a category bucket by default, not to a brand.** "Mляко" maps to the *milk* bucket; the user then sees every milk offer across every store (§10). The user may **opt in** to anchor a UserProduct to a specific **brand** within that category if brand matters to them — but the default is the **broad** category. (Brand is represented as a *brand token* — `brand_normalized` on store products + `brand_anchor` on the user product, matched across stores — **not** a fourth layer; §14, `04` §7.2.)
- **Buckets fill lazily.** ~**20–30** popular **categories** *may* be seeded by an admin up front (milk, bread, eggs, cheese, …) so day-one demand lands somewhere sensible; everything beyond that is normalized **on demand** — i.e. when a user term or a crawl needs a bucket that doesn't exist yet. (This replaces the earlier "pre-seed ~200 individual staples" plan: we now seed a handful of *buckets*, not a long list of *products*.)
- **Raw/staged offers are never the catalog.** Crawled offers sit staged; an offer enters a user-visible bucket only via the (lenient, automatic) categorization in "Matching" below. Unmatched/uncategorized offers don't break anything — they simply don't appear until categorized.
- **Receipt scanning (post-MVP)** is a *future* enrichment source for StoreOffer data — a user could one day photograph a receipt to add real, paid prices. Recorded here so the StoreOffer layer is shaped to accept it; **not** built in MVP and **not** required.

### Matching — by selection, product-to-category

Matching changes shape under the demand-first model. It now has two distinct halves, and **neither uses a confirmation dialog:**

**(a) Categorization (the system's job): StoreOffer → category bucket.** This is *product-to-category*, not product-to-product identity — markedly easier than deduplicating "this exact Lidl milk == that exact Kaufland milk." The same techniques still feed it, in phases:

1. Phase 1: fuzzy name matching (normalized name + weight/volume).
1. Phase 2: barcode matching where available.
1. Phase 3: ML-assisted matching (Stage 3).

Categorization is **lenient on purpose.** A debatable offer landing in a roughly-right bucket costs nothing, because the user sees every candidate and judges with their eyes. Mis-categorization degrades gracefully (an extra/odd candidate in a list) rather than corrupting a trusted identity.

**(b) User matching (the user's job): by selection, no confirmation UX.** There are **no "is this the same product? yes/no" dialogs.** The user opens a UserProduct, sees the list of candidate offers across all stores with promos marked (§10), and **browsing/choosing *is* the match.** Optionally they anchor the UserProduct to one brand (the opt-in narrowing above); otherwise it stays broad.

**Re-matching stays offline-friendly.** Because raw offers are staged ("Source & model"), categorization can be re-run when the algorithm improves — without re-crawling. (This property carries over unchanged from the previous model.)

-----

## 5. Infrastructure (Stage 1 = €0 additional)

|Component                        |Host                   |Cost|
|---------------------------------|-----------------------|----|
|WordPress backend (custom plugin)|SuperHosting (existing)|€0  |
|MySQL database                   |SuperHosting (existing)|€0  |
|Crawler cron jobs                |CPanel system cron     |€0  |
|Frontend PWA                     |Cloudflare Pages       |€0  |
|Auth (JWT + Google)              |WP plugins             |€0  |
|CDN + DDoS                       |Cloudflare free tier   |€0  |
|StoreProduct metadata extraction |Google Gemini API      |**usage-based, not €0** — added 2026-06-19, see §14 "StoreProduct dedupe + async Gemini metadata extraction"|

### SuperHosting — confirmed

- SSH access ✅
- Real system cron via CPanel ✅ (not WP pseudo-cron)
- PHP / MySQL versions: OK (assume PHP 8.x)
- `memory_limit` / `max_execution_time`: verify before crawler build; PHP CLI via cron bypasses WP request limits anyway.

### Anti-bot fallback (Stage 1.5, only if blocked)

- Introduce ScrapingBee / Apify (~€5–20/month) **only when a crawler is actually blocked** — not preemptively.

-----

## 6. Backend Architecture

- **WordPress as headless backend** — custom plugin, PSR-4 autoloader, **no Composer**.
- Custom DB tables use the prefix **`$wpdb->prefix` + `si_`** — i.e. WordPress's own install prefix followed by our `si_` namespace. On the current install (`$table_prefix = 'oCk_'`) this **resolves to `oCk_si_`** (e.g. `oCk_si_user_products`). Tables are built from `$wpdb->prefix . 'si_' . '<name>'` so they follow the install if WP's prefix ever changes; documentation shows the resolved literal `oCk_si_`. **(Resolved — closes the §14 "final WP table prefix" open item; replaces the former `<TABLE_PREFIX>` placeholder.)** The dedicated `si_` namespace keeps our tables visually distinct from WP core (`oCk_posts`, …) and from other plugins, and *not* the CityPlay `wptl_`.
- REST API under `/wp-json/si/v1/...`.
- **Naming (resolved in `01` §14):** project **Shopping Intellect** · plugin dir `shopping-intellect/` · PHP namespace `ShoppingIntellect\\` · REST namespace `si/v1`.
- WP Admin reused for: crawler dashboard, catalog management (incl. bucket merge/split, §4), manual price override, data-quality monitoring.

### Plugin structure (mirrors established CityPlay pattern)

```
/wp-content/plugins/shopping-intellect/
  shopping-intellect.php   # Bootstrap: autoloader + hook registration
  bin/                     # CLI entry points (cron): crawl.php, prune.php
  src/
    Api/                   # REST endpoint controllers
    Services/              # Business logic (PriceComparison, ShoppingList, …)
    Repositories/          # DB access layer (Contracts/ + Wpdb/ split)
    Crawlers/              # One class per chain + abstract base
    Models/                # Plain PHP DTOs / value objects
    Support/               # Autoloader, Config, Clock, Logger, HttpClient
    Admin/                 # WP Admin pages
  assets/                  # Admin JS/CSS only
```

### Core principle

**Business logic must not depend on WordPress.** Service classes are plain PHP. WP is the container, not the framework. This is what makes Stage 3 extraction a move, not a rewrite.

-----

## 7. Frontend Architecture

- **React 18 + Vite + TypeScript + Tailwind**
- **Zustand** (client state) · **TanStack Query** (API cache)
- **Capacitor** for the future native wrapper (Stage 2)
- Hosted on **Cloudflare Pages**, separate repo/deployment from WordPress
- **One-domain rule (resolved in `01` §4/§14):** the PWA and the API must share one registrable domain (e.g. `app.<domain>` + `www.<domain>`), both proxied by Cloudflare — otherwise the httpOnly refresh-cookie flow breaks (it would be cross-site, which Safari blocks and Chrome is phasing out).

### PWA requirements (MVP)

- Service Worker (offline support)
- IndexedDB (offline shopping-list storage)
- Background sync queue (offline edits → sync on reconnect)
- "Install as app" prompt
- **Offline-first for shopping lists** — critical; users are in-store without signal

### Native path (Stage 2)

- Wrap the existing React PWA with Capacitor for App Store / Play Store.
- Add native APIs: camera (barcode scan), push.
- Full React Native migration only if performance becomes a documented user complaint.

-----

## 8. Authentication

- **JWT** for stateless API auth — **custom `hash_hmac` implementation, not a plugin** (resolved; see note below).
- **Google OAuth** → issues JWT on success.
- JWT payload: `user_id`, `family_ids[]`, `roles[]` (so we don't hit DB per request).
- Access JWT short-lived (~15 min), held in memory; rotating refresh token in httpOnly cookie.
- **Identity store (resolved in `01` §14):** Stage 1 reuses `wp_users` behind an `AuthProvider` / `UserRepository` abstraction; app users get a zero-capability `si_user` role with no wp-admin access.
- **Provider abstraction:** switching from in-plugin auth to a standalone Auth service in Stage 2 must not change the frontend (same JWT contract). Future: Apple, Facebook.

> **Why custom over a plugin (resolves §14 open question):** the two governing goals decide it — (1) no Composer / minimal dependency surface (§6), and (2) the JWT *claim set is the contract* (`user_id`, `family_ids[]`, `roles[]`), so auth can be extracted to a standalone service in Stage 2/3 without touching the frontend. A WP-JWT plugin is an external dependency (fails goal 1) and typically imposes its own claim shape (threatens goal 2). A hand-written `hash_hmac` signer/verifier needs no dependency (`hash_hmac` is in PHP core) and gives full control of the claims. `01` §7 already assumed this; it is now the decision.

-----

## 9. Shopping Lists & Family Sharing

### Model

- `lists` — `id`, `owner_id`, `owner_type` (user|family), `name`, `created_at`
- `user_products` — **new.** The owner's own term for a thing (§4 layer 1): `id`, `owner_id`, `owner_type` (user|family), `term` (as typed), `normalized_term`, `category_id` (the bucket it attaches to — nullable until categorized), `brand_anchor` (nullable; set only if the user opts in to a specific brand — a brand token matched across stores, §14), `is_favorite`, `created_at`. Unique per (owner, `normalized_term`) so re-entering the same term reuses it and its history/favorite persist.
- `list_items` — `id`, `list_id`, `user_product_id` (**replaces** the old direct `product_id`), `quantity`, `unit`, `is_checked`, `added_by_user_id`, `updated_at`
- `purchase_log` — **new, light.** One append-only row per "checked" event: `id`, `owner_id`, `owner_type`, `user_product_id`, `purchased_at`, plus nullable `store_product_id` / `unit_price_cents` / `currency` of the chosen offer — defined now, populated lazily (§14). Drives "recently bought" (max `purchased_at`) and "frequently bought" (count). Without this log neither metric is possible; we accept the log for MVP.
- `families` — `id`, `name`, `created_by`, `created_at`
- `family_members` — `family_id`, `user_id`, `role` (admin|member), `joined_at`
- `family_invitations` — `id`, `family_id`, `invited_email`, `token`, `expires_at`, `status`

### Owner-level product metadata (new)

All of the following live at the **owner** level — the family if the owner is a family, otherwise the individual — following the same polymorphic-owner rule as lists:

- **Favorite** — a user flag on a `user_product` (`is_favorite`).
- **Recently bought** — derived from `purchase_log` (most recent `purchased_at`).
- **Frequently bought** — derived from `purchase_log` (default: ≥ 3 buys in a rolling 8-week window; tunable — §14).

`is_checked` stays as the in-list checked state; the purchase log is **separate and append-only**, so it survives list edits and item deletion — which is exactly what makes "frequently bought" meaningful over time.

### Rules

- A list belongs to a user OR a family.
- Family lists visible to all family members.
- A `list_item` references a **UserProduct**, not a free-text string and not (directly) a canonical product — the UserProduct carries the term and its category/brand attachment (§4).
- Offline-born UserProducts and list items carry a `client_uuid` for idempotent sync (per `01` §6.5) — UserProducts are created at list-write time, which often happens offline.
- **No link-sharing with non-family users** in MVP.
- **No real-time sync** in MVP — last-write-wins + "updated X sec ago" indicator. Conflict-resolution UX deferred.

### Two-mode list — UI direction (detail in `07-frontend.md`)

The list surface will be **dual-mode**: a **planning** mode (at home — browse all candidates and prices, decide where to buy) and a **shopping** mode (in-store — calm, low-friction checking with the comparison out of the way). Noted here only as direction; the interaction detail belongs to `07-frontend.md`.

### Migration to Stage 2

- Family gains shared recipes / meal plans / budget.
- Real-time sync via WebSockets or Mercure (extracted service).
- Additive schema changes only — no rewrite.

-----

## 10. Price Comparison Engine

### MVP

- **Input:** a list of items (each a `user_product` → its category bucket, or a brand-anchored offer) + quantities.
- **Output (broad by default):** for each item, **every** in-bucket candidate across all stores with promos marked — *not* just one cheapest (this is the "broad by default" of §4) — plus per-store basket totals, the cheapest store highlighted, "not available" flags, and promo flags.
- **Contribution to the per-store basket total:** a **brand-anchored** item contributes only its anchored brand's offer (or "not available" where that store lacks it); a **broad (category)** item contributes a representative in-category price per store — **the cheapest in-category offer per store** (resolved §14; carried on the wire as a `basis` field, so the representative can change without a shape change — `06`).
- Pure PHP `PriceComparisonService`, runs entirely on MySQL queries, no external deps.

### Deferred

- Multi-store split optimization · travel/route cost · budget-constrained planning.

-----

## 11. Scaling Stages & Extraction Triggers

### Stage 1 — Validate (0–100 users)

All on WordPress + SuperHosting. PWA on Cloudflare Pages. Real cron via CPanel. €0 additional.

### Stage 2 — Early growth (100–3,000 users)

WordPress stays as backend + admin + marketing. Extract **only on trigger:**

|Trigger                   |Action                                                            |
|--------------------------|------------------------------------------------------------------|
|Crawlers destabilizing WP |Move crawlers to standalone PHP CLI / Python on cheap VPS (~€5/mo)|
|API p95 > 500ms under load|Add Redis object cache                                            |
|WP DB connections maxed   |Read replica or managed DB                                        |
|Push notifications needed |Firebase Cloud Messaging (free tier)                              |
|AI features requested     |Gemini free tier (same pattern as prior project)                  |

**Catalog maturation (demand-first → broadening).** The category buckets, seeded with only ~20–30 categories in Stage 1 and filled lazily from demand (§4), naturally **broaden and deepen** through Stage 2 as more users and more crawl coverage exercise more of the catalog. This growth is **additive** — no schema change — and the richer normalized buckets are precisely the substrate the deferred recipe / meal-planning / AI features build on. Bucket growth is *organic*, not a trigger: it happens continuously, not at a threshold.

### Stage 3 — Scale (3,000+ users)

Standalone REST API (reuse the same service classes) · WP demoted to CMS/marketing/SEO · managed DB (PlanetScale/Supabase/RDS) · Capacitor or React Native apps · multi-country · HA.

**Invariant across stages:** migration is incremental and additive. Each stage reuses the prior stage's artifacts.

-----

## 12. Key Risks

|Risk                                                                |Severity         |Mitigation                                                                                                                                                                                                                                                                                                                                                   |
|--------------------------------------------------------------------|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------||Anti-bot blocking by chains                                         |High             |Phased crawling, respectful rate limits, proxy fallback if blocked                                                                                                                                                                                                                                                                                           |
|Product **categorization** quality (was product-to-product matching)|Medium (was High)|Demand-first shifts this from product-to-product *identity* to product-to-**category** — easier, but not free. Lenient categorization + the "see all candidates" UI (§4, §10) make mis-categorization non-fatal: the user judges by eye, a wrong bucket degrades gracefully. Still backed by fuzzy + barcode categorization and admin **bucket** merge/split.|
|UserProduct sprawl / messy user terms                               |Low              |Owner-scoped — never pollutes the shared canonical layer — and deduped per (owner, normalized term). Worst case is a slightly messy *personal* term list, fixable by the user. No shared-catalog impact.                                                                                                                                                     |
|Crawler maintenance burden (4 chains)                               |High             |Isolated crawler classes, monitoring alerts, 5–10h/mo budget                                                                                                                                                                                                                                                                                                 |
|ToS violation / cease & desist                                      |Medium           |EU public-data grey zone; small low-priority target; no reselling raw data                                                                                                                                                                                                                                                                                   |
|SuperHosting memory/timeout limits                                  |Medium           |PHP CLI via cron bypasses WP limits; test early                                                                                                                                                                                                                                                                                                              |
|Family sync conflicts                                               |Low (MVP)        |Last-write-wins + visible timestamp                                                                                                                                                                                                                                                                                                                          |
|Scope creep (14 → 6 modules)                                        |High             |This file is the boundary; defer everything not in §1                                                                                                                                                                                                                                                                                                        |

-----

## 13. Document Set & Generation Settings

Recommended Claude settings per document (model: **Opus 4.8** throughout — same price as 4.7, clearly better; Fable 5 is overkill/2× cost for this work).

|# |File                     |Effort |Thinking|Status                    |
|--|-------------------------|-------|--------|--------------------------|
|— |`decisions.md`           |Extra  |ON      |✅ Done                    |
|00|`00-overview.md`         |High   |OFF     |✅ Done                    |
|01|`01-architecture.md`     |**Max**|ON      |✅ Done                    |
|02|`02-domain-model.md`     |High   |OFF     |✅ Done                    |
|03|`03-tech-stack.md`       |High   |OFF     |✅ Done                    |
|04|`04-database.md`         |Extra  |ON      |✅ Done                    |
|05|`05-crawlers.md`         |**Max**|ON      |✅ Done                    |
|06|`06-api-auth.md`         |High   |OFF     |✅ Done                    |
|07|`07-frontend.md`         |High   |OFF     |✅ Done                    |
|08|`08-scaling-migration.md`|Extra  |ON      |✅ Done                    |
|09|`09-risks-costs.md`      |Extra  |ON      |✅ Done                    |
|10|`10-ux-rules.md`         |High   |OFF     |◑ §§1–7 (8–9 next session)|
|11|`11-user-flows.md`       |High   |OFF     |✅ Done                    |
|12|`12-execution-model.md`  |High   |OFF     |✅ Done                    |
|13|`13-implementation-line.md`|Extra|ON     |✅ Done                    |
|— |`CLAUDE.md`              |High   |OFF     |✅ Done                    |


> **§14 consolidated (this update).** The re-sync of `00`–`03` is complete and the decisions made in sessions `04`–`08` have been folded back into §14 below. The full set `00`–`09` + `CLAUDE.md` is consistent on the demand-first model. One small wording reconciliation remains in `02` §7 (categorization is persisted on the store-product identity per `04` §7.4, and `StoreOffer`/`Promotion` are `price_entries` rows) — a one-line note, not a model change.

**Rule of thumb:** if a document reasons about trade-offs / triggers / migration → Extra or Max + Thinking ON. If it's descriptive/catalog → High + Thinking OFF. Don't mix Thinking ON/OFF docs in one session.

-----

## 14. Open Questions

### Still open

- [x] **Final WP table prefix** → **`$wpdb->prefix` + `si_`**, resolving to **`oCk_si_`** on the current install (`$table_prefix = 'oCk_'`). Tables are derived as `$wpdb->prefix . 'si_' . '<name>'`, so they follow the install. The former `<TABLE_PREFIX>` placeholder is retired across the doc set in favour of the resolved literal `oCk_si_`. (§6)
- [ ] **SuperHosting `memory_limit` / `max_execution_time` + exact MySQL version** — host facts to confirm before the crawler build. The MySQL version also decides `JSON` vs `TEXT` for `crawl_runs.resume_state` and the `VARCHAR(190)` index-prefix habit (`04` §2.2/§4.6). CLI via cron should bypass web limits; chunked + resumable runs mitigate if it doesn't.
- [ ] **Analytics:** self-hosted Plausible vs none in MVP.
- [ ] **Barcode scanner: MVP or Stage 2?** `07` §11 recommends **Stage 2, via the Capacitor camera path** (web `BarcodeDetector` support is too uneven for an MVP dependency; the crawl-side `barcodes` table for Phase-2 categorization is independent of a client scanner). Recorded as the leaning — **confirm**.
- [ ] **Off-host backup download cadence.** `01` §9 says "periodic" without an interval; `09` §7/§8 flags it as unset operational policy. Recommend a concrete cadence (at minimum, before and after any risky release) — **decide & record**.
- [ ] **Stage-3 managed-DB provider** (PlanetScale / Supabase / RDS) and **Capacitor wrap vs full React Native** — deferred / contingent on measured performance (`03` §5/§7, `08` §5); referenced as open, not pre-selected.
- [ ] **Multi-member family dissolve.** `D-2` (resolved below) added member self-leave + admin hand-off + solo-family auto-delete, but an explicit **`DELETE /families/{id}`** (an admin dissolving a family that still has other members) is **not** added — decide whether MVP needs it, or members are removed/leave individually first. (`06` §6.6)
- [ ] **FLAG — "Recipes" tab vs the MVP exclusion list.** The owner's 2026-06-17 navigation note names a future bottom-nav `Recipes` tab alongside `Offers`. `11-user-flows.md` §"Open for design" (closing notes) currently lists **recipes/meal-plan as a deliberately-excluded MVP surface**. Not reconciled here at the owner's request — **flagged only**; resolve explicitly (either retire the exclusion or drop/rename the future tab) before building a Recipes screen.

### Resolved — StoreProduct edit rights for `source='user'` rows (2026-06-21)

Found while designing §2.8b (StoreProduct detail screen): `source='user'`
StoreProduct dedupe is global across all users (`findByNormalizedName()`,
resolved below), but nothing said who may rename/edit a row once two unrelated
users can share it. The natural-sounding answer — "anyone in the same family
list can edit it" — doesn't have a foothold in the current code: family-owned
lists are **not built yet**. `ListService::createList()` rejects any
`owner_type` other than `'user'` (`ListService.php:39`) and `ownsList()` only
ever checks `ownerType === 'user' && ownerId === userId` (`ListService.php:268`).
`family_ids[]` exists on the JWT claim set but nothing in `ListService` uses it
to gate list access yet. Closed as follows:

- [x] **Edit rights on a `source='user'` StoreProduct are creator-only**,
  checked against `created_by_user_id` — the same shape as
  `UserProductService::ownedNonSystemUserProduct()`'s guard, applied to
  `StoreProductService::rename()`/`setImageUrl()`/`setBarcode()`. This is an
  interim rule, not a statement that family-shared edit rights are wrong —
  it's what the data model can actually express today.
- [x] **A non-creator's edit attempt returns 403 Forbidden** (a new
  `StoreProductForbiddenException`), mirroring the existing system-row 403 in
  `UserProductController`. Not a silent no-op, not a fork into a new row.
- [x] **Family-wide edit rights on shared StoreProducts is deferred until
  family-owned lists actually exist** — re-open this question when that
  feature is built; don't build family-membership checks into
  `StoreProductService` ahead of that.

### Resolved — barcode edit is a true replace, not an accumulate (2026-06-21)

Found while designing §2.8b: the `oCk_si_barcodes` table supports several
barcode values per `store_product_id` (multipack/variant, Phase 2), which
made the planned `BarcodeRepositoryInterface` (`attach()` + `valuesFor()`,
no removal) ambiguous for the single-barcode-field UI this slice builds —
correcting a typo would silently leave the old value attached alongside the
new one. Closed as follows:

- [x] **`BarcodeRepositoryInterface` gains a `replace(int $storeProductId,
  string $value): void`** — deletes any existing values for that
  `store_product_id` before inserting the new one. The detail screen's single
  barcode field always calls `replace()`, never `attach()` directly.
  `attach()` stays on the interface for whenever Phase-2 multipack/variant
  support actually adds multiple barcodes through a different UI path.
- [x] **`GET /store-products/{id}` returns a single `barcode` value** (the
  most recent, i.e. the only one after a `replace()`), not an array — keeps
  the response shape simple for the v1 single-barcode UI. Revisit when
  Phase-2 multi-barcode UI lands.

### Resolved — list_items can target a specific StoreProduct directly (2026-06-18)

The owner wants two equally-valid ways to populate a list: a **broad term**
("мляко" — a `UserProduct`, unchanged) and a **specific item** ("Мляко Данон
2% 1л" — a concrete `StoreProduct`), without forcing the specific item to be
represented "under" an artificial UserProduct term. Closed as follows:

- [x] **`list_items` gains a nullable `store_product_id` alongside the existing
  `user_product_id`; exactly one of the two is set per row** (app-level
  invariant, enforced in `ListItemRepository`, not a DB `CHECK` — keeps
  MySQL-version portability per `04` §2.2). This **amends** the prior iron
  rule "list_items references `user_product_id`, never a canonical product
  directly" (`CLAUDE.md` §2.6, `02` §6) — the rule's intent (never free text,
  never the *old* single canonical `Product`) is preserved; what changes is
  that `StoreProduct` (the demand-first layer-3 identity, not the retired
  single-`Product` model) is now also a valid, *direct* target. No regression
  to demand-first: a UserProduct still attaches broadly to a `CategoryBucket`
  by default, and Add/Search still searches only the owner's own terms — this
  only adds a second, equally-direct path for when the user already knows the
  exact item.
- [x] **`StoreProduct` gains a `source` enum (`crawler` | `user`)** so the same
  table/identity serves both crawl-discovered items and items a user manually
  creates (name only required; photo + barcode optional) before any crawler
  has found that exact item. A user-created `StoreProduct` has `store_id`
  nullable (no specific chain pinned) and `created_by_user_id` set; a future
  crawl match can later backfill `store_id`/`source_external_id` onto the same
  row rather than creating a duplicate (re-categorization-friendly, consistent
  with the existing "re-categorize without re-crawl" property, `02` §10).
- [x] **Not every UserProduct needs a StoreProduct, and vice versa.** "Краставици"
  may only ever exist as a bare UserProduct (no specific branded item) — this
  is normal, not a gap the crawler must fill. The two layers are independent;
  a list mixes both freely.
- [x] **Both row types render in the same list, same UI, same offline-sync
  pipeline** — `client_uuid` idempotency, optimistic local-first writes, and
  last-write-wins all apply identically regardless of which FK is set. Detail
  screens differ by type (UserProduct: term + category + favorite; StoreProduct:
  name + photo + barcode + optional brand link), but list rendering/checking/
  removal is type-agnostic.
- [x] **List deletion is a hard delete of the list row and its `list_items`
  rows only** — never the `user_products`/`store_products` they reference
  (those persist for reuse/history independent of any one list, consistent
  with `user_products.is_archived` soft-delete already protecting term
  history). (`04` §4.3)

### Resolved — StoreProduct dedupe across users + async Gemini metadata extraction (2026-06-19)

Found during review of §4.0c (manual StoreProduct creation): as built, two different
users independently typing the same specific item (e.g. "Мляко Олимпус 2% 1л") each get
their **own** `source='user'` `store_products` row — no cross-user dedupe. This defeats
the point of StoreProduct being a shared, canonical layer-3 identity (D §4) — once
crawling/matching (§3.x/§4.x) lands, the system would have to match offers against N
duplicate rows instead of one. Closed as follows:

- [x] **`StoreProductService::findOrCreate` gains real dedupe: exact `normalized_name`
  match across ALL users, not scoped to the creating user.** A `source='user'` row is
  looked up by `normalized_name` (same normalizer shape as `UserProduct`'s — lowercase/
  trim/whitespace-collapse) before creating a new one; a match returns the existing row
  instead of duplicating it. This is **literal-text dedupe only** — "Мляко олимпус 2% 1
  л" and "мляко олимпус 2%, 1л" normalize to the same string and merge; "Олимпус мляко,
  2%, 1 литър" (different word order/phrasing) does **not** match today and creates a
  second row. No fuzzy matching and no confirmation dialog are introduced — fuzzy
  matching-with-confirmation was explicitly considered and rejected because it would
  reintroduce the "is this the same product? yes/no" UX the matching-by-selection
  principle (D §4) deliberately avoids everywhere else.
- [x] **Asynchronously, after creation, a background job calls the Gemini API to extract
  structured metadata from the free-text name**: `brand_normalized` (e.g. "Олимпус"),
  a quantity/size value (e.g. "1л" — new column, not yet named/typed in this resolution,
  defer the exact representation to the slice that builds it), a percent/variant
  attribute (e.g. "2%" — new column), and a best-guess parent category/bucket link
  (written into the `product_categories` junction table from §4.0e, not a new column).
  **Asynchronous and non-blocking**: adding an item to a list never waits on Gemini —
  the StoreProduct row is created and usable immediately with just its typed name; the
  extracted fields fill in later (the item detail screen, §2.8, should be able to show
  "enriching…" or simply show the fields once populated, without the Owner having to do
  anything). This preserves the offline-first/optimistic-add principle — a network-
  dependent LLM call must never block or characterize the user-facing add path.
- [x] **Gemini is a new external dependency** — the first LLM API integration in this
  codebase. API key + selected model are **admin-configurable**, mirroring the existing
  Google OAuth settings pattern (`Admin/GoogleSettingsPage.php` + `Support/Config.php`'s
  `get_option('si_google_client_id', ...)` shape) — a new `Admin/GeminiSettingsPage.php`
  + `si_gemini_api_key`/`si_gemini_model` options. This is the **first paid/metered
  external API** the project depends on, which touches D §5's "€0 additional infra in
  Stage 1" framing — Gemini calls are a new, real, usage-based cost. Record here as a
  deliberate, owner-approved exception, not an oversight; no budget/quota/cost-cap
  mechanism is specified in this resolution — flag as a future hardening item if costs
  need bounding (D §14).
- [x] **Future intent, not built now: merging two differently-worded StoreProduct rows
  once their Gemini-extracted structured fields match** (e.g. two rows with different
  `source_name` text but identical `brand_normalized` + the same parsed quantity). This
  is recorded as a stated direction, same status as the `is_global_default` promotion
  mechanism above — a plain intent for a future slice, no schema, job, or threshold
  designed yet.

### Resolved — unlimited-depth categories, many-to-many product↔category, and seeded default products (2026-06-19)

The owner wants three things: (1) category buckets to support unlimited nesting
depth, not the current flat ~20-30 list; (2) a UserProduct/StoreProduct to
attach to more than one category at once; (3) every new account to start with
~300 seeded generic products (from `shopping_intellect_mvp_starter_catalog_v1
2.md`) instead of an empty system, with those seeded rows visible to and usable
by every user but never deletable by an ordinary user. Closed as follows:

- [x] **`categories` gains a nullable self-referencing `parent_id`** (FK →
  `categories.id`, `ON DELETE SET NULL` so deleting a parent demotes children
  to root rather than cascading). **No depth limit is enforced in code or
  schema** — depth is just how many `parent_id` hops a query follows. This
  **retires** the `04 §4.4` line "No `parent_id` in MVP — buckets are flat" —
  flat is now simply the depth-1 case (`parent_id IS NULL`), not a hard rule.
  Reading a bucket's full ancestor/descendant chain is a recursive query
  (`WITH RECURSIVE` where the MySQL version supports it, §14 "exact MySQL
  version" is still an open question this depends on — flag if the host's
  version doesn't support CTEs and a closure-table/path-enumeration fallback
  is needed instead).
- [x] **`category_id` is removed from both `user_products` and
  `store_products`; a new junction table `oCk_si_product_categories`**
  replaces the one-to-one FK with many-to-many: `id`, exactly one of
  `user_product_id`/`store_product_id` set (same app-level exactly-one-of
  pattern as `list_items`, 2026-06-18), `category_id`, `created_at`. A
  product/item can belong to any number of categories at once (e.g. a
  product could sit under both "Зеленчуци" and a future "Био" tag-like
  category) — this is the first real use of "many" so the junction table
  is plain, no ordering/primary-category flag added speculatively.
- [x] **`user_products.owner_type` gains a third enum value, `'system'`**
  (alongside the existing `'user'`/`'family'`) — `ENUM('user','family','system')`.
  A `system`-owned `UserProduct` has `owner_id = 0` (a reserved constant, not a
  real `wp_users.ID` or `families.id`) and a new `is_global_default` flag.
  **Only `user_products` gains this — `lists`/`purchase_log`'s `owner_type`
  stay `ENUM('user','family')` unchanged**, since a list or a purchase event
  is never system-owned.
- [x] **Seeded rows are visible to every user (read) but not editable/
  archivable by an ordinary user** — enforced in `UserProductService`/
  `ListService` (an attempt to archive/edit a `system`-owned row is rejected,
  same shape as the existing ownership check that already rejects editing
  someone else's `user`/`family`-owned row), not by a DB constraint. Adding a
  seeded product to a list or favoriting it are unaffected — those create
  normal owner-scoped records/flags as today; only the seeded row itself is
  protected.
- [x] **The seed is a one-time data migration** importing the ~300 rows from
  `shopping_intellect_mvp_starter_catalog_v1 2.md` as `system`-owned
  `user_products` (`term` = the Bulgarian "Product" column, `normalized_term`
  via the existing normalizer, `is_global_default = 1`), each linked via the
  new junction table to a `categories` row matching the file's "Category"
  column (the file's 25 categories map onto/extend the existing ~20-30 seeded
  buckets — reconcile by name at migration-authoring time, don't duplicate a
  bucket that already exists under a different slug). The file's "Default
  unit"/"Quantity suggestions"/aliases columns are **not** modelled now — out
  of scope for this resolution; flag as a future enrichment if quick-add
  chips or alias-matching are built later (D §14).
- [x] **Promoting a popular user-created term to global-default status is a
  deliberately future, unbuilt mechanism** — the owner's stated direction
  ("ako 100 users create Айвар, it also becomes default and visible to all")
  is recorded here as intent, not built in this resolution. `is_global_default`
  is a plain flag an admin process can flip later; no popularity-counting
  job, threshold, or promotion endpoint exists yet.

### Resolved — Catalog becomes "browse my products" (amends the 2026-06-17 bottom-nav rule) (2026-06-18)

The owner wants the Catalog tab to be more than a read-only taxonomy browse: it
should let the owner manage their own UserProduct/StoreProduct inventory, grouped
by category bucket, and add to a list directly from there. This **amends** (does
not retire) the 2026-06-17 resolution "Bottom navigation becomes destinations, not
actions" — specifically the clause "[Catalog has] no prices, no offers, and no
connection to list-adding." Closed as follows:

- [x] **Category buckets themselves stay exactly as built in §4.0b** — the flat
  list of ~20-30 seeded buckets (`GET /categories`), fixed/shared taxonomy. A
  bucket **cannot be created, edited, or deleted by a user** — only an admin
  merge/split survives as catalog hygiene (D §4, unchanged). This part of the
  2026-06-17 rule is **not** amended.
- [x] **Tapping a bucket now opens a bucket-detail view** showing the owner's own
  UserProduct terms and StoreProduct items already attached to that bucket
  (`category_id` match) — empty if the owner has nothing there yet. **Owner-
  scoped** (D §9's existing owner-context rule, the same one already governing
  favorites/recent/frequent): shows the logged-in user's own records **and**
  the records of any family the user belongs to, once `§2.4` ships a backend —
  **never** another, unrelated user's records. Until `§2.4` ships, this is
  simply "the logged-in user's own records" (no family filter exists yet to
  apply) — built now on that narrower scope, family-widening is additive when
  `§2.4` lands, not a redesign.
- [x] **From the bucket-detail view, the owner can:** create a new UserProduct/
  StoreProduct directly into that bucket (same create paths as Add/Search §4.0
  and the manual-StoreProduct flow §4.0c, just entered from Catalog instead of
  a list's `+`), edit (§2.8's detail screens), archive (`is_archived` soft-
  delete for UserProduct; an equivalent flag for StoreProduct — see below), and
  add the record to any of the owner's lists. **This does reopen "no global
  product-catalog picker" only to the extent of the owner's own/family records**
  — it remains true that no one ever browses a stranger's terms; "no global
  catalog" meant "no shared catalog of everyone's products," which still holds.
- [x] **Archiving from Catalog while the record is still on an active list is
  blocked** (recommended by the owner) — implemented reactively: the archive
  action is always tappable, the server rejects with 409 `in_use` if an active
  `list_items` row still references it, and the UI shows that message inline
  with a prompt to remove it from its list(s) first (the existing
  `onRemoveItem` / `§2.6` list-delete affordances already cover that), rather
  than proactively graying out the button in advance. **Amended 2026-06-21
  (§4.0d build) from "disabled" to "reactive"** — a proactive disable would
  require `GET /categories/{id}/products` to additionally compute and return
  an in-use flag per row (a join against `list_items` for every record shown),
  which is a bigger response-shape and query change for the same end result
  (archiving an in-use record is blocked either way); reactive ships in this
  slice's budget, proactive can follow later if the UX gap is felt in practice.
  This still mirrors the existing `RESTRICT` FK behaviour
  (`list_items.user_product_id`/`store_product_id` → `ON DELETE RESTRICT`,
  `04` §4.3) at the application layer instead of surfacing a raw DB error.
- [x] **StoreProduct gains an `is_archived` flag**, mirroring `user_products.is_archived`
  (`04` §4.3) — needed now that StoreProduct rows are independently manageable
  from Catalog, not just attached to a list. Same soft-delete rationale: history
  (`purchase_log` snapshot columns referencing `store_product_id`) survives.
- [x] **A UserProduct/StoreProduct becomes visible in its bucket's Catalog detail
  the moment it's categorized — regardless of whether it's on any list.**
  Category attachment (not list membership) drives Catalog visibility; adding
  something to a list and adding it from Catalog both result in the same
  underlying row, so both surfaces always agree.

### Resolved — Profile screen, v1 scope (2026-06-18)

- [x] **Profile screen v1** = account info (display name, email) + the
  existing theme toggle (moved from the Lists app bar, `HomeScreen`'s
  `store/theme.ts` wiring unchanged) + logout (moved from the Lists app bar).
  **No family management in v1** — family endpoints don't exist yet (`06` §6.6
  is speculative; `UserProductController` only has a TODO for family
  enforcement). Family-in-Profile is deferred to when `§2.4` (Family slice)
  actually ships a backend.

### Resolved — demand-first consolidation (folded back from `04` / `06` / `08`)

Decided during sessions `04`–`08` (the `04` §8 set at the owner's direction; `06`/`08` wire- and forward-defaults). Moved here from open:

- [x] **`normalized_term` normalizer** = NFC + lowercase + trim + whitespace-collapse + punctuation-strip; **no stemming on the dedup key** (the `(owner, normalized_term)` unique). Any light stemming feeds the categorization matcher only, never the key. (`04` §7.1)
- [x] **Brand anchor = a brand token** — `brand_normalized` on `store_products` + `brand_anchor` on `user_products`, matched across stores; a `brands` lookup table is deferred to Stage 2. (Resolves "brand representation": brand stays an opt-in anchor, **not** a fourth layer.) (`04` §7.2)
- [x] **Categorization persisted on `store_products.category_id`** (the product identity); an offer's bucket is **derived through its product** — realizing the `StoreOffer → CategoryBucket` link without per-offer duplication, so re-categorization touches one row, not N. *Reconcile `02` §7 wording.* (`04` §7.4)
- [x] **`StoreOffer` and `Promotion` are physically one table, `price_entries`** — StoreOffer = the priced candidate row; Promotion = `is_promo = 1`. No separate `store_offers` / `promotions` tables. (`04` §4.5/§8)
- [x] **Broad-item basket contribution = cheapest in-category offer per store** (the default representative), exposed on the wire as a `basis` field (`cheapest_in_category` | `brand_anchored`) so the representative can change without altering the response shape. (`06` §12, §10)
- [x] **Empty-bucket candidate read = `200` with empty `candidates[]` + `category_id: null`** ("matching in progress"), not a `409`. (`06` §12)
- [x] **"Frequently bought" = ≥ 3 buys in a rolling 8-week window** — a tunable default held as operator WP options, re-tunable with **no migration**. (`04` §7.5)
- [x] **`purchase_log` snapshot columns defined now, populated lazily** — `store_product_id`, `unit_price_cents`, `currency` added nullable at creation (to avoid a later `ALTER` on an append-only table); MVP may leave them `NULL`; recently/frequently-bought work off `(owner, user_product_id, purchased_at)` regardless. (`04` §7.3)
- [x] **`user_products.is_archived` soft-delete** so deletion never breaks `purchase_log` history or the `(owner, normalized_term)` unique slot. (`04` §4.3)
- [x] **App tables hold `user_id` (`wp_users.ID`) by logical reference, no DB FK** — FKs only among `oCk_si_*` tables — keeping the `AuthProvider` export seam clean. (`04` §2.4)
- [x] **`schema_version` lives in a WP option** in Stage 1 (confirms §6 / `01` §10 at the schema level); at the Stage-3 managed-DB cutover it becomes a tiny `oCk_si_meta` row so the runner is WP-independent — a **Stage-3 cutover step**, not a Stage-1 change. (`04` §6.1, `08` §9)
- [x] **Refresh-token lifetime 30 days with lineage-wide reuse-detection** — the persistence default; the rotation/verification flow is `06` §5.2. (`04` §7.6)

### Resolved (folded back from `01` §14 — closed this revision)

- [x] **Project / plugin name** → **Shopping Intellect** · plugin dir `shopping-intellect/` · PHP namespace `ShoppingIntellect\\` · **REST namespace `si/v1`** (replaces the earlier `groceryapp/v1`). (§6)
- [x] **Currency** → integer **euro cents** in a `Money` value object; BGN → fixed **1.95583**, rounded half-up, flagged `converted_from_bgn`; `currency` column constant `EUR` in Stage 1. (§4)
- [x] **One-domain rule** → PWA + API under one registrable domain (`app.<domain>` + `www.<domain>`), both proxied by Cloudflare, so the `httpOnly` refresh cookie stays same-site. (§7)
- [x] **Identity store** → reuse `wp_users` behind an `AuthProvider` / `UserRepository` abstraction; app users get a zero-capability `si_user` role with no wp-admin access. (§8)
- [x] **JWT implementation** → custom `hash_hmac` issuer/verifier, **not** a WP-JWT plugin (keeps the no-Composer constraint and full control of the claim-set contract). (§8)
- [x] **Crawler execution** → PHP CLI bootstraps `wp-load.php`; one process per chain; MySQL `GET_LOCK` concurrency guard; chunked + resumable runs; raw offers retained 8 weeks then pruned. (§4/§5, `01` §6.3)

### Resolved — UX screen-state rules (folded back from `10`)

Screen-state / component-level UX resolutions from `10-ux-rules.md` (§§1–7). **Presentational only** — they re-decide no product behaviour; `07` stays canonical for client architecture and the two-mode mechanics, `10` is canonical for screen-state and component-level UX:

- [x] **Comparison excludes "matching in progress" (uncategorized) items from per-store totals and the cheapest-store calculation**, and shows them distinctly from `not_available`; only categorized-but-absent offers count toward `missing_items`. Keeps the where-to-shop decision trustworthy for brand-new terms. (`10` §5.6)
- [x] **Cheapest-store ranking always shows each store's `missing_items` count beside its total** — a store total is never presented as "cheapest" without its coverage gap visible. (`10` §5.1)
- [x] **Add/Search searches only the owner's own terms** (plus favorites / recent / frequent quick-add and category/promotion browse) — **no global product-catalog picker**; a new term creates a new UserProduct. (`10` §2.6/§6.2)
- [x] **Inbound family invitations are accepted via the emailed token deep-link** — **no in-app pending-invitations inbox** in MVP. (`10` §4.5)
- [x] **No standalone purchase-history screen in MVP** — `purchase_log` surfaces to users only as recently / frequently bought. (`10` §6.4)
- [x] **Owner-context rule for surfaced metadata** — the favorites / recent / frequent shown while adding to a list are scoped to **that list's owner** (family vs user), not the logged-in user globally. (`10` §4.2)
- [x] **Bottom navigation becomes destinations, not actions** (2026-06-17). The bottom nav holds only *browse* destinations (`Lists`, `Catalog`, and later `Offers`); it does **not** hold "Add". "Add to list" is an in-context action reached via a **`+` affordance on the List screen**, opening Add/Search as an overlay/sub-screen scoped to that list — never a standalone bottom-nav tab. **`Catalog` is a new screen**: a browse-only list of category buckets (`GET /categories`, `06` §6.5) with **no connection to list-adding and no prices/offers** — it is a pure taxonomy browse, distinct from the future `Offers` tab (which will surface `GET /promotions`, already specced in `06` §6.5 but not yet built). This does **not** reopen the "no global product-catalog picker" rule (`10` §2.6/§6.2, this file above): picking a category in Catalog never creates or attaches a UserProduct — Add/Search (now reached from the List screen) remains the only path that creates one, still scoped to the owner's own terms. (`10` §2.6, §6, Component Inventory §8; `11` Part B screen inventory)

### Resolved — D-1 brand-chip label · D-2 family membership lifecycle

Closed at the owner's direction (the two `10` Decision Required items):

- [x] **D-1 — Anchored brand chip = the `brand_normalized` token, title-cased client-side at render** (Cyrillic-aware), **only the brand** — no offer name, no new schema, no lookup. The chip is also the clear-anchor control (tap → back to broad). The "Anchor" action is offered only for a candidate that carries a brand token. At Stage 2 the chip's text source swaps to the `brands` display name **with no UX change**; an optional tiny client-side exception map (≤5–10 brands) covers typography edge cases and also retires at Stage 2. (`10` §3.4)
- [x] **D-2 — Family membership lifecycle** closed with **two additive `06` routes**, reusing existing error codes (no new code, no `v2`):
  - **`PATCH /families/{id}/members/{userId}`** (JWT + **admin**) — role change `admin↔member`; demoting the **last admin** → `409 last_admin`. **Not ↻ fresh token** (per-family role is read from `family_members` each request).
  - **`DELETE /families/{id}/members/{userId}`** — auth widened to **admin OR self** (`caller == userId`); the **last admin cannot leave/be removed while other members remain** → `409 last_admin` (promote first); a **solo** member leaving succeeds and the empty family is **deleted** server-side. **↻ fresh token** for a self-leaver.
    (`06` §6.6, §4.2/§4.3.) Remaining minor open: an explicit multi-member `DELETE /families/{id}` dissolve (see Still open).

### Resolved — sync-pipeline incident: header stripping, dropped headers, duplicated mutation/null-binding code (2026-06-17)

A live-production incident (every list/item silently stuck `sync-pending` forever)
traced to **four independent bugs stacked on top of each other**, only the last of
which was a real auth/session defect (already fixed earlier the same day):

1. **Host-level:** the production Apache/PHP runtime stripped the `Authorization`
   header before PHP ever saw it (common on FastCGI/PHP-FPM-via-Apache shared
   hosting) — every bearer-authenticated request failed `401 token_invalid`
   regardless of token validity. Fixed in `app/.htaccess` (forwards the header via
   `RewriteRule ... [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]`).
2. **Client-level:** `fetchAuth()` merged headers via `{...init.headers}`, but
   `init.headers` is a `Headers` instance — spreading one yields no own enumerable
   properties, so the `Authorization` header was silently dropped before every
   `fetch()` call, independent of (1). Fixed in `app/src/api/session.ts` (merge
   through `new Headers(init.headers)`).
3. **Backend null-binding:** `$wpdb->prepare()` coerces a PHP `null` to `0` for
   `%d` / `''` for `%s` — never to SQL `NULL`. `WpdbUserProductRepository` bound a
   brand-new `UserProduct`'s `category_id: null` (matching-in-progress, by design —
   D §4) straight through `%d`, writing `0`, which violates the
   `fk_user_products_category` foreign key and crashes the request `500`. The same
   unguarded pattern was found independently in `WpdbUserProfileRepository`
   (`display_name`/`onboarding_state`) and `WpdbRefreshTokenRepository`
   (`rotated_at`/`revoked_at`) — silent wrong-value writes there, not yet a crash,
   because those columns carry no FK.
4. **Frontend duplication:** the optimistic-write → enqueue → immediate-send →
   apply-success → mark-done sequence was hand-written **five separate times**
   (`HomeScreen.tsx` ×4 — create list, add item, toggle checked, remove item —
   `AddSearchScreen.tsx` ×1) instead of going through one
   shared function — which is *why* (1)–(3) could be partially masked/unmasked
   inconsistently across "create a list" vs "add an item": they are not the same
   code path, so a fix or a bug in one does not apply to the other.

**Decision — both layers get a single, shared, mandatory path going forward**
(detail in `01` §5/§6.5, builder slices in `13`):

- [x] **Backend:** every nullable column write in `Repositories/Wpdb` goes through a
  shared null-safe binder (`NULL` literal when the value is `null`, never a raw
  `%d`/`%s` on a nullable PHP value). No repository hand-rolls this again.
- [x] **Frontend:** every optimistic mutation (current and future — lists, items,
  user-products, and anything later: profiles, photos, prices, favorites, brand
  anchors) is sent through **one shared `runMutation`/send function**, used
  identically by the immediate "try now" attempt and the background queue drain.
  No screen hand-rolls its own copy of the enqueue/send/apply-success sequence.

-----

## 15. Execution Model (how the build is actually run)

> Closed at the owner's direction (this session). The architecture phase (`00`–`11`) decided
> **what** to build; this section decides **how three actors build it** under real constraints,
> and is the canon for `12-execution-model.md` (the process) and `13-implementation-line.md` (the
> ordered Slice line). `12`/`13` elaborate; they re-decide nothing here.

**The three actors and the governing asymmetry.** The build has a **Human Owner** (cannot code or
test; reviews product *behaviour*, runs the app, provides screenshots/errors, approves product
decisions), **Claude Pro** (usage-limited — spent on planning, architecture, product decisions,
**slice design**, and **builder prompts**), and **GPT/Codex in VS Code** (implementation, tests,
debugging, code review, practical fixes). Governing rule: **every responsibility goes to the
cheapest actor who can do it correctly**, and its hard consequence — **Claude does not touch the
codebase during normal implementation**; Claude emits *text artifacts*, Codex turns them into code,
the Owner judges behaviour. Claude re-enters only for **structural** problems (architecture,
ambiguous spec, a genuinely stuck Codex), never for mechanical ones.

**The owner-confirmed choices:**

- [x] **Slice = one combined document.** The builder prompt **is** the Slice — a single
  self-contained block the Owner pastes straight into Codex (it quotes the canon it needs, so Codex
  loads no `00`–`11`). Not a separate human-spec + Codex-prompt pair. (`12 §2`)
- [x] **"Done" = two gates, both required.** A Slice closes only when **Codex's tests pass** *and*
  **the Owner has confirmed the behaviour on screen** against the Slice's acceptance criteria.
  Tests are Codex's regression net between slices; the Owner's pass is the sole place a human judges
  the product, and judges *behaviour*, never code. (`12 §3`)
- [x] **`13` is the full ordered MVP line.** The implementation document commits to **every** Slice
  from empty repo to working MVP in dependency order (six milestones M0→M5), not a
  first-milestone-then-re-slice sketch. (`13`)

**Escalation (Codex-first ladder).** Behaviour-wrong-but-runs and errors/crashes → **Codex**
(Failure-report template). Codex circling after ~2–3 tries, a bad/ambiguous Slice, or a real
architecture/product question → **Claude** (Escalation template); type-5 architecture questions
update `decisions.md` **first**, then `13`, then re-issue the Slice. Three fixed handoff templates
(Slice; Failure report; Escalation) keep context-assembly off the Owner. Full detail in `12 §5`/`§6`.

-----

*Last updated: June 2026 — **demand-first revision** + **§14 consolidation**. The demand-first model (three-layer catalog: UserProduct → category bucket → StoreOffer; broad-by-default comparison; matching-by-selection; no-admin moderation; owner-level favorites + purchase log) is now reflected across the full set `00`–`09` + `CLAUDE.md`. The decisions taken in sessions `04`–`08` are folded back into §14 (`normalized_term` normalizer; brand-token anchor; categorization on `store_products`; StoreOffer/Promotion → `price_entries`; purchase-log snapshot columns; frequently-bought 8-week/≥3 default; broad-item `basis` field; empty-bucket `200`-empty; `is_archived`; logical `user_id` refs; `schema_version` placement; 30-day refresh lineage). All `01` §14 amendments closed (name, namespace, REST `si/v1`, currency, one-domain rule, identity store, custom `hash_hmac` JWT, crawler execution). Remaining opens in §14 are host facts + a few product/ops calls (host limits / MySQL version, analytics, barcode, backup cadence, Stage-3 DB, Capacitor-vs-RN). Document set complete; ready for implementation. One wording reconciliation pending in `02` §7 (see §13 note).*

*Update — June 2026 · **`10-ux-rules.md` added** (Session 6; §§1–7 done, §§8–9 component inventory/specs next session). `10` is canonical for **screen-state and component-level UX**; `07` stays canonical for client architecture and the two-mode mechanics. Six presentational UX resolutions folded back into §14 (matching-in-progress excluded from comparison totals; cheapest-store shown with `missing_items`; Add/Search has no global catalog picker; invitations via email deep-link only; no purchase-history screen; owner-context scoping of surfaced metadata). Two new opens added to §14: brand-anchor chip label (UX **D-1**) and the sole-admin hand-off / member self-leave contract gap (**D-2**, touches `06`).*

*Update — June 2026 · **D-1 and D-2 closed** (owner-approved). **D-1:** anchored brand chip = the `brand_normalized` token, title-cased client-side (brand only; no schema; Stage-2 `brands` name swaps in with no UX change). **D-2:** family membership lifecycle closed with two additive `06` routes — `PATCH …/members/{userId}` (admin role change; not ↻ fresh token) and a widened admin-or-self `DELETE …/members/{userId}` (member self-leave; solo-leave deletes the empty family); reuses existing codes, no `v2`. Updated `10` (§3.4, §4.3/§4.5, Decision Required → resolved) and `06` (§4.2/§4.3, §6.6). One minor open remains: a multi-member `DELETE /families/{id}` dissolve.*

<!-- Test ред добавен от Claude през GitHub MCP — June 2026 -->

*Update — June 2026 · **Execution model closed (§15)** and **`12-execution-model.md` + `13-implementation-line.md` added** (§13 table extended; `11-user-flows.md` also recorded there). The architecture set `00`–`11` is complete; the build now runs on the three-actor model — Owner (eyes + product authority), Claude (scarce text-only architecting brain), Codex (abundant hands owning the codebase) — through combined **Slices** (builder-prompt-is-the-spec), a **two-gate done** (Codex tests pass + Owner confirms behaviour), a **Codex-first escalation ladder**, and three fixed handoff templates. `13` lays out the full ordered MVP Slice line (M0 spine → M1 auth → M2 lists/terms/families → M3 crawl/ingestion → M4 matching+comparison → M5 PWA ship). Next move: author and run Slices, not more architecture documents.*
