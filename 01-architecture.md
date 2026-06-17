# 01 — System Architecture

> **Load when:** starting a sprint that spans more than one module; deciding where new
> code lives; any cross-cutting change (auth, caching, domains, deployment); onboarding.
> **Depends on:** `decisions.md` (always loaded).
> **Standalone for:** component boundaries, runtime topology, data flows, project-wide
> conventions. For schema → `04` · crawler internals → `05` · endpoint specs → `06` ·
> PWA internals → `07` · stage triggers → `08`.

-----

## 1. Purpose

This document fixes the **skeleton**: the runtime containers, the layers inside the
plugin, the contracts between them, and the conventions every other document assumes.
It deliberately stops above schema and endpoint detail — those live in `04`–`07`.
Scope, stack choices and stage triggers are **not repeated** here; they live in
`decisions.md` (referenced as *D §n*).

-----

## 2. Architecture in one paragraph

Stage 1 is **two deployables plus one scheduled process**, sharing one MySQL database.
A React PWA on Cloudflare Pages is the only user-facing surface. A WordPress install on
SuperHosting hosts the `shopping-intellect` plugin, which exposes the REST API at
`/wp-json/si/v1/` and the operator UI in WP Admin. A PHP CLI entry point in the same
plugin, triggered by CPanel system cron, runs the crawlers. Everything sits behind
Cloudflare’s free tier. Business logic lives in plain-PHP service classes (D §6), so
Stages 2–3 extract pieces instead of rewriting them.

-----

## 3. Containers

```
 Users (browser / installed PWA)
        │ HTTPS
        ▼
┌──────────────────────┐          ┌─────────────────────────────────────────────┐
│ PWA · React 18       │   REST   │ WordPress + shopping-intellect plugin       │
│ Cloudflare Pages     │  JSON /  │ SuperHosting · www.<domain>                 │
│ app.<domain>         │   JWT    │ /wp-json/si/v1/…                            │
│ SW · IndexedDB ·     ├─────────►│                                             │
│ sync queue           │◄─────────┤   Api ─► Services ─► Repositories ─► MySQL  │
└──────────────────────┘          │              ▲              ▲               │
                                  │   WP Admin ──┘              │               │
┌──────────────────────┐          │                             │               │
│ CPanel system cron   ├─────────►│  bin/crawl.php ─► Crawlers ─┘               │
└──────────────────────┘   CLI    └─────────────────┬───────────────────────────┘
                                                    │ HTTP out (rate-limited)
                                                    ▼
                                      Lidl · Kaufland · Billa · Fantastico
External: Google OAuth (token verification) · Cloudflare proxy in front of BOTH origins
```

|Container      |Runs on                         |Responsibility                                        |Talks to                                       |
|---------------|--------------------------------|------------------------------------------------------|-----------------------------------------------|
|**PWA**        |Cloudflare Pages, `app.<domain>`|All user UX; offline lists; sync queue                |REST API only                                  |
|**WP + plugin**|SuperHosting, `www.<domain>`    |REST API, business logic, operator admin              |MySQL, Google OAuth                            |
|**Crawler CLI**|Same host, CPanel cron          |Fetch → parse → validate → categorize → publish prices|Chain websites, MySQL (via same Services/Repos)|
|**MySQL**      |SuperHosting (existing)         |All persistent state, `oCk_si_*` tables       |—                                              |

Container notes:

- **PWA** never touches WordPress directly — no `wp-login`, no WP cookies, no admin-ajax.
  Its entire backend surface is the `si/v1` contract. This is what makes the future
  native wrapper (D §7) and the Stage-3 backend swap (D §11) frontend-invisible.
- **WordPress** is headless for end users; the theme is irrelevant. WP Admin is reused
  as the operator console (crawler dashboard, **category-bucket** merge/split (catalog
  hygiene only, not a per-offer review step), price override, data quality — D §4/§6).
