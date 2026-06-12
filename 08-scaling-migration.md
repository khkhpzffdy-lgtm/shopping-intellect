# 08 — Scaling & Migration

> **Load when:** a Stage-2/3 trigger is firing or suspected; planning an extraction;
> moving the database; onboarding someone to *how the system grows*.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the seams) ·
> `03-tech-stack.md` (the trigger-gated tools).
> **Standalone for:** the Stage 1→2→3 trigger sequence and the per-trigger extraction
> runbooks. For *why* the seams exist → `01 §7` · which tool/version each trigger admits
> → `03 §4/§5` · cost of each move → `09` · schema, migration-runner & `schema_version`
> mechanics → `04 §6` · crawler internals that relocate → `05`.

-----

## 1. Purpose & the one invariant

This document is the **runbook layer**. It does not decide *whether* to grow or *what*
tools to adopt — that is `decisions.md §11` and `03` — it specifies *how* each
already-named extraction is executed against a seam that **already exists in Stage 1**.
The single governing invariant, restated so every runbook inherits it:

> **Migration is incremental and additive. Each stage reuses the prior stage’s
> artifacts. Nothing here is a rewrite.** (D §11, arch. §7)

And the gating discipline from `03 §2`, restated as the entry condition for *every*
runbook below:

> A deferred technology is extracted **only when its named bottleneck actually fires** —
> never preemptively, never “while we’re in there anyway.” (03 §2, D §11)

Two consequences shape everything that follows:

1. **Every runbook’s precondition is already true.** The seam was cut by construction in
   Stage 1 (arch. §5/§7), so each extraction is a *swap behind an interface*, not new
   architecture. The shape is always the same:

```
 Stage 1 (seam already cut)            trigger fires          Stage 2/3 (impl swapped)
   Service ─► Interface ─► WpImpl        ════════►       Service ─► Interface ─► NewImpl
             (unchanged)   (default)                              (unchanged)   (VPS / Redis /
                                                                                 PDO / FCM / …)
```

The `Service` never changes; the `Interface` never changes; only the implementation
behind it changes. That is the additive invariant made operational.

1. **Runbooks are independently triggerable.** They are *not* a sequence. Firing one does
   not oblige any other. Several commonly arrive together (§3.6), but each fires on its
   own measured condition.

This document introduces **no new technology choices** and **does not re-decide** the
architecture or the schema. Where a value is genuinely undecided (the Stage-3 managed-DB
provider; Capacitor vs React Native), it is referenced as **open**, not pre-selected.

-----

## 2. The three stages as a frame (reference, not re-decision)

The stages are **postures**, not deadlines; the user-count ranges orient, the triggers in
§3 are the real gates (D §11, arch. §2).

|Stage               |Users    |Posture                                                                                                 |Canonical ref  |
|--------------------|---------|--------------------------------------------------------------------------------------------------------|---------------|
|**1 — Validate**    |0–100    |Everything on WordPress + SuperHosting; PWA on Cloudflare Pages; cron crawlers; **€0 additional**       |D §11, arch. §2|
|**2 — Early growth**|100–3,000|WordPress **stays** as backend + admin + marketing; bottlenecks extracted **only on trigger** (§3)      |D §11, 03 §4   |
|**3 — Scale**       |3,000+   |Standalone REST API **reuses the same Service classes**; WordPress demoted to CMS / marketing / SEO (§5)|D §11, 03 §5   |

Stage 2 is a set of **extractions *around* WordPress**, not a replacement of it (03 §4).
Stage 3 is the one structural move — and even it is additive (§5). The detail of why each
boundary sits where it does lives in `decisions.md §11` and `01`; this table is the frame
the runbooks hang on.

-----

## 3. Per-trigger extraction runbooks (the core of this document)

One runbook per named Stage-2 trigger from `decisions.md §11`. Each gives the
**Trigger** (the measurable condition), the **Precondition** (the Stage-1 seam, already
true), **what moves / what stays**, **Steps**, **Verify**, and a **Rollback** thought.
Cost bands for each move are **not** repeated here — they live in `09`.

### 3.1 Crawlers destabilize WordPress → crawlers to a VPS

