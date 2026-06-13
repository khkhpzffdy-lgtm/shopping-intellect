# CLAUDE.md — Always-Loaded Project Context

> **Load when:** **always.** This is the first file in every Claude Code session on
> this project. It orients; it does not specify.
> **Depends on:** `decisions.md` (the canon — load it alongside this file) and
> **`STATUS.md`** (repos, environments, deploy targets, and what's actually built —
> load it too, every session, before touching code or asking the user about
> environments/access).
> **Standalone for:** nothing. It is a map, not a source. Every concrete decision,
> schema, contract, or spec lives in `decisions.md` and `00`–`09`; this file tells you
> *which* one to open and *which* rules you may never break.

> **This file is not an architecture document.** It does not repeat `00`–`09`. It is the
> operating manual for an AI agent that will write code: what the project is, the rules
> that are iron, where to look for what, and how to behave. Keep it short. When in doubt,
> follow `decisions.md`.

-----

## 1. The project in four lines

**Shopping Intellect** — a Sofia-first grocery **price-comparison** + **shared family
shopping-list** platform. The catalog is **demand-first** and three-layered (D §4):
a user’s own term (**UserProduct**) attaches by default to a neutral **category bucket**,
which is matched against concrete crawled **StoreProduct / StoreOffer** rows.
**Broad by default**, opt-in brand anchoring, **matching by selection** (no yes/no
dialog). Two people, side project, **€0 additional infra in Stage 1** (D §5).

-----

## 2. Iron rules (non-negotiable — breaking one is a bug)

1. **Business logic does not depend on WordPress.** `Services` and `Models` are plain
   PHP, reached only through constructor-injected interfaces (`Repositories/Contracts`,
   `HttpClient`, `Clock`, `Logger`). Unit-testable with no WP install. **Only
   `Repositories/Wpdb` may touch `$wpdb`.** (01 §5 rule 1–2.)
1. **No Composer.** Hand-written PSR-4 autoloader; built-in `DOM`/`XPath` for parsing;
   JWT via core `hash_hmac` (custom issuer/verifier, never a WP-JWT plugin). (03 §3.1, D §8.)
1. **Crawlers never write to the DB.** They fetch + parse and emit normalized
   `RawOffer` DTOs to `IngestionService`, which validates, categorizes, and persists.
   Crawlers depend on the `HttpClient` interface, not WP’s HTTP API. (01 §5 rule 3.)
1. **Money is integer euro cents** in a `Money` value object — **never float.** BGN
   figures convert at the fixed **1.95583 BGN/EUR**, round half-up, flag
   `converted_from_bgn`. `currency` column constant `EUR` in Stage 1. (01 §8, D §4.)
1. **“Current” price is derived from a validity query**, never a boolean flag.
   Prices/promos carry explicit `valid_from`/`valid_to`; a promo week runs Thu 00:00 →
   Wed 23:59 Sofia time. (01 §8.)
1. **IDs:** server `BIGINT UNSIGNED` auto-increment. Offline-born entities — **both
   `list_items` and `user_products`** — additionally carry a `client_uuid` (UUIDv4) for
   idempotent sync. (01 §8, D §9.)