- **Identity store:** Stage 1 reuses `wp_users` for accounts (battle-tested password
  hashing + reset machinery for free). App users get a custom zero-capability role
  (`si_user`) and **no wp-admin access**; registration happens only through our REST
  endpoints. App-specific profile data lives in custom tables keyed by `user_id`. The
  `AuthProvider` / `UserRepository` seams (§7) hide this, so a Stage-2/3 standalone
  auth service is an export, not a migration.
- **Crawler CLI** runs one OS process per chain (isolation: one broken chain never
  blocks the others). Bootstraps WordPress via `wp-load.php` — CLI mode bypasses web
  `max_execution_time`, and memory limits are far higher (verify per D §14).

-----

## 4. Domain & origin layout — the one-domain rule

**Hard prerequisite: the PWA and the API must live under the same registrable
domain.** Example: `app.<domain>` (Pages custom domain, free) and `www.<domain>` (WP).

Why this is non-negotiable: the refresh token lives in an `httpOnly` cookie (D §8).
Subdomains of one registrable domain are *same-site*, so the browser sends that cookie
on `fetch(..., {credentials:'include'})` calls reliably. If the PWA stayed on
`*.pages.dev`, the cookie would be *cross-site* (third-party) — exactly the category
Safari already blocks and Chrome is phasing out. Sessions would break silently and
inconsistently across browsers.

Consequences:

- Both hostnames are proxied through Cloudflare (already planned, D §5) — one
  dashboard, shared DDoS protection, TLS everywhere.
- CORS is still required (different *origins*): the plugin answers preflight `OPTIONS`
  and sends `Access-Control-Allow-Origin: https://app.<domain>` (exact match, never
  `*`) with `Allow-Credentials: true`. Header details in `06`.
- Cloudflare edge cache: static PWA assets cached aggressively; `/wp-json/si/v1/*`
  bypasses cache (authenticated, personalized). Public promo endpoints *may* get a
  short edge TTL later — optional optimization, not assumed.

-----

## 5. Inside the plugin — layers and the dependency rule

```
/wp-content/plugins/shopping-intellect/
  shopping-intellect.php      # Bootstrap: autoloader, hook + REST registration
  bin/
    crawl.php                 # CLI entry (cron): --chain=lidl --mode=full|delta
    prune.php                 # CLI retention/cleanup job
  src/
    Api/                      # REST controllers — thin HTTP↔DTO↔Service glue
    Services/                 # Business logic — plain PHP, WP-FREE
    Repositories/
      Contracts/              # Interfaces (WP-free)
      Wpdb/                   # $wpdb implementations (WP-coupled)
    Crawlers/                 # AbstractCrawler + one class per chain
    Models/                   # DTOs & value objects (Money, RawOffer, …)
    Support/                  # Autoloader (PSR-4, no Composer), Config, Clock,
                              # Logger, HttpClient contract + WpHttpClient
    Admin/                    # WP Admin pages (operator UI)
  assets/                     # Admin-only JS/CSS
```

PHP namespace: `ShoppingIntellect\`. Structure extends the CityPlay pattern (D §6)
additively — `bin/`, `Support/`, and the `Contracts/Wpdb` split are the only additions.

### The dependency rule

```
     may touch WP                 WP-FREE ZONE                  may touch WP
┌──────────────────┐   ┌───────────────────────────────┐   ┌──────────────────┐
│ Api controllers  │──►│ Services                      │◄──│ Admin pages      │
│ (REST glue)      │   │ PriceComparison · ShoppingList│   │ (operator UI)    │
└──────────────────┘   │ Family · Matching · Ingestion │   └──────────────────┘
                       │ Promotion · Auth(domain part) │