- **Trigger.** Crawl runs degrade the *web* tier: WordPress request latency spikes
  correlate with crawl windows; cron overruns; the host warns on CPU/memory during the
  Thu crawl (D §11, arch. §12). This is contention for the **web host’s CPU/memory**, not
  necessarily the database — DB pressure is a *separate* trigger (§3.3).
- **Precondition (seam already cut).** Crawlers already run as **separate OS processes**
  via `bin/crawl.php` (arch. §3); they depend on the **`HttpClient` interface**, not WP’s
  HTTP API directly (arch. §5 rule 3, §7); and they **never write to the DB themselves** —
  they emit `RawOffer[]` to `IngestionService` (arch. §5 rule 3). The Stage-2 swap target
  `CurlHttpClient` is already named (arch. §7, 03 §4).
- **What moves / what stays.** *Moves:* the crawler processes (`bin/crawl.php`,
  `Crawlers/*`, the Ingestion invocation) onto a small VPS (cost band in `09`). *Stays:*
  the WP web tier, the REST API, WP Admin, and — for the **minimal** move — the database
  (the VPS crawler writes to the *same* MySQL).
- **Steps.**
1. Stand up the VPS; install the same PHP 8.x family (03 §3).
1. Deploy the plugin’s `src/` + `bin/` to the VPS — *same code*, `git pull` (arch. §10).
1. **Choose the depth of the move:**
  - **Minimal (recommended first):** keep a thin WP bootstrap on the VPS (`bin/crawl.php`
    still loads `wp-load.php`, arch. §3) and swap only the outbound seam
    `WpHttpClient → CurlHttpClient` (arch. §7). The crawl *process* — the heavy
    CPU/memory part (fetch + parse) — leaves the web host; Ingestion still persists to
    the same MySQL via `Repositories/Wpdb`. This directly clears the §3.1 trigger.
  - **Fuller (WP-free crawler):** additionally back Ingestion with `Repositories/Pdo`
    (the Stage-3 PDO repos, §5) so the VPS needs no WordPress at all. This pairs
    naturally with §3.3 (managed DB) / Stage 3 and is **not required** to clear this
    trigger.
1. Relocate the cron entries (Thu full crawl + daily delta — arch. §9) from CPanel cron
   to the VPS crontab, and **disable the CPanel crawl crons in the same change** to avoid
   double-runs.
1. Verify, then decommission the CPanel crawl crons permanently.
- **Verify.** A full crawl completes on the VPS; `<TABLE_PREFIX>_crawl_runs` rows finalize
  with expected counts (04 §4.6); `/health` reports fresh per-chain crawl ages (arch. §9);
  and WP web-tier latency during the crawl window returns to baseline — i.e. the trigger
  condition clears.
- **Rollback.** Re-enable the CPanel crawl crons, disable the VPS crontab. Both hosts run
  *identical* code, so rollback is a **cron-location toggle**. Nothing is lost: the crawler
  is stateless between runs and writes only via Ingestion, with resumable `crawl_runs`
  state (arch. §6.3).
- **Why the concurrency guard survives the host split.** `GET_LOCK("si_crawl_<chain>")`
  is a **MySQL** named lock, not a filesystem lock (arch. §6.3). Because it lives in the
  database, it contends correctly across hosts as long as the VPS and any stray WP cron
  point at the *same* MySQL server — so the seam choice made in Stage 1 keeps overlap
  prevention working through the move for free. (Still disable the duplicate cron; the
  lock is a backstop, not a reason to run two schedulers.)

### 3.2 API p95 > 500 ms → Redis object cache

- **Trigger.** API **p95 latency exceeds 500 ms** under load (arch. §9, 03 §4) — measured,
  not assumed. Redis is **not** a default (03 §4).
- **Precondition (seam already cut).** Caching today is **WP transients** (MySQL-backed),
  used **only for expensive cross-user reads** — promo browse lists per chain/week —
  invalidated at crawl completion (arch. §9). Personalized endpoints (lists, comparison)
  are deliberately uncached. The transient API (`get_transient`/`set_transient`) *is* the
  seam: its backend can move to Redis via a drop-in.
- **What moves / what stays.** *Moves:* the **backend** of the transient/object cache →
  Redis. *Stays:* the call sites (Services ask the same cache abstraction), the
  invalidation trigger (crawl completion), and the policy of *what* is cacheable.