1. **Naming is fixed:** PHP namespace `ShoppingIntellect\` · REST namespace `si/v1`
   (mounted at `/wp-json/si/v1/`) · tables **`oCk_si_*`** — the table prefix is
   **`$wpdb->prefix` + `si_`**, resolving to `oCk_si_` on the current install
   (`$table_prefix = 'oCk_'`); build table names as `$wpdb->prefix . 'si_' . '<name>'`
   so they follow the install. (D §6/§14.)
1. **Security defaults:** prepared statements only; exact-origin CORS; access JWT held
   **in memory only** (never `localStorage`); refresh token in an `httpOnly Secure`
   cookie. App users hold a zero-capability `si_user` role, blocked from `wp-admin`.
   (01 §9, D §8.)
1. **Categorization (StoreOffer → bucket) is lenient and non-blocking.** It is
   *product-to-category*, not product-to-product identity. An offer that can’t be
   confidently bucketed simply doesn’t appear — it never blocks ingestion. **There is no
   admin moderation queue.** (01 §5 rule 5, D §4.)

-----

## 3. The demand-first model (do not regress to a single canonical Product)

Three layers, not one product table:

```
UserProduct                  Category bucket                StoreProduct / StoreOffer
("мляко", owner-scoped)  →   ("milk", shared/canonical)  →  (concrete crawled offer)
the user's term              neutral concept, lazily        broad crawl; post-MVP also
born at list-write time      built from demand              enriched from receipts
```

- `list_items` reference **`user_product_id`** — never a free-text string and never a
  canonical product directly. (D §9.)
- **Broad by default.** A UserProduct attaches to a *bucket*, not a brand. The user may
  **opt in** to a brand anchor if brand matters. Brand representation is still open (D §14).
- **Matching is by selection.** The user opens a UserProduct, sees every candidate offer
  across stores with promos marked (D §10), and choosing *is* the match. No confirmation UX.
- **Owner-level metadata.** `is_favorite` on the UserProduct; “recently / frequently
  bought” derived from the append-only `purchase_log`. Owner = family if family-owned,
  else the individual. (D §9.)

If you ever find yourself building a single shared canonical `Product` that a list item
points at directly — **stop.** That is the old model; this revision replaced it.

-----

## 4. Where to look (load selectively — don’t pull everything)

|Need…                                                                        |Open                          |
|-----------------------------------------------------------------------------|------------------------------|
|Any decision, rationale, or open question                                    |**`decisions.md`** (the canon)|
|Executive overview, goals, phases                                            |`00-overview.md`              |
|Skeleton: containers, layers, contracts, data flows, project-wide conventions|`01-architecture.md`          |
|Domain model, bounded contexts, invariants                                   |`02-domain-model.md`          |
|Stack, versions, build/cron triggers                                         |`03-tech-stack.md`            |
|Schema, tables, indexes, migrations                                          |`04-database.md`              |
|Crawlers, ingestion, categorization                                          |`05-crawlers.md`              |
|REST endpoints, JWT, CORS                                                    |`06-api-auth.md`              |
|PWA, offline/sync, two-mode list                                             |`07-frontend.md`              |
|Scaling stages, extraction triggers                                          |`08-scaling-migration.md`     |
|Risks, costs, hardening checklist                                            |`09-risks-costs.md`           |
|Screen-state & component-behaviour rules                                     |`10-ux-rules.md`              |
|End-to-end MVP user flows + screen inventory                                 |`11-user-flows.md`            |
|**How the build is run** — actors, Slice, loop, escalation, handoff templates|`12-execution-model.md`       |
|**The ordered MVP build line** — every Slice, empty repo → MVP               |`13-implementation-line.md`   |

Every doc carries a **`Load when` / `Depends on` / `Standalone for`** metadata header.
Read those headers to decide what to load for the task in front of you, rather than
loading the whole set. `decisions.md` is always loaded; the rest are on demand.

-----

## 5. Working process & discipline

- **`decisions.md` is the single source of truth.** When a decision changes, update
  `decisions.md` **first**, then propagate to the affected `00`–`13` documents — never
  the reverse.
- **The build runs on the execution model (D §15 / `12` / `13`).** Three actors — Owner
  (judges product *behaviour*, never code), Claude (scarce, text-only: architecture +
  Slice design + builder prompts, **does not touch the codebase in normal flow**), Codex
  (owns implementation, tests, debugging). Work flows through combined **Slices** (`12 §2`),
  closes on a **two-gate done** (Codex tests pass + Owner confirms behaviour, `12 §3`), and
  fails forward **Codex-first** (`12 §5`). `13` is the ordered Slice line to build the MVP.
- **Session-per-settings.** Claude effort + thinking mode cannot change mid-chat. Group
  work by settings group (D §13 records the recommended setting per document) and give
  each group its own session with a pre-crafted prompt.
- **Plugin layout** lives under `shopping-intellect/` with `src/Api`, `Services`,
  `Repositories/` (`Contracts/` + `Wpdb/`), `Crawlers`, `Models`, `Support`, `Admin`,
  and `bin/` for CLI cron entry points (`crawl.php`, `prune.php`). See **01 §5** /
  **D §6** for the authoritative tree — don’t reproduce it elsewhere.
- **The two real contracts are the JWT claim set (`user_id`, `family_ids[]`, `roles[]`)
  and the REST response shapes.** Guard those and the boxes behind them stay swappable
  (01 §7). Don’t leak the issuer or WordPress into either.

-----

## 6. Current state & open questions

The full document set — `00`–`13` plus `decisions.md` — is **complete** and reflects the
**demand-first** revision; the **execution model is now closed** (D §15, `12`, `13`).
**Code does not exist yet, but the architecture phase is done.** The next move is **running
Slices** off `13-implementation-line.md` (starting at M0 §0.1) through the `12` build loop —
**not** more architecture documents.

**`decisions.md` §14 is the living list of open questions — treat it as authoritative,
don’t duplicate it here.** As of this writing it still holds, among others: the **final
WP table prefix**; confirmation of **SuperHosting `memory_limit` / `max_execution_time`**
for the PHP CLI crawler; barcode scanner MVP-vs-Stage-2; analytics choice; plus the
demand-first details (UserProduct term normalization, brand-anchor representation, the
broad-item basket-contribution default, the “frequently bought” window/threshold, and
the purchase-log snapshot shape). **When any of these blocks you, flag it explicitly and
defer to a decision in `decisions.md` — do not invent a value.**

-----

*This document set is **demand-first** (UserProduct → category bucket → StoreProduct/StoreOffer;
broad-by-default comparison; matching-by-selection; no admin moderation; owner-level
favorites + purchase log). **`decisions.md` §14 is the living list of open questions.***