┌──────────────────┐   └───────────────┬───────────────┘
│ Crawlers         │──RawOffer DTOs──► │ depends on interfaces only
│ (per chain)      │   ┌───────────────▼───────────────┐
└────────┬─────────┘   │ Repositories/Contracts        │
         │ HttpClient  ├───────────────────────────────┤
         │ interface   │ Repositories/Wpdb ($wpdb)     │──► MySQL oCk_si_*
         ▼             └───────────────────────────────┘
   WpHttpClient (now) / CurlHttpClient (Stage-2 VPS)
```

Rules, in order of importance:

1. **Services and Models never call WordPress functions.** They receive everything
   through constructor-injected interfaces (`Repositories/Contracts`, `HttpClient`,
   `Clock`, `Logger`). They are unit-testable without a WP install. This single rule
   is what makes the Stage-3 extraction a move, not a rewrite (D §6).
1. **Only `Repositories/Wpdb` may use `$wpdb`.** Prepared statements exclusively.
   **Nullable columns go through a shared null-safe binder, never a raw `%d`/`%s`
   placeholder.** `$wpdb->prepare()` coerces a PHP `null` argument to `0` for `%d` and
   `''` for `%s` — never to SQL `NULL`. Any model field typed `?int`/`?string`/`?DateTime`
   (e.g. `UserProduct::categoryId`, `brandAnchor`; `UserProfile::displayName`,
   `onboardingState`; `RefreshToken::rotatedAt`, `revokedAt`) that is bound directly with
   `%d`/`%s` will silently write the wrong value — `0` against a foreign key crashes the
   request; against a plain nullable column it just corrupts the row silently. **Found in
   three repositories independently (`WpdbUserProductRepository`,
   `WpdbUserProfileRepository`, `WpdbRefreshTokenRepository`) because each hand-wrote its
   own `INSERT`/`UPDATE` — the fix is one shared helper in `Repositories/Wpdb`, not a
   per-class patch.**
1. **Crawlers don’t write to the DB.** They fetch and parse, emitting normalized
   `RawOffer` DTOs to `IngestionService`, which validates, categorizes and persists.
   Crawlers depend on the `HttpClient` interface, not on WP’s HTTP API directly —
   because “move crawlers to a VPS” is a *named* Stage-2 trigger (D §11), the swap
   must already have a seam.
1. **Api and Admin contain zero business logic and zero SQL.** Controllers translate
   HTTP to DTOs, enforce auth, call a service, map the result. Admin pages render and
   call the same services — never a parallel code path.
1. **Categorization is a service, not part of crawling.** Crawler code churns when
   sites change; **categorization** — fitting each `StoreOffer` into a `CategoryBucket`
   (fuzzy → barcode → ML, D §4) — improves independently behind `MatchingService`. This
   is *product-to-category*, not product-to-product identity (D §4): it is deliberately
   **lenient**, because a debatable offer in a roughly-right bucket costs nothing when
   the user sees every candidate and judges by eye (D §10). Stored raw offers can be
   *re-categorized* offline when the algorithm improves — without re-crawling.

-----

## 6. Key data flows

### 6.1 App boot & authentication

1. PWA shell loads from SW cache (instant, offline-capable).
1. Silent `POST /auth/refresh` — the same-site `httpOnly` cookie authenticates it; a
   short-lived (~15 min) access JWT returns and is held **in memory only** (never
   `localStorage` — XSS containment).
1. JWT carries `user_id`, `family_ids[]`, `roles[]` (D §8) → no DB hit per request.
   Staleness trade-off accepted: family membership changes propagate at next refresh
   (≤15 min); family-mutation endpoints respond with a fresh token to shortcut this.
1. Google login: PWA obtains an authorization code → `POST /auth/google` → backend
   verifies with Google, finds-or-creates the `wp_users` record, issues the same
   JWT + refresh pair. Email/password hits `POST /auth/login` with identical output —
   the frontend cannot tell providers apart (D §8 provider abstraction).

### 6.2 Basket comparison (the core read path)

PWA → `lists/{id}/comparison` → controller → `PriceComparisonService` →
`PriceRepository` (indexed queries: current prices for each item’s `CategoryBucket` —
**every** in-bucket `StoreOffer` — across the 4 stores) → response per D §10. Each list
item is a `UserProduct` resolving to its category bucket (or to a brand-anchored offer
where the user opted in — D §4); the response lists **all** in-bucket candidates per
store with promos marked — *broad by default*, not a single cheapest — plus per-store
basket totals, the cheapest store, and availability/promo flags. A **broad** item’s
contribution to a per-store total uses a representative in-category price (**proposed
default: the cheapest in-category offer per store** — flagged *confirm* in D §10/§14,
not settled here); a **brand-anchored** item contributes only its brand’s offer.

**Invariant:** the comparison reads only *published, validated current prices*. It
never touches raw crawl data and never makes an external call at request time — the
proactive-crawl decision (D §4) exists precisely to guarantee this path is pure MySQL.

### 6.3 Weekly crawl (Thursday night, per chain)

```
cron ─► GET_LOCK("si_crawl_<chain>") ─► fetch pages ─► parse ─► normalize
                                                                  │ RawOffer[]
   publish ◄── upsert prices/promos ◄── categorize → bucket ◄── validate
      │                                  (MatchingService)        (rules D §4)
      └─► crawl_run finalized · promo transients invalidated · email alert on failure