- **Steps.**
1. Provision Redis (cost band in `09`) — co-located on the §3.1 VPS or a free-tier
   managed Redis.
1. Install a WordPress persistent object-cache drop-in (`object-cache.php`) pointing at
   Redis; transients route to Redis transparently.
1. Optionally promote specific hot **cross-user** reads from request-time SQL to explicit
   cache reads — but keep comparison/list **correctness-first and uncached** (arch. §9).
1. Keep invalidation tied to crawl completion (arch. §6.3) so a new crawl still flushes
   stale promo lists.
- **Verify.** p95 returns below 500 ms under the same load; cache hit-rate is observable; a
  crawl still invalidates promo browse lists (no stale promos surface).
- **Rollback.** Remove the `object-cache.php` drop-in → WordPress falls back to
  MySQL-backed transients automatically. Because **nothing depends on Redis for
  correctness** (it is a cache, not a store — arch. §11), removal degrades latency, not
  function.

### 3.3 WordPress DB connections maxed → read replica / managed DB (early)

- **Trigger.** The shared-host MySQL **connection ceiling** is hit under load
  (connection-limit errors, queueing) (D §11).
- **Precondition (seam already cut).** All DB access is behind **`Repositories/Contracts`**,
  with **`Repositories/Wpdb`** the only implementation (arch. §5 rule 2, §7). Read paths are
  already indexed and isolated (04 §5). The contract is the seam a replica or a managed
  primary slots into.
- **What moves / what stays.** *Moves:* read traffic → a read replica, **or** the whole DB
  → a managed DB (the early precursor to the Stage-3 managed DB — 03 §4). *Stays:* the
  schema (moves as-is — clean `<TABLE_PREFIX>_*` tables, 04 §2.1), the Service classes, and
  the migration runner (04 §6).
- **Two sub-paths.**
  - **Read replica (lighter).** Add a replica; route read-only repository methods to it;
    keep writes on the primary. Needs a read/write split in the repositories (a PDO read
    repo is one clean way). Eventual-consistency tolerance is fine: comparison reads
    **published** prices (append-mostly — 02 §8), so mild replica lag is acceptable, and
    list writes stay on the primary, so last-write-wins on the server clock (D §9) is
    unaffected.
  - **Managed DB (heavier, precursor to Stage 3).** Move the whole DB off SuperHosting.
    Mechanically this **is the §4 data-migration runbook**, executed early; sequence it
    with §3.1 if the crawler already moved.
- **Steps (replica path).** Provision replica → configure replication from SuperHosting
  MySQL → split repository reads/writes → confirm lag is within tolerance → cut reads over.
- **Verify.** Connection errors clear; replica lag is within tolerance; comparison
  correctness is unaffected (it reads published current prices); writes still serialize.
- **Rollback.** Route reads back to the primary — a single flip in the repository factory.
  The contract seam means the call sites never knew which connection answered.
- **Host caveat (flag, do not pre-decide).** Whether SuperHosting can host a replica is a
  **host fact to confirm** (related to the open host-side unknowns, D §14). If it cannot,
  this trigger jumps straight to a **managed DB** (the §4 mechanics) — and the **provider
  is open** (PlanetScale / Supabase / RDS — 03 §5/§7, §5 below), not chosen here.

### 3.4 Push needed → Firebase Cloud Messaging

- **Trigger.** Push notifications become an actual product requirement (D §11). Not before
  — notifications are deferred (D §1).
- **Precondition (seam already cut).** The native shell is **Capacitor wrapping the existing
  PWA** (D §7, 03 §4), which exposes native push APIs; and the backend can store device
  tokens in a custom `<TABLE_PREFIX>_*` table (additive — arch. §8, 04 §2.1/§6.1). FCM is a
  free tier (03 §4).
- **What moves / adds.** *Adds:* a device-token table (additive migration — 04 §6.1), a
  thin WP-free `PushService` behind a **provider abstraction** (the same pattern as the AI
  one — arch. §7), and the FCM SDK in the Capacitor wrapper. *Stays:* everything else.
- **Steps.** Register the FCM project → store device tokens on login / permission-grant →
  send via `PushService → FCM` → (Capacitor surfaces the token and renders notifications).
