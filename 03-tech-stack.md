# 03 — Tech Stack

> **Load when:** choosing a library or version; deciding whether a tool is allowed yet;
> evaluating whether a Stage-2/3 trigger has fired; onboarding someone to *what runs where*.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton).
> **Standalone for:** the technology choices per stage and the trigger that admits each
> deferred tool. For stage-migration *runbooks* → `08` · cost figures → `09` · why the
> *architecture* is shaped this way → `01`.

-----

## 1. Purpose

This document is the **inventory and the gating rules**: every technology in the stack,
which stage it belongs to, and — for anything not in Stage 1 — the *named trigger* that
admits it (D §11). The governing principle is D §5 / D guiding-principle 1: **zero
additional infrastructure cost in Stage 1, and no paid or heavy tool introduced
preemptively** — each waits behind a concrete bottleneck. This document does not
re-argue the architecture (arch.) or re-list scope (D §1); it answers “*what*, at *what
version*, admitted *when*.”

Versions are pinned only where actually decided. Where a version is not yet fixed, this
document says so rather than inventing one.

-----

## 2. The gating principle

Stage 1 is built entirely on **already-paid-for and free-tier** resources (D §5). Every
other tool in this document is **deferred behind a trigger**, not scheduled by date. The
rule from D §11, restated as policy:

> A deferred technology is introduced **only when its named bottleneck actually fires** —
> never preemptively, never “while we’re in there anyway.”

This keeps a two-person side project from paying (in money or maintenance) for capacity
it does not yet need, and it keeps the dependency surface small enough to reason about.

-----

## 3. Stage 1 — the validated baseline (0–100 users, €0 additional)

Everything here either already exists (SuperHosting, WordPress expertise) or is free
tier. Nothing in this section is optional or conditional.

### Backend

|Tool         |Version                       |Note                                                |
|-------------|------------------------------|----------------------------------------------------|
|PHP          |8.x (assume; verify per D §14)|CLI mode for crawlers bypasses web limits (arch. §3)|
|WordPress    |current stable                |Headless container, not a framework (D §6, arch. §3)|
|MySQL        |SuperHosting default          |All persistent state; `oCk_si_*` tables     |
|Custom plugin|`shopping-intellect/`         |PSR-4 autoload, **no Composer** (§3.1)              |