```

- One cron entry per chain, staggered by ~1h, each its own process. Failure isolation
  by construction.
- `GET_LOCK` (MySQL named lock) prevents overlap with a still-running previous run or
  the daily delta — no filesystem permissions to fight on shared hosting.
- The run is **chunked and resumable**: progress is persisted in the
  `crawl_runs` row, so a host-side kill resumes instead of restarting.
- Validation auto-publishes per D §4 (reject / ceiling / >50 % deviation flag);
  `data_quality_score` + `source_url` stored per entry.
- **Categorization is lenient and non-blocking** (D §4): `MatchingService` fits each
  `StoreOffer` into a `CategoryBucket`, but an offer it can’t confidently bucket is
  **still validated and published** — its price exists; it just isn’t basket-visible
  until a bucket is assigned. No admin queue gates ingestion.
- Raw offers are persisted (parsed fields + raw name + source hash) for audit and
  offline re-categorization, pruned after **8 weeks** by `bin/prune.php` — shared-hosting
  disk is finite.

### 6.4 Daily delta check

Lightweight cron: GET each chain’s promo landing page → hash → compare with stored
hash → on change, trigger a partial run for that chain only (D §4 schedule).

### 6.5 Offline edits & sync

List items — **and the `UserProduct`s they create at write time** (a term is born the
moment it is first typed into a list, often offline — D §4/§9) — get a **client-generated
UUID** (column `client_uuid`), so replays are idempotent and offline-created entities
merge without ID collisions. The SW
background-sync queue replays mutations on reconnect; conflicts resolve last-write-wins
on server `updated_at` (server clock is authoritative), surfaced in UI as
“updated X sec ago” (D §9). Details in `07`.

**One mutation pipeline, no per-screen duplicates.** Every optimistic write (create a
list, create an item, toggle checked, favorite, anchor a brand — present and future)
queues through and is *sent* by **one shared function**, not a bespoke
enqueue-then-immediately-also-fetch block written inline in each screen's handler. The
immediate "try now" attempt and the background queue drain (on reconnect/focus) must
call the **same** send function — never two parallel implementations of "make this
mutation happen" that can drift out of sync with each other and fail independently.
(Found duplicated five times across `HomeScreen.tsx`/`AddSearchScreen.tsx` in the first
implementation — one screen's create path got exercised and partially hardened while a
near-identical sibling carried its own, separately-broken copy.)

-----

## 7. Contracts — the extraction seams

|Seam              |Contract                         |Stage-1 implementation                                   |Swap scenario (trigger in D §11)                                 |
|------------------|---------------------------------|---------------------------------------------------------|-----------------------------------------------------------------|
|Frontend ↔ backend|REST `si/v1` (spec in `06`)      |WP REST API                                              |Stage 3: standalone API serves the *same* contract; PWA untouched|
|Logic ↔ storage   |`Repositories/Contracts`         |`Repositories/Wpdb`                                      |PDO implementations on VPS / managed DB                          |
|Crawlers ↔ network|`HttpClient`                     |`WpHttpClient`                                           |`CurlHttpClient` when crawlers move to VPS                       |
|Auth              |`AuthProvider` + fixed JWT claims|WP users + in-plugin custom `hash_hmac` JWT issuer (D §8)|Standalone auth service issuing identical claims                 |
|AI (Stage 2+)     |Provider abstraction             |—                                                        |Gemini free tier, same pattern as prior project                  |

The JWT **claim set is the contract**, not the issuer. The REST **response shapes are
the contract**, not WordPress. Guard these two and every box behind them is swappable.

-----

## 8. Project-wide conventions (binding for all docs and code)

- **Time.** Store UTC in DB; convert at the edges. Business calendar is
  `Europe/Sofia`. A **promo week** runs Thu 00:00 → Wed 23:59 Sofia time (D §4).
  Prices/promos carry explicit `valid_from`/`valid_to`; “current” is derived, never a
  flag someone forgets to flip.
- **Money.** Integer **euro cents** in a `Money` value object — never floats.
  Bulgaria is in the eurozone since 1 Jan 2026; during the 2026 dual-display period
  crawlers may still encounter BGN figures → convert at the fixed rate
  **1.95583 BGN/EUR**, round half-up to the cent, and flag `converted_from_bgn` on the
  raw offer for audit. A `currency` column exists but is constant `EUR` in Stage 1
  (cheap future-proofing for D §2 Stage 3).
- **IDs.** Server: `BIGINT UNSIGNED` auto-increment. Client-originated entities
  (offline list items and the `UserProduct`s they create) additionally carry
  `client_uuid` (UUIDv4).
- **Product & term names.** Store-side product names are kept as crawled (Bulgarian),
  plus a `normalized_name` column (lowercased, unit/weight extracted) used for search
  and fuzzy **categorization** of offers into buckets. A user’s own term
  (`UserProduct`, D §4/§9) is kept as typed plus a `normalized_term` column, used to
  dedupe the term per owner and to auto-attach it to a `CategoryBucket`. *How* a term
  is normalized (case-folding, trimming, light Bulgarian stemming) is an **open
  question** (D §14) — detail in `04`.
- **Naming.** PHP namespace `ShoppingIntellect\` · REST namespace `si/v1` · tables
  `oCk_si_*` (resolved: `$wpdb->prefix` + `si_`, D §6/§14).
- **Errors.** One JSON error envelope with stable machine-readable codes — spec in
  `06`.
- **API versioning.** Additive changes within `v1`; breaking changes mean a `v2`
  namespace served in parallel.

-----

## 9. Cross-cutting concerns

**Config & secrets.** Secrets (`SI_JWT_SECRET`, Google client ID/secret) are
`wp-config.php` constants — never in the DB, never in the repo. Operator-tunable
values (rate limits, crawl toggles, category price ceilings) are WP options with an
Admin UI.

**Observability.** `oCk_si_crawl_runs` is the source of truth for crawler
health (status, counts, error summary, resume state) and powers the Admin dashboard;
failures trigger `wp_mail` alerts. A public `GET /wp-json/si/v1/health` reports app
liveness + age of last successful crawl per chain → monitored by a free UptimeRobot
check. PHP fatals go to the host’s `error_log`. No external APM until a Stage-2
trigger justifies it.

**Caching (Stage 1).** Cloudflare caches the static PWA. WP transients (MySQL-backed)
cache only expensive *cross-user* reads — promo browse lists per chain/week —
invalidated at crawl completion. Personalized endpoints (lists, comparison) are
uncached: indexed SQL is fast enough at 0–100 users, and correctness beats
micro-latency. Redis enters only on the D §11 trigger.

**Scheduling & locking.** CPanel system cron (real cron, D §5):

|Job                                     |When (Sofia)                     |Entry                                |
|----------------------------------------|---------------------------------|-------------------------------------|
|Full crawl, per chain                   |Thu 01:00 / 02:00 / 03:00 / 04:00|`bin/crawl.php --chain=X --mode=full`|
|Delta check, all chains                 |daily 06:00                      |`bin/crawl.php --mode=delta`         |
|Prune (raw offers, logs, expired tokens)|Sun 05:00                        |`bin/prune.php`                      |

All runs guard with MySQL `GET_LOCK("si_crawl_<chain>")`.

**Security.** Short-lived access JWT in memory; rotating refresh token in `httpOnly`
`Secure` cookie (§4 makes this work). Rate-limit auth endpoints (transient counters
per IP+identifier). Prepared statements only. Exact-origin CORS. App users hold a
zero-capability role and are blocked from `wp-admin`; XML-RPC and other unused WP
surface disabled. Hardening checklist in `09`.

**Backups.** SuperHosting’s backups, plus a weekly `mysqldump` of `oCk_si_*`
to the home directory via cron; periodic manual off-host download. Risk treatment in
`09`.

-----

## 10. Deployment & environments

- **Frontend:** separate repo → Cloudflare Pages git integration. Auto-deploy on
  `main`; free preview deployment per branch.
- **Backend:** plugin repo checked out on the server; deploy = SSH `git pull` on a
  tagged release + run migrations. Scripted, deliberately boring.
- **Migrations:** versioned PHP migration files run by an idempotent runner
  (activation hook + CLI command); `schema_version` stored in options. Detail in `04`.
- **Environments:** local (any LAMP/DDEV setup) + production. Optional staging
  subdomain on the same hosting before risky releases. A seed script loads the
  **~20–30 popular category buckets** (milk, bread, eggs, … — D §4) into any
  environment so day-one demand lands somewhere sensible; everything beyond that fills
  lazily on demand (replacing the earlier ~200-hand-curated-staples seed).

-----

## 11. Deliberate absences

|Absent                             |Until                                                                                       |
|-----------------------------------|--------------------------------------------------------------------------------------------|
|Message queue / workers            |Crawlers destabilize WP → VPS move (D §11) reconsiders                                      |
|Real-time sync (WebSockets/Mercure)|Stage 2, per D §9                                                                           |
|Redis                              |API p95 > 500 ms trigger (D §11)                                                            |
|Composer & external PHP packages   |Constraint, not debt: built-in DOM/XPath, cURL/WP-HTTP, `hash_hmac` JWT cover Stage 1 (D §6)|
|Docker in production               |Shared hosting; local Docker is fine                                                        |
|Microservices / GraphQL / SSR      |No trigger exists; REST + SPA-PWA suffice                                                   |
|Search engine (Elastic etc.)       |MySQL `LIKE`/FULLTEXT on `normalized_name`/`normalized_term` suffices at this catalog size  |
|Multi-region / HA                  |Stage 3 (D §11)                                                                             |

-----

## 12. Failure modes & graceful degradation

|Failure                   |Behavior                                                                                                                         |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------|
|Backend down              |PWA shell + cached lists still open and edit offline (SW + IndexedDB); mutations queue; comparison unavailable with clear message|
|One chain’s crawler broken|Other chains unaffected (process isolation); its prices age visibly — “updated X days ago” (D §4); admin alerted                 |
|Chain blocks us           |Same as above + anti-bot fallback decision tree (D §5, Stage 1.5)                                                                |
|Host kills a long CLI run |Resumable run state in `crawl_runs`; next invocation continues                                                                   |
|Cloudflare Pages outage   |Returning users open the SW-cached app shell anyway                                                                              |
|Garbage in crawl data     |Validation rejects/flags per D §4; raw offers retained for forensic re-categorization                                            |

The offline-first decision (D §7) is also an availability feature: the most frequent
user action — using a list in-store — survives a total backend outage.

-----

## 13. Component → document map

|Architecture element                                                   |Detail lives in          |
|-----------------------------------------------------------------------|-------------------------|
|Entities, bounded contexts                                             |`02-domain-model.md`     |
|Per-stage technology choices                                           |`03-tech-stack.md`       |
|Tables, indexes, migrations, raw-offer staging                         |`04-database.md`         |
|AbstractCrawler, per-chain parsers, validation, categorization pipeline|`05-crawlers.md`         |
|Endpoint specs, JWT internals, CORS headers, rate limits               |`06-api-auth.md`         |
|SW, IndexedDB, sync queue, Capacitor path                              |`07-frontend.md`         |
|Stage triggers & extraction runbooks                                   |`08-scaling-migration.md`|
|Risk register, cost model, hardening checklist                         |`09-risks-costs.md`      |

-----

## 14. Amendments to fold back into decisions.md

**Status: folded back into `decisions.md` (Session 2).** Recorded here for provenance.

1. **✅ § Identity / §6 — Name cascade:** project name **Shopping Intellect**; plugin dir
   `shopping-intellect/`; PHP namespace `ShoppingIntellect\`; REST namespace **`si/v1`**
   (replaces `groceryapp/v1`). Resolves open question 1 in §14.
1. **✅ §6 — Table prefix (resolved):** `$wpdb->prefix` + `si_`, resolving to
   `oCk_si_` on the current install (`$table_prefix = 'oCk_'`). Recorded in D §6/§14.
1. **✅ §5 — One-domain rule (new):** PWA and API must share one registrable domain
   (`app.<domain>` + `www.<domain>`), both proxied by Cloudflare; otherwise the
   refresh-cookie flow breaks (this doc, §4).
1. **✅ §8 — Identity store:** Stage 1 uses `wp_users` behind `AuthProvider` /
   `UserRepository`; app users get a zero-cap `si_user` role, no wp-admin. Access JWT
   ≈ 15 min, in memory; rotating refresh in `httpOnly` cookie.
1. **✅ §8 — JWT implementation (closed Session 2):** custom `hash_hmac` issuer/verifier,
   **not** a WP-JWT plugin — keeps the no-Composer constraint and full control of the
   claim-set contract. Resolves open question 4 in D §14.
1. **✅ §4 — Currency (new):** prices stored as integer **euro cents**; BGN figures met
   during the 2026 dual-display period convert at fixed 1.95583 and are flagged
   `converted_from_bgn`.
1. **✅ §4/§5 — Crawler execution:** PHP CLI bootstraps `wp-load.php`; one process per
   chain; MySQL `GET_LOCK` concurrency guard; chunked + resumable runs; raw offers
   retained 8 weeks then pruned.

-----

*Last updated: June 2026 · Session 1 content; §14 amendments folded back in Session 2 ·
**demand-first re-sync** (this revision): §5 rule 5 reframed from product-to-product
identity to lenient `StoreOffer` → `CategoryBucket` categorization; §6.2 comparison now
runs over `UserProduct`s / category buckets and returns **all** in-bucket candidates per
store (broad by default); §6.3 crawl flow ends in “categorize into bucket” (lenient,
non-blocking — no admin queue); §6.5 `UserProduct`s are also born offline and carry
`client_uuid`; §8 adds `normalized_term` beside `normalized_name`; §10 seed is ~20–30
category buckets, not ~200 staples; §3/§11/§12/§13 “matching / re-match” →
“categorization / re-categorize”. Fixed conventions unchanged (Money integer euro cents,
1.95583, `si/v1`, UTC/Sofia, `Validity`, `BIGINT`, `client_uuid`); demand-first open
questions left to D §14, not invented here. (Opus 4.8.)*