- **Verify.** A test push reaches a wrapped app instance; token lifecycle
  (refresh/revoke) is handled.
- **Rollback.** Stop sending; stored tokens are inert. Purely additive, so removal is clean.
- **Dependency (reference).** Push **presupposes Capacitor** (the Stage-2 native work item,
  D §7) because web push is out of MVP scope; it rides on that move rather than standing
  alone.

### 3.5 AI requested → Gemini free tier behind the provider abstraction

- **Trigger.** An AI feature is actually requested (D §11). The AI assistant, recipes and
  meal-planning are deferred (D §1).
- **Precondition (seam already cut).** The **AI provider abstraction** is a named Stage-1
  seam (arch. §7) — “same pattern as the prior project.” No provider is wired in Stage 1
  (03 §4), but the interface shape is reserved.
- **What moves / adds.** *Adds:* a concrete `GeminiProvider` implementing the AI provider
  interface (free tier — 03 §4), and the consuming feature (e.g. a recipe suggester) as a
  new WP-free Service. *Stays:* everything; AI is additive.
- **The substrate it consumes (forward-reference §6).** This is where the organically
  matured category buckets pay off: the AI features take the **richer normalized catalog**
  as input (D §11). The Stage-2 bucket maturation (§6) is what gives this provider
  something worth consuming.
- **Steps.** Implement the provider against the abstraction → feature-flag the AI feature →
  route through the provider → keep the key in `wp-config.php` constants (arch. §9;
  hardening in `09`).
- **Verify.** The provider returns within budget; the abstraction lets the provider be
  swapped (test against a stub).
- **Rollback.** Feature-flag off; the provider is unwired. Additive.

### 3.6 How the runbooks compose

These extractions frequently arrive **together** on the road to Stage 3 — most often the
VPS (§3.1) + a managed DB (§3.3) + Redis (§3.2). When they do, the natural order is:
relocate the crawler process (§3.1, minimal) → if DB pressure follows, move the DB (§3.3 /
§4) → add Redis if p95 still misses (§3.2). But **each still fires on its own measured
trigger** — the composition is an observed pattern, not a prescribed pipeline, and a
project that never hits a trigger stays at Stage 1 indefinitely.

-----

## 4. Data-migration mechanics (relocating the database)

This is the heaviest move — the managed-DB cutover, whether early (§3.3) or at Stage 3
(§5). The **migration-runner mechanics and the schema are `04`’s** (04 §6); this section
is the **relocation runbook** that uses them.

- **The schema is reproducible, not hand-dumped.** Migrations are numbered PHP files run
  by an idempotent runner keyed on `schema_version` (a WP option `si_schema_version` —
  04 §6.1, arch. §10). On a fresh target DB the runner reconstructs the schema from
  migration `001` forward. So the target is built by **running migrations**, then
  **loading data** — never by trusting a single dump’s DDL. This is what makes a restore
  (or a relocation) *low-risk*: structure comes from code, data comes from a copy.
- **`schema_version` at cutover.** In Stage 1 it lives in a WP option (04 §6.1) — correct
  and unchanged. When the DB moves and (Stage 3) the API goes standalone, the migration
  coordinator may no longer be WordPress. Two clean handlings: **(a)** keep WordPress as the
  migration coordinator during the transition (it still exists as CMS — 03 §5), reading the
  option as today; or **(b)** promote `schema_version` to a tiny `<TABLE_PREFIX>_meta` row in
  the managed DB so the runner is WP-independent. **(b)** is the natural Stage-3 form — a
  small *additive* step recorded in the fold-back below; it does **not** change Stage 1.
- **Cutover approach (provider-agnostic, because the provider is open — §5).**
1. **Build target.** Run the migration runner against the empty managed DB → the schema
   exists at the current `schema_version`.
1. **Bulk load.** Dump `<TABLE_PREFIX>_*` from SuperHosting (the *same* `mysqldump`
   artifact as the backup — arch. §9, `09 §5`) and load it into the target. **Identity
   note:** if WordPress stays as CMS, `wp_users` stays on the WP DB and the standalone
   API reaches identity through the **`AuthProvider` export** (arch. §3/§8) — exactly why
   identity was kept behind that seam (04 §2.4).