Namespace `ShoppingIntellect\`, REST namespace `si/v1`, `Money` as integer euro cents
(BGN → 1.95583, `converted_from_bgn`) — all fixed in arch. §8, **not re-decided here**.

#### 3.1 Why no Composer (a constraint, not debt)

D §6 and arch. §11 commit to PSR-4 autoloading **without** Composer. This is a deliberate
choice, carried over from the proven CityPlay plugin pattern, and it holds because
Stage-1 needs are met by PHP’s standard library:

- **HTTP out:** the `HttpClient` interface, implemented by `WpHttpClient` now (WP HTTP
  API), swappable for `CurlHttpClient` on a Stage-2 VPS (arch. §7).
- **HTML parsing:** built-in DOM + XPath (no Goutte/Symfony DomCrawler needed).
- **JWT:** `hash_hmac` signing/verification by hand — the claim set, not a library, is
  the contract (arch. §7).
- **Autoloading:** a small hand-written PSR-4 autoloader in `Support/`.

The payoff: no `vendor/` to deploy or audit on shared hosting, no transitive-dependency
supply-chain surface, and a deploy that is just `git pull` + migrations (arch. §10).
Composer is admitted only if a genuinely non-trivial library becomes necessary — a
decision to record in `decisions.md` if it ever fires, not a standing option.

### Frontend (D §7)

|Tool                      |Version       |Role                                                          |
|--------------------------|--------------|--------------------------------------------------------------|
|React                     |18            |UI                                                            |
|Vite                      |current       |Build / dev server                                            |
|TypeScript                |current       |Type safety across the REST contract                          |
|Tailwind CSS              |current       |Styling                                                       |
|Zustand                   |current       |Client state (lists, UI)                                      |
|TanStack Query            |current       |Server-state cache over the `si/v1` API                       |
|Service Worker + IndexedDB|native browser|Offline-first lists + background-sync queue (D §7, arch. §6.5)|

React is pinned at **18** (decided, D §7). The surrounding toolchain versions are *not*
individually pinned yet — adopt current stable at scaffold time and record the lockfile;
this document will not invent numbers that haven’t been chosen. Capacitor is **not**
installed in Stage 1 — it belongs to Stage 2 (§4) even though it shapes today’s
PWA-first choices.

### Infrastructure (all €0, D §5)

|Component         |Host / service                                               |Cost|
|------------------|-------------------------------------------------------------|----|
|WP backend + MySQL|SuperHosting (existing)                                      |€0  |
|Crawler scheduling|CPanel **system** cron (real cron, not WP pseudo-cron — D §5)|€0  |
|Frontend PWA      |Cloudflare Pages                                             |€0  |
|CDN / DDoS / TLS  |Cloudflare free tier (fronts **both** origins — arch. §4)    |€0  |
|Uptime monitoring |UptimeRobot free check on `/health` (arch. §9)               |€0  |

The **one-domain rule** (PWA + API under one registrable domain — arch. §4) is an
infrastructure constraint that lives here too: it is why both hostnames sit behind
Cloudflare, and it is a prerequisite, not a later optimisation.

### Stage-1 testing & local dev

- **Local:** any LAMP / DDEV setup; local Docker is fine (production is shared hosting,
  so Docker stops at the laptop — arch. §11).
- **Unit testing:** WP-free Services and Models are unit-testable without a WP install
  (the whole point of the dependency rule, arch. §5). The demand-first services that
  carry the most logic — lenient **categorization** (`StoreOffer` → bucket) and
  `PriceComparisonService` — are exactly the WP-free classes this makes testable in
  isolation. PHPUnit is the natural fit; pin at scaffold time.

-----

## 4. Stage 2 — early growth (100–3,000 users), each tool trigger-gated

Nothing below is adopted on a schedule. Each row is dormant until its trigger from D §11
fires. WordPress **stays** as backend + admin + marketing throughout Stage 2 — these are
extractions *around* it, not a replacement of it.

|Technology                              |Admitted **only when** (trigger, D §11)            |What it does                                                                                            |Cost band (see `09`)|
|----------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------------------|--------------------|
|**Standalone PHP CLI / Python on a VPS**|Crawlers destabilise WP                            |Crawlers move off the WP host; `HttpClient` seam already exists (arch. §7) → `CurlHttpClient`           |~€5/mo              |
|**Redis** (object cache)                |API **p95 > 500 ms** under load                    |Caches expensive cross-user reads; replaces WP transients (arch. §9)                                    |free/low            |
|**Read replica / managed DB (early)**   |WP DB connections maxed                            |Offload reads; precursor to the Stage-3 managed DB                                                      |low                 |
|**Firebase Cloud Messaging**            |Push notifications actually needed                 |Push to the (now Capacitor-wrapped) app                                                                 |free tier           |
|**Capacitor**                           |Native app shipped (Stage 2 work item, D §7)       |Wraps the **existing** React PWA for App Store / Play Store; adds camera (barcode) + push               |build-time only     |
|**Gemini (free tier)**                  |AI features requested (D §11)                      |First AI provider, **behind the AI provider abstraction** (arch. §7) — same pattern as the prior project|free tier           |
|**ScrapingBee / Apify**                 |A crawler is **actually blocked** (Stage 1.5, D §5)|Anti-bot fallback; introduced reactively, per chain, not preemptively                                   |~€5–20/mo           |

Two of these deserve emphasis because they are easy to adopt too early:

- **Redis is not a default.** At 0–100 users, indexed SQL on personalised endpoints is
  fast enough and *correctness beats micro-latency* (arch. §9). Redis waits for the
  measured p95 trigger.
- **The anti-bot fallback is reactive.** ScrapingBee/Apify is introduced the day a
  specific chain blocks us — not “to be safe” (D §5). Proxies cost money and complexity;
  most crawls won’t need them.

The seams that make these swaps cheap (`HttpClient`, `Repositories/Contracts`,
`AuthProvider`, the AI provider abstraction) already exist in Stage 1 by construction —
see arch. §7. Stage 2 *uses* the seams; it doesn’t cut new ones. Note that the category
buckets also **mature organically** through Stage 2 (D §11) — that is additive data
growth, not a technology to adopt, so it appears in no table here.

-----

## 5. Stage 3 — scale (3,000+ users)

The big structural move: a **standalone REST API service** takes over application logic
by **reusing the same WP-free Service classes** (D §6, D §11, arch. §7), and WordPress is
demoted to CMS / marketing / SEO. Because the service classes never depended on WordPress
(arch. §5 rule 1), this is a *move*, not a rewrite.

|Technology                                         |Admitted when                              |Note                                                                              |
|---------------------------------------------------|-------------------------------------------|----------------------------------------------------------------------------------|
|**Standalone PHP API service**                     |Stage 3 (sustained scale beyond WP comfort)|Same Services/Repos; `Repositories/Wpdb` → PDO implementations (arch. §7)         |
|**Managed database** (PlanetScale / Supabase / RDS)|Stage 3 (D §11)                            |Replaces SuperHosting MySQL; HA, backups, scaling — **specific provider TBD**     |
|**Capacitor or React Native apps**                 |Stage 3                                    |Full RN migration only if performance becomes a *documented* user complaint (D §7)|
|**ML-assisted categorization**                     |Stage 3 (D §4 Phase 3)                     |Phase 3 of `StoreOffer`→bucket categorization; fuzzy + barcode suffice until here |
|**Multi-country / i18n / multi-currency**          |Stage 3 (D §2)                             |`currency` column already present (arch. §8) makes this additive                  |
|**Multi-region / HA**                              |Stage 3                                    |Out of scope until here (arch. §11)                                               |

The Stage-3 database provider is genuinely **undecided** (PlanetScale, Supabase and RDS
are all candidates per D §11) — recorded here as open, not pre-selected. Likewise the
apps decision (Capacitor wrap vs full React Native) stays contingent on measured
performance, not chosen in advance.

-----

## 6. Deliberately absent until a trigger fires

A consolidated view of what is **not** in the stack and the gate each waits behind. This
mirrors arch. §11 but reads it as a *procurement* list — when do we actually pull each in.

|Technology                   |Status|Gate that admits it                                                              |
|-----------------------------|------|---------------------------------------------------------------------------------|
|Composer / `vendor/`         |Absent|Only if a non-trivial library becomes necessary (§3.1)                           |
|Redis                        |Absent|API p95 > 500 ms (D §11)                                                         |
|Firebase (FCM)               |Absent|Push notifications needed (D §11)                                                |
|ScrapingBee / Apify          |Absent|A crawler is actually blocked — Stage 1.5 (D §5)                                 |
|Gemini / any AI provider     |Absent|AI features requested (D §11); behind abstraction                                |
|ML categorization model      |Absent|Stage 3 / Phase 3 (D §4); fuzzy + barcode categorization suffice first           |
|VPS                          |Absent|Crawlers destabilise WP (D §11)                                                  |
|Managed DB                   |Absent|Stage 3 / DB connections maxed (D §11)                                           |
|Message queue / workers      |Absent|VPS move reconsiders (arch. §11)                                                 |
|WebSockets / Mercure         |Absent|Real-time sync — Stage 2 (D §9)                                                  |
|Elastic / search engine      |Absent|MySQL `LIKE`/FULLTEXT on `normalized_name`/`normalized_term` suffices (arch. §11)|
|Docker in production         |Absent|Shared hosting; local Docker is fine (arch. §11)                                 |
|GraphQL / SSR / microservices|Absent|No trigger exists; REST + SPA-PWA suffice (arch. §11)                            |

The discipline this table encodes is the whole point: a side project that adds tools only
on evidence stays cheap to run and small enough for two people to hold in their heads.

-----

## 7. Version-decision status (so nobody invents numbers)

|Decided & pinned                                |Not yet pinned — adopt current stable at scaffold, then record    |
|------------------------------------------------|------------------------------------------------------------------|
|React **18** (D §7)                             |Vite, TypeScript, Tailwind, Zustand, TanStack Query versions      |
|PHP **8.x** family (verify exact on host, D §14)|Exact MySQL version (SuperHosting default — confirm, D §14)       |
|BGN→EUR rate **1.95583** (arch. §8)             |PHPUnit version                                                   |
|—                                               |Stage-3 managed-DB provider (PlanetScale / Supabase / RDS — D §11)|

Open host-side confirmations still tracked in D §14: `memory_limit` /
`max_execution_time` for PHP CLI, and the WP-JWT plugin-vs-custom call (resolved in
favour of the custom `hash_hmac` issuer — arch. §7, D §8). Demand-first also opens
catalog-shaping questions tracked in D §14 (UserProduct term normalization, brand
representation for opt-in anchoring, broad-item basket contribution, “frequently bought”
window) — these are *modelling/product* decisions for `02`/`04`, not technology choices,
so they pin no version here.

-----

## 8. Stack → document map

|Topic                                                          |Detail lives in          |
|---------------------------------------------------------------|-------------------------|
|Why each tool fits the architecture                            |`01-architecture.md`     |
|Contexts & layers each tool serves (incl. demand-first catalog)|`02-domain-model.md`     |
|Tables, indexes, migration runner                              |`04-database.md`         |
|Crawler libraries (DOM/XPath, HttpClient)                      |`05-crawlers.md`         |
|Categorization (`StoreOffer`→bucket) pipeline                  |`05-crawlers.md`         |
|JWT (`hash_hmac`) internals, CORS                              |`06-api-auth.md`         |
|PWA / SW / IndexedDB / Capacitor detail                        |`07-frontend.md`         |
|Stage-migration runbooks & triggers                            |`08-scaling-migration.md`|
|Per-stage cost figures                                         |`09-risks-costs.md`      |

-----

*Last updated: June 2026 · Session 2 of 6 (Opus 4.8, High effort, Thinking OFF) ·
**demand-first re-sync** (light): catalog wording aligned to the three-layer model —
matching is now lenient `StoreOffer`→bucket **categorization** (ML phase deferred to
Stage 3), search indexes on `normalized_name`/`normalized_term`, and the stack→document
map reflects contexts rather than a single canonical product. Technology choices,
versions and triggers are unchanged.*