1. **Sync the delta / freeze window.** Either a short, planned **write-freeze** (a
   maintenance window — acceptable at this scale) with a final incremental dump, **or**
   replication SuperHosting → target if the host supports it (the §3.3 host fact). For a
   two-person side project the brief write-freeze is the pragmatic default; live
   replication is the heavier option only if zero downtime is required.
1. **Flip the connection.** Point the repositories at the target (config only — the
   `Repositories/Contracts` seam means call sites don’t change; `Wpdb → Pdo` at Stage 3,
   §5).
1. **Verify, soak, then decommission.** Keep the old DB **read-only** as a fallback
   through a soak period before decommissioning.
- **Rollback.** Until decommission, the SuperHosting DB remains the source of truth — flip
  the connection back. Because the additive invariant means the target is a **copy, not a
  transform**, rollback is a pointer flip, never a reverse-migration.
- **Why this is a move, not a rewrite.** Same migrations reproduce the schema; the data is
  copied, not transformed; the Service classes never knew which DB answered (arch. §5
  rule 1, §7). The additive invariant, made concrete.

-----

## 5. Stage 3 — the standalone API (the big additive step)

The one structural move (03 §5, arch. §7) — and still additive, because the application
logic is *reused*, not rewritten.

- **The core move.** A standalone PHP REST service takes over application logic by
  **instantiating the same `Services/`** — they never depended on WordPress (arch. §5
  rule 1). The only genuinely new code is:
  - **(a) a thin HTTP front** (routing + middleware) replacing the *hosting* of the WP REST
    controllers, serving the **same `si/v1` contract** (arch. §7 — the response shapes are
    the contract). The controllers were already thin glue (arch. §5 rule 4), so their logic
    does not move — only where they are hosted.
  - **(b) `Repositories/Pdo`** implementing `Repositories/Contracts`, replacing
    `Repositories/Wpdb` (arch. §7).
- **The PWA never notices.** Same `si/v1` contract, same JWT claim set
  (`user_id`, `family_ids[]`, `roles[]` — arch. §7/§8). This is the payoff of the
  frontend-decoupled-from-day-one principle (D guiding-principle 5, 00 §6): the Stage-3
  backend swap is frontend-invisible.
- **Auth.** The `AuthProvider` seam (arch. §3/§8) becomes a standalone auth service issuing
  the **identical claims**; `wp_users` either migrates into that service’s store or
  WordPress-as-CMS keeps serving identity behind the provider. Either way the **claim set —
  the contract — is unchanged** (arch. §7).
- **WordPress demoted to CMS / marketing / SEO** (03 §5, D §11): it keeps the marketing
  site (and, during transition, the operator admin), but no longer serves the app API.
- **Managed DB.** Provider **genuinely open** — PlanetScale / Supabase / RDS are all
  candidates (03 §5/§7, D §11); recorded here as **open, not pre-selected**. The move
  mechanics are §4.
- **Apps.** Either the Capacitor wrap (already the Stage-2 native path — D §7) or a full
  React Native migration — **contingent on measured performance**: “full RN migration only
  if performance becomes a *documented* user complaint” (D §7). Referenced as contingent,
  not chosen.
- **Multi-country / i18n / multi-currency.** Additive: the `currency` column already exists
  (constant `EUR` in Stage 1 — arch. §8, 04 §2.3) and region / store-location is an
  additive column (02 §13, 04 §4.4). Multi-country is therefore **data + i18n, not a schema
  rewrite** (D §2).
- **HA / multi-region.** Enters here (arch. §11, D §11) — out of scope until now.

Even the biggest step **uses** the seams cut in Stage 1 rather than cutting new ones —
extending `03 §4`‘s observation (“Stage 2 uses the seams; it doesn’t cut new ones”) all
the way through Stage 3.

-----

## 6. Demand-first relevance — organic bucket maturation (the only demand-first touch)

This is **not a trigger.** It is continuous, additive data growth (D §11).

- The category buckets are seeded with only **~20–30** in Stage 1 and fill **lazily from
  demand** (D §4, 02 §7, 04 §6.2). Through Stage 2, as more users and broader crawl coverage
  exercise the catalog, the buckets **broaden and deepen organically** (D §11).
- **It is additive data growth — no schema change.** The `<TABLE_PREFIX>_categories` table
  and the `<TABLE_PREFIX>_store_products.category_id` trust hinge are unchanged (04 §4.4),
  and lazy bucket creation is already the Stage-1 mechanism (04 §6.2). It is not gated by a
  threshold and appears in **none** of §3’s runbooks; it simply happens as the product is
  used.
- **Why it matters for scaling.** The richer normalized bucket layer is precisely the
  **substrate** the deferred recipe / meal-planning / AI features build on (D §11, 00 §5).
  So the demand-first catalog is not only a Stage-1 *matching simplification* — it is the
  **data asset** that makes the Stage-2 AI trigger (§3.5) worth pulling when it fires.
- **Keep the distinction sharp.** Bucket maturation is **organic** (continuous, no
  threshold, no schema change). Everything in §3 is **trigger-gated** (discrete, a measured
  condition, an implementation swap). Do not conflate the two.

-----

## 7. What is *not* a migration step (deliberate non-triggers)

Things that look like they might need a stage move but do not — so nobody escalates them
into one:

|Looks like a migration…            |…is actually                                                              |
|-----------------------------------|--------------------------------------------------------------------------|
|Category-bucket maturation (§6)    |Organic data growth — continuous, no trigger, no schema change (D §11)    |
|Adding a nullable column / a table |A migration *file* run by the existing runner (04 §6.1) — not a stage move|
|Adding a fifth crawler chain       |A new `Crawlers/` class behind `AbstractCrawler` (arch. §5) — not infra   |
|Seeding a few more buckets up front|A re-run of the idempotent seed (04 §6.2) — not a migration               |

This mirrors `arch. §11` / `03 §6`, read as “do not over-react.” The discipline is the
point: additive change is cheap and routine; a *stage move* is reserved for a fired
trigger.

-----

## 8. Migration → document map

|Need                                                       |Lives in            |
|-----------------------------------------------------------|--------------------|
|Why each seam exists (the dependency rule, the contracts)  |`01 §5/§7`          |
|Which tool / version each trigger admits                   |`03 §4/§5`          |
|**Cost** of each extraction (bands)                        |`09`                |
|Schema, migration runner, `schema_version`, seed, retention|`04 §6`             |
|Crawler internals that relocate to the VPS                 |`05`                |
|Per-stage **trigger definitions** (the source)             |`decisions.md §11`  |
|Risk treatment of each move                                |`09 §2`             |
|JWT claim set / auth contract preserved across the API swap|`06` (+ arch. §7/§8)|

-----

## 9. Amendments to fold back into `decisions.md`

One tightly-scoped, **proposed** item (not asserted as decided; raised for the owner to
record — cf. the open-question style of D §14):

1. **`schema_version` storage at DB cutover — Stage-3-conditional, does not change
   Stage 1.** `04 §6.1` keeps `schema_version` in a WP option for Stage 1 (correct,
   unchanged). This document (§4) notes that at the Stage-3 standalone-API + managed-DB
   cutover the migration coordinator may no longer be WordPress; the natural form is then a
   tiny `<TABLE_PREFIX>_meta` row in the managed DB so the runner is WP-independent.
   *Proposed:* record this as a **Stage-3 cutover step**, not a Stage-1 schema change.
   (08 §4/§5)

Genuinely still open and **not** decided here: the **Stage-3 managed-DB provider**
(PlanetScale / Supabase / RDS — 03 §5/§7) and **Capacitor vs full React Native**
(contingent on measured performance — D §7). Both are referenced as open above.

-----

*Last updated: June 2026 · Session 5 of 6 (Opus 4.8, Extra effort, Thinking ON) ·
canonical for the **Stage 1→2→3 triggers and the per-trigger extraction runbooks**. Written
against the **demand-first** foundation, which it touches only at §6 (organic bucket
maturation as additive data growth, not a trigger). Seams, conventions and tool choices are
**referenced** (arch. §7, 03 §4/§5, 04 §6), not re-decided; the additive-migration
invariant (D §11) governs every runbook. The Stage-3 managed-DB provider and the
Capacitor-vs-RN decision are left **open** (03 §7, D §7), not pre-selected.
`<TABLE_PREFIX>` retained throughout pending the final prefix (D §14).*