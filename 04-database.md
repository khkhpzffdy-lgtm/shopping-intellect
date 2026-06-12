# 04 — Database

> **Load when:** adding or altering a table, index, or constraint; writing a migration;
> reasoning about a hot-path query; deciding where a field physically lives; reviewing a
> PR that touches storage.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton) ·
> `02-domain-model.md` (the meaning).
> **Standalone for:** the physical schema — tables, columns, types, primary/foreign keys,
> unique constraints, indexes, the migration runner, seed, and retention. For *meaning*
> (contexts, entities, invariants) → `02` · crawler parsing internals → `05` · endpoint
> shapes & auth flow → `06` · PWA sync mechanics → `07`.

-----

## 1. Purpose & the 02 ↔ 04 split

This document is canonical for **representation**: how the concepts that `02` defines are
actually stored. Where `02` and this document seem to overlap, `02` wins on *meaning* and
`04` wins on *how it is laid out in MySQL*. Nothing here re-argues architecture or scope —
those live in `01` and `decisions.md` (referenced as *D §n*, *arch. §n*, *02 §n*).

Conventions fixed in arch. §8 — UTC storage, `Europe/Sofia` business calendar, the
Thu→Wed promo week, integer-euro-cent `Money`, half-open `Validity`, `BIGINT` server IDs,
`client_uuid` for offline-born rows, `normalized_name` / `normalized_term`,
`data_quality_score` + `source_url` — are **applied** here, not re-decided. The
demand-first three-layer model (UserProduct → CategoryBucket → StoreProduct/StoreOffer,
D §4, 02 §4/§6/§7) is the shape the tables follow.

Two physical-layout calls that `02`/`decisions.md` leave to this document are made in §4
and surfaced again in §7/§8 so they are easy to find and reverse: **where categorization
is persisted** (on the product identity, not per offer) and **how StoreOffer / PriceEntry
/ Promotion collapse into one table**. Both are flagged.

-----

## 2. Schema strategy

### 2.1 Custom tables under one MySQL — not WP post types / meta

All application state lives in **custom relational tables**, every one prefixed
`oCk_si_`, in the single MySQL database the WordPress install already uses
(arch. §3). WordPress core tables are **referenced, never extended** for app data. The
reasons are concrete, not stylistic:

- **The comparison hot path is relational and typed** (arch. §6.2). It reads current
  `Money`-valued prices for every in-bucket product across four stores. On `wp_postmeta`
  that is an EAV self-join per attribute (price, validity, store, category) with every
  value an untyped `LONGTEXT` — no typed range scans on price or `valid_to`, no composite
  indexes. Custom tables give `INT`/`DATETIME` columns and the composite indexes §5 needs.
- **Volume.** Four chains × 5k–15k regular SKUs + weekly promos + an append-only price
  ledger produces millions of rows over time. Pouring that into `wp_posts`/`wp_postmeta`
  bloats the tables WordPress itself reads on every admin/page load.
- **Integrity.** Foreign keys, composite unique constraints (e.g. one UserProduct per
  owner per normalized term), and append-only logs are first-class in custom InnoDB
  tables and impossible in the post/meta model.
- **The extraction seam.** Stage 3 lifts the service classes onto a standalone API and a
  managed DB (D §11, arch. §7). Clean `oCk_si_*` tables move as-is; post/meta
  entanglement would have to be unwound first.

WordPress keeps exactly one storage job: **`wp_users`** (identity, behind `AuthProvider`
— arch. §3/§8). Everything else is ours.

### 2.2 Engine, charset, collation

- **Engine: InnoDB** throughout — foreign keys, row-level locking, transactional
  ingestion (a crawl run publishes atomically), and the `GET_LOCK` concurrency guard
  (arch. §6.3) all assume it.
- **Charset: `utf8mb4`.** Product names and user terms are Bulgarian Cyrillic; `utf8mb4`
  is non-negotiable.
- **Collation: `utf8mb4_unicode_ci`** for human-text columns. `normalized_term` /
  `normalized_name` store the *output* of the canonical normalizer (§7.1), so equality is
  deterministic regardless of collation; the collation only affects incidental `LIKE`
  search.
- **Indexed text columns are `VARCHAR(190)`** as a habit — `190 × 4 bytes = 760 ≤ 767`,
  the legacy InnoDB index-prefix limit — so an index never silently truncates on an older
  SuperHosting MySQL. Confirm the exact MySQL version (D §14) but the habit costs nothing.

### 2.3 Conventions applied at the schema level (arch. §8 — not re-decided)

|Convention      |Physical form                                                                                                                                                                                                                                                                            |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Server ID       |`BIGINT UNSIGNED NOT NULL AUTO_INCREMENT` primary key on every table                                                                                                                                                                                                                     |
|Offline identity|`client_uuid CHAR(36)` (UUIDv4) on **`list_items` and `user_products`** (both are offline-born — arch. §6.5), `UNIQUE` for idempotent replay                                                                                                                                             |
|Money           |`price_cents INT UNSIGNED` (a single SKU price never approaches the `INT` ceiling of €21.4M; basket sums are computed in PHP `Money`, never stored) + `currency CHAR(3) NOT NULL DEFAULT 'EUR'` (constant in Stage 1, present for D §2 Stage 3)                                          |
|BGN provenance  |`converted_from_bgn TINYINT(1) NOT NULL DEFAULT 0` — canonical on `raw_offers` (the converting site, arch. §8); mirrored onto `price_entries` as cheap published-row provenance                                                                                                          |
|Validity        |`valid_from DATETIME NOT NULL`, `valid_to DATETIME NULL` — **half-open UTC** `[from, to)`; `NULL` `valid_to` = open-ended/still in force. “Current” is **derived by query** (`valid_from <= :now AND (valid_to IS NULL OR valid_to > :now)`), never a stored `is_current` flag (arch. §8)|
|Time            |all `*_at` / `valid_*` columns are `DATETIME` storing **UTC**; the app never relies on the MySQL session time zone. `Europe/Sofia` is applied at the edges (arch. §8)                                                                                                                    |
|Names           |store side keeps the crawled name + `normalized_name`; user side keeps the typed `term` + `normalized_term`                                                                                                                                                                              |
|Audit           |`data_quality_score` + `source_url` on **both** `raw_offers` and `price_entries` (D §4)                                                                                                                                                                                                  |

### 2.4 Two structural rules used everywhere below

- **Polymorphic owner.** `ShoppingList`, `UserProduct` and `PurchaseLogEntry` all belong
  to *either* a user *or* a family (02 §6). This is stored as `owner_id BIGINT UNSIGNED` +
  `owner_type ENUM('user','family')`. A polymorphic reference **cannot carry a DB foreign
  key** (it targets two tables); integrity is enforced in the service layer, and every
  such table indexes `(owner_type, owner_id)`.
- **`user_id` is a logical reference, not a DB FK.** Columns that point at a person
  (`user_profiles.user_id`, `family_members.user_id`, `lists.owner_id` when
  `owner_type='user'`, `list_items.added_by_user_id`, `purchase_log` owner,
  `refresh_tokens.user_id`, `families.created_by`) hold `wp_users.ID` **by value with no
  foreign key**. Hard-FK’ing app tables to a differently-prefixed WP core table would
  couple us to WordPress and fight the Stage-2/3 export of `AuthProvider` (arch. §3/§8).
  FKs are used **only among `oCk_si_*` tables**, where they are free of that
  coupling.

`ENUM` is used for small, closed, rarely-changing sets (`owner_type`, `role`, `status`,
`mode`). Adding a value is an `ALTER`; at this scale and change-rate that is acceptable,
and the readability/storage win is worth it.

-----

## 3. Entity (02) → table (04) map

|02 concept                                  |Context      |Physical table                                      |Note                                                          |
|--------------------------------------------|-------------|----------------------------------------------------|--------------------------------------------------------------|
|User                                        |Identity     |`wp_users` (+ `user_profiles`)                      |WP-owned identity; app profile in our table                   |
|Credential / AuthSession                    |Identity     |`wp_users` + `refresh_tokens`                       |password/Google verified by WP/Google; refresh persisted by us|
|Family / FamilyMembership / FamilyInvitation|Family       |`families` / `family_members` / `family_invitations`|1:1                                                           |
|ShoppingList / ListItem                     |Shopping List|`lists` / `list_items`                              |`list_items → user_product_id`                                |
|**UserProduct** (layer 1)                   |Shopping List|`user_products`                                     |owner-scoped; the term layer                                  |
|PurchaseLogEntry                            |Shopping List|`purchase_log`                                      |append-only                                                   |
|**CategoryBucket** (layer 2)                |Catalog      |`categories`                                        |neutral concept, lazily filled                                |
|**StoreProduct** (layer 3)                  |Catalog      |`store_products`                                    |per-store identity; **carries `category_id`**                 |
|Barcode                                     |Catalog      |`barcodes`                                          |optional strong signal (Phase 2)                              |
|Store                                       |Catalog      |`stores`                                            |4 chains, Sofia-scoped                                        |
|**StoreOffer** (layer 3)                    |Catalog      |*→ folded into* `price_entries`                     |the priced, selectable candidate — §4.5, flagged              |
|PriceEntry                                  |Pricing      |`price_entries`                                     |the validated price truth comparison reads                    |
|Promotion                                   |Pricing      |*→ `price_entries.is_promo`*                        |qualified PriceEntry, **not** a separate table (02 §8, D §4)  |
|CrawlRun / RawOffer                         |Crawling     |`crawl_runs` / `raw_offers`                         |raw offers staged 8 weeks then pruned                         |
|BasketComparison                            |Comparison   |*(none — derived)*                                  |non-persistent (02 §12)                                       |

The three folds (StoreOffer→`price_entries`, Promotion→`is_promo`, categorization onto
`store_products`) are the only places where physical layout departs from a literal
table-per-entity reading of `02`. The Promotion fold is already blessed by D §4 / 02 §8;
the other two are this document’s representation calls and are flagged in §7/§8.

-----

## 4. Schema by bounded context

Column tables below list every column with its type and a terse rationale; keys, unique
constraints and FKs follow each table. Hot-path indexes are gathered and justified
against invariants in **§5** to avoid repetition.

### 4.1 Identity / Auth

`wp_users` is **referenced, never redefined** (arch. §3/§8). Two custom tables hang off it.

**`oCk_si_user_profiles`** — app-specific profile, 1:1 with `wp_users`. Deliberately
thin; grows additively.

|Column                     |Type                |Why                                                         |
|---------------------------|--------------------|------------------------------------------------------------|
|`user_id`                  |`BIGINT UNSIGNED` PK|== `wp_users.ID` (logical ref, §2.4); 1:1, so it *is* the PK|
|`display_name`             |`VARCHAR(190) NULL` |app-facing name, independent of the WP login                |
|`onboarding_state`         |`VARCHAR(40) NULL`  |resumable first-run flow; opaque to the DB                  |
|`created_at` / `updated_at`|`DATETIME NOT NULL` |UTC                                                         |

- **PK** `user_id`. No FK (logical ref to `wp_users`). Roles (`si_user`) and `family_ids`
  come from WP roles and `family_members` respectively, so they are **not** stored here.

**`oCk_si_refresh_tokens`** — persistence for the rotating refresh token (arch. §8).
The **rotation/reuse-detection flow is 06’s** (arch. §6.1); this table only stores enough
to verify, rotate, expire and revoke. The raw token is **never stored** — only its hash.

|Column      |Type                      |Why                                                                                                                                        |
|------------|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
|`id`        |`BIGINT UNSIGNED` PK AI   |                                                                                                                                           |
|`user_id`   |`BIGINT UNSIGNED NOT NULL`|logical ref to `wp_users.ID`                                                                                                               |
|`token_hash`|`CHAR(64) NOT NULL`       |SHA-256 hex of the opaque refresh token; we store the hash, the client holds the token                                                     |
|`lineage_id`|`CHAR(36) NOT NULL`       |groups one rotation chain (a “session”); reuse of a superseded token in a lineage → revoke the whole lineage (theft detection — flow in 06)|
|`issued_at` |`DATETIME NOT NULL`       |UTC                                                                                                                                        |
|`expires_at`|`DATETIME NOT NULL`       |absolute expiry; drives pruning                                                                                                            |
|`rotated_at`|`DATETIME NULL`           |set when this token is rotated out (superseded but still within reuse-detection window)                                                    |
|`revoked_at`|`DATETIME NULL`           |set on logout / lineage revoke                                                                                                             |
|`user_agent`|`VARCHAR(190) NULL`       |audit only                                                                                                                                 |

- **PK** `id`. **UNIQUE** `token_hash`. **Index** `(user_id)`, `(expires_at)` (prune),
  `(lineage_id)`.

### 4.2 Family

**`oCk_si_families`**

|Column      |Type                      |Why                                                      |
|------------|--------------------------|---------------------------------------------------------|
|`id`        |`BIGINT UNSIGNED` PK AI   |                                                         |
|`name`      |`VARCHAR(120) NOT NULL`   |                                                         |
|`created_by`|`BIGINT UNSIGNED NOT NULL`|logical ref to `wp_users.ID`; becomes first admin (02 §5)|
|`created_at`|`DATETIME NOT NULL`       |                                                         |

- **PK** `id`. The “≥1 admin” invariant (02 §5) is **not** expressible as a constraint and
  is enforced in the `FamilyService`.

**`oCk_si_family_members`** — the `User ↔ Family` join with a role.

|Column     |Type                                              |Why                         |
|-----------|--------------------------------------------------|----------------------------|
|`id`       |`BIGINT UNSIGNED` PK AI                           |                            |
|`family_id`|`BIGINT UNSIGNED NOT NULL`                        |FK → `families.id`          |
|`user_id`  |`BIGINT UNSIGNED NOT NULL`                        |logical ref to `wp_users.ID`|
|`role`     |`ENUM('admin','member') NOT NULL DEFAULT 'member'`|gates mutation (02 §5)      |
|`joined_at`|`DATETIME NOT NULL`                               |                            |

- **PK** `id`. **FK** `family_id` → `families.id` `ON DELETE CASCADE`. **UNIQUE**
  `(family_id, user_id)` — membership unique per family (02 §5). **Index** `(user_id)` —
  resolves a user’s `family_ids[]` for the JWT projection (arch. §6.1).

**`oCk_si_family_invitations`**

|Column                      |Type                                                                       |Why                                                                                    |
|----------------------------|---------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
|`id`                        |`BIGINT UNSIGNED` PK AI                                                    |                                                                                       |
|`family_id`                 |`BIGINT UNSIGNED NOT NULL`                                                 |FK → `families.id`                                                                     |
|`invited_email`             |`VARCHAR(190) NOT NULL`                                                    |the only join path in MVP (D §9)                                                       |
|`token_hash`                |`CHAR(64) NOT NULL`                                                        |SHA-256 of the opaque token mailed in the link; looked up by hashing the incoming token|
|`invited_role`              |`ENUM('admin','member') NOT NULL DEFAULT 'member'`                         |role granted on acceptance                                                             |
|`status`                    |`ENUM('pending','accepted','expired','revoked') NOT NULL DEFAULT 'pending'`|lifecycle (02 §5)                                                                      |
|`expires_at`                |`DATETIME NOT NULL`                                                        |                                                                                       |
|`accepted_by_user_id`       |`BIGINT UNSIGNED NULL`                                                     |logical ref; set on accept                                                             |
|`created_at` / `accepted_at`|`DATETIME` (`accepted_at NULL`)                                            |                                                                                       |

- **PK** `id`. **FK** `family_id` → `families.id` `ON DELETE CASCADE`. **UNIQUE**
  `token_hash`. **Index** `(family_id, status)`, `(invited_email)`. One-shot idempotent
  acceptance (02 §5) is enforced by a `status='pending'` guard in the service.

### 4.3 Shopping List — the three-layer model, layer 1 lives here

**`oCk_si_lists`**

|Column                     |Type                            |Why               |
|---------------------------|--------------------------------|------------------|
|`id`                       |`BIGINT UNSIGNED` PK AI         |                  |
|`owner_id`                 |`BIGINT UNSIGNED NOT NULL`      |polymorphic (§2.4)|
|`owner_type`               |`ENUM('user','family') NOT NULL`|                  |
|`name`                     |`VARCHAR(120) NOT NULL`         |                  |
|`created_at` / `updated_at`|`DATETIME NOT NULL`             |                  |

- **PK** `id`. **Index** `(owner_type, owner_id)` — “all lists for this owner”. No owner FK
  (polymorphic).

**`oCk_si_user_products`** — **layer 1**, the user’s own term (02 §6). Owner-scoped,
deduped per normalized term, attaches to a bucket by default, optionally narrows to a brand.

|Column                     |Type                            |Why                                                                                                |
|---------------------------|--------------------------------|---------------------------------------------------------------------------------------------------|
|`id`                       |`BIGINT UNSIGNED` PK AI         |                                                                                                   |
|`owner_id`                 |`BIGINT UNSIGNED NOT NULL`      |polymorphic owner (§2.4)                                                                           |
|`owner_type`               |`ENUM('user','family') NOT NULL`|                                                                                                   |
|`term`                     |`VARCHAR(190) NOT NULL`         |as typed (“мляко”, “прах Ariel”)                                                                   |
|`normalized_term`          |`VARCHAR(190) NOT NULL`         |canonical form for dedup + bucket auto-attach (normalizer in §7.1)                                 |
|`category_id`              |`BIGINT UNSIGNED NULL`          |FK → `categories.id`; **the default broad attachment**, NULL until categorized                     |
|`brand_anchor`             |`VARCHAR(120) NULL`             |optional opt-in narrowing to a brand token (representation proposed — §7.2)                        |
|`is_favorite`              |`TINYINT(1) NOT NULL DEFAULT 0` |owner-level favorite (02 §6)                                                                       |
|`is_archived`              |`TINYINT(1) NOT NULL DEFAULT 0` |soft-delete: hides the term while preserving `purchase_log` history and the unique slot (§4.3 note)|
|`client_uuid`              |`CHAR(36) NOT NULL`             |offline-born (a term is first typed in-store, often offline — arch. §6.5)                          |
|`created_at` / `updated_at`|`DATETIME NOT NULL`             |                                                                                                   |

- **PK** `id`. **FK** `category_id` → `categories.id` `ON DELETE SET NULL` (a bucket
  merge/split must never orphan a term — §6.4). **UNIQUE** `(owner_type, owner_id, normalized_term)` — *the* layer-1 invariant (02 §6): re-typing the same term reuses the
  row so favorite + history persist. **UNIQUE** `client_uuid` — idempotent offline replay.
- **Soft-delete rationale:** because `purchase_log` rows reference a UserProduct
  append-only, and because the unique slot is what makes “frequently bought” accumulate
  over time, deletion is modelled as `is_archived = 1` (re-adding the same term un-archives
  and recovers its history) rather than a hard `DELETE`. Hard deletes are therefore
  `RESTRICT`-guarded where referenced.

**`oCk_si_list_items`** — references **layer 1**, never a canonical product and never
free text (02 §6, D §9).

|Column                     |Type                                  |Why                                                                 |
|---------------------------|--------------------------------------|--------------------------------------------------------------------|
|`id`                       |`BIGINT UNSIGNED` PK AI               |                                                                    |
|`list_id`                  |`BIGINT UNSIGNED NOT NULL`            |FK → `lists.id`                                                     |
|`user_product_id`          |`BIGINT UNSIGNED NOT NULL`            |FK → `user_products.id` — **replaces the old `product_id`**         |
|`quantity`                 |`DECIMAL(10,3) NOT NULL DEFAULT 1`    |the `Quantity` amount (02 §3)                                       |
|`unit`                     |`VARCHAR(16) NOT NULL DEFAULT 'piece'`|`g/kg/ml/l/piece/bucket…`; unit normalization is Catalog’s (02 §3)  |
|`is_checked`               |`TINYINT(1) NOT NULL DEFAULT 0`       |in-list checked state — **separate** from `purchase_log`            |
|`added_by_user_id`         |`BIGINT UNSIGNED NOT NULL`            |attribution within a shared list; logical ref                       |
|`client_uuid`              |`CHAR(36) NOT NULL`                   |offline-born; idempotent replay                                     |
|`created_at` / `updated_at`|`DATETIME NOT NULL`                   |`updated_at` is the **last-write-wins** field on server clock (D §9)|

- **PK** `id`. **FK** `list_id` → `lists.id` `ON DELETE CASCADE`; **FK** `user_product_id`
  → `user_products.id` `ON DELETE RESTRICT` (a term still on a list can’t vanish — archive
  instead). **UNIQUE** `client_uuid`. **Index** `(list_id)` — the list-read path (§5.2).

**`oCk_si_purchase_log`** — **append-only**, immutable rows; the *only* substrate for
recently/frequently-bought (02 §6, D §9).

|Column            |Type                            |Why                                                  |
|------------------|--------------------------------|-----------------------------------------------------|
|`id`              |`BIGINT UNSIGNED` PK AI         |                                                     |
|`owner_id`        |`BIGINT UNSIGNED NOT NULL`      |metadata lives at owner level (§2.4)                 |
|`owner_type`      |`ENUM('user','family') NOT NULL`|                                                     |
|`user_product_id` |`BIGINT UNSIGNED NOT NULL`      |FK → `user_products.id`                              |
|`purchased_at`    |`DATETIME NOT NULL`             |UTC; the “checked / bought” event time               |
|`store_product_id`|`BIGINT UNSIGNED NULL`          |**proposed offer snapshot** — the chosen offer (§7.3)|
|`unit_price_cents`|`INT UNSIGNED NULL`             |**proposed offer snapshot** — price paid (§7.3)      |
|`currency`        |`CHAR(3) NULL`                  |snapshot currency (`EUR`)                            |

- **PK** `id`. **FK** `user_product_id` → `user_products.id` `ON DELETE RESTRICT`
  (history outlives list edits — that is the point). `store_product_id` is a logical ref
  (offers are crawl-volatile; no hard FK so pruning never blocks the log). **No
  `updated_at`** — rows are never mutated. Aggregation index in §5.3.

### 4.4 Catalog — layers 2 & 3, and the trust hinge

**`oCk_si_stores`** — the four chains (D §3); Sofia-flat in MVP (region/location is
an additive Stage-2 column, 02 §13). Also holds the per-chain delta hash.

|Column            |Type                           |Why                                                    |
|------------------|-------------------------------|-------------------------------------------------------|
|`id`              |`BIGINT UNSIGNED` PK AI        |                                                       |
|`slug`            |`VARCHAR(40) NOT NULL`         |`lidl/kaufland/billa/fantastico`                       |
|`name`            |`VARCHAR(80) NOT NULL`         |display                                                |
|`is_active`       |`TINYINT(1) NOT NULL DEFAULT 1`|toggle a chain without deleting data                   |
|`delta_page_hash` |`CHAR(64) NULL`                |last promo-landing-page hash (daily delta — arch. §6.4)|
|`delta_checked_at`|`DATETIME NULL`                |when the delta hash was last taken                     |
|`created_at`      |`DATETIME NOT NULL`            |                                                       |

- **PK** `id`. **UNIQUE** `slug`. The delta hash is read by `store_id` (PK) — no extra
  index needed (§5.5).

**`oCk_si_categories`** — **layer 2**, the neutral CategoryBucket (02 §7). ~20–30
admin-seeded, the rest lazily created on demand (D §4, §6.2). Flat in MVP.

|Column                   |Type                           |Why                                                                               |
|-------------------------|-------------------------------|----------------------------------------------------------------------------------|
|`id`                     |`BIGINT UNSIGNED` PK AI        |                                                                                  |
|`slug`                   |`VARCHAR(80) NOT NULL`         |stable key (`milk`, `bread`, `eggs`) — seed + lazy upsert target                  |
|`name`                   |`VARCHAR(120) NOT NULL`        |display (Bulgarian)                                                               |
|`is_seeded`              |`TINYINT(1) NOT NULL DEFAULT 0`|distinguishes the seeded core from demand-created buckets (analytics/hygiene only)|
|`replaced_by_category_id`|`BIGINT UNSIGNED NULL`         |soft-merge audit pointer (§6.4)                                                   |
|`created_at`             |`DATETIME NOT NULL`            |                                                                                  |

- **PK** `id`. **UNIQUE** `slug`. **Self-FK** `replaced_by_category_id` → `categories.id`
  `ON DELETE SET NULL`. No `parent_id` in MVP — buckets are flat; a hierarchy is an
  additive future column (02 §13).

**`oCk_si_store_products`** — **layer 3 identity**: the goods as listed by one store,
stable across weekly crawls (02 §7). **Carries `category_id` — the trust hinge** (see the
representation note below and §7.4).

|Column                     |Type                      |Why                                                                                                                             |
|---------------------------|--------------------------|--------------------------------------------------------------------------------------------------------------------------------|
|`id`                       |`BIGINT UNSIGNED` PK AI   |                                                                                                                                |
|`store_id`                 |`BIGINT UNSIGNED NOT NULL`|FK → `stores.id`; belongs to exactly one store                                                                                  |
|`source_external_id`       |`VARCHAR(190) NULL`       |the chain’s own product/SKU id where the page exposes one — the strongest cross-crawl identity anchor                           |
|`source_name`              |`VARCHAR(190) NOT NULL`   |name exactly as crawled (Bulgarian)                                                                                             |
|`normalized_name`          |`VARCHAR(190) NOT NULL`   |lowercased, unit/weight extracted; fuzzy-categorization + search input (arch. §8)                                               |
|`category_id`              |`BIGINT UNSIGNED NULL`    |FK → `categories.id`; **NULL = uncategorized** → product (and its offers) absent from every bucket until categorized (02 §7/§10)|
|`brand_normalized`         |`VARCHAR(120) NULL`       |best-effort extracted brand token; powers brand-anchored comparison (§7.2)                                                      |
|`source_url`               |`VARCHAR(512) NULL`       |audit/back-link                                                                                                                 |
|`created_at` / `updated_at`|`DATETIME NOT NULL`       |                                                                                                                                |

- **PK** `id`. **FK** `store_id` → `stores.id`; **FK** `category_id` → `categories.id`
  `ON DELETE SET NULL` (merge/split never orphans a product). **UNIQUE** `(store_id, source_external_id)` — dedupes resolution where a SKU id exists (MySQL permits multiple
  NULLs, so SKU-less rows are unconstrained here and resolved by the crawler via
  `normalized_name` + barcode, owned by `05`). Trust-hinge index in §5.1.

> **Representation note — categorization lives on the product, not the offer.** `02 §7`
> describes the categorization link as `StoreOffer → CategoryBucket`, and the task brief
> placed `category_id` on `store_offers`. At the physical level this document puts
> `category_id` on `store_products` instead, because a product’s bucket is **invariant
> across its many weekly offers** (milk is milk regardless of this week’s price), so
> per-offer categorization would duplicate the bucket on every price row and force
> re-categorization (02 §7/§9, “re-categorized offline when the algorithm improves”) to
> rewrite N offer rows instead of one product row. An offer’s bucket is therefore
> **derived** through its `store_product`. This realizes the *meaning* of 02’s link while
> keeping the trust hinge a single indexed column. Flagged for fold-back in §8.

**`oCk_si_barcodes`** — optional strong signal on a `store_product`, Phase-2
categorization (02 §7, D §4). A product may carry several (multipack/variant); one barcode
value recurs across stores (which is exactly what lets Phase 2 pull offers into one bucket).

|Column            |Type                      |Why                     |
|------------------|--------------------------|------------------------|
|`id`              |`BIGINT UNSIGNED` PK AI   |                        |
|`store_product_id`|`BIGINT UNSIGNED NOT NULL`|FK → `store_products.id`|
|`barcode_value`   |`VARCHAR(32) NOT NULL`    |EAN/GTIN as read        |
|`created_at`      |`DATETIME NOT NULL`       |                        |

- **PK** `id`. **FK** `store_product_id` → `store_products.id` `ON DELETE CASCADE`.
  **UNIQUE** `(store_product_id, barcode_value)`. **Index** `(barcode_value)` — “all
  products sharing this barcode” for cross-store bucketing (§5.1).

### 4.5 Pricing — StoreOffer ∪ PriceEntry ∪ Promotion, one table

**`oCk_si_price_entries`** — the published, validated, time-bounded price for a
`store_product`. Comparison reads **only** this table (arch. §6.2, 02 §8). It is **also**
the physical home of 02’s `StoreOffer` (the priced candidate the user browses) and
`Promotion` (a row with `is_promo = 1`).

|Column              |Type                            |Why                                                                                |
|--------------------|--------------------------------|-----------------------------------------------------------------------------------|
|`id`                |`BIGINT UNSIGNED` PK AI         |                                                                                   |
|`store_product_id`  |`BIGINT UNSIGNED NOT NULL`      |FK → `store_products.id`; a PriceEntry prices a StoreProduct (02 §8)               |
|`price_cents`       |`INT UNSIGNED NOT NULL`         |`Money`, integer euro cents (arch. §8)                                             |
|`currency`          |`CHAR(3) NOT NULL DEFAULT 'EUR'`|constant Stage 1                                                                   |
|`valid_from`        |`DATETIME NOT NULL`             |half-open `[from, to)`, UTC                                                        |
|`valid_to`          |`DATETIME NULL`                 |`NULL` = open-ended / still current; a promo’s = its Thu→Wed week end (arch. §8)   |
|`is_promo`          |`TINYINT(1) NOT NULL DEFAULT 0` |**this is the Promotion** — a qualified PriceEntry, not a separate universe (02 §8)|
|`data_quality_score`|`TINYINT UNSIGNED NULL`         |validation outcome (D §4); scale defined by ingestion (`05`)                       |
|`source_url`        |`VARCHAR(512) NULL`             |audit (D §4)                                                                       |
|`converted_from_bgn`|`TINYINT(1) NOT NULL DEFAULT 0` |published-row provenance mirror of the raw offer (§2.3)                            |
|`crawl_run_id`      |`BIGINT UNSIGNED NULL`          |FK → `crawl_runs.id`; which run published it                                       |
|`created_at`        |`DATETIME NOT NULL`             |                                                                                   |

- **PK** `id`. **FK** `store_product_id` → `store_products.id` `ON DELETE CASCADE`;
  **FK** `crawl_run_id` → `crawl_runs.id` `ON DELETE SET NULL` (pruning old runs must not
  delete prices). **No FK to `raw_offers`** — those are staged and pruned at 8 weeks (§6.5);
  provenance is the retained `source_url` + `crawl_run_id`. Current-price index in §5.1.
- **Why one table, not three** (StoreOffer / PriceEntry / Promotion): at the row level they
  are the *same fact* seen by three contexts — a validated, time-bounded, priced offer for
  a product. Materializing StoreOffer separately would duplicate `Money` + `Validity` and
  couple two tables on every crawl with no read benefit; Promotion is a flag by D §4 / 02
  §8. Concurrent regular + promo prices (02 §8) are simply two current rows; resolution
  prefers `is_promo = 1` (§5.1). Flagged for fold-back in §8.

### 4.6 Crawling / Ingestion

**`oCk_si_crawl_runs`** — source of truth for crawler health; powers the Admin
dashboard and `/health` (arch. §9). Resumable (arch. §6.3).

|Column                                                |Type                                                                       |Why                                                                                                  |
|------------------------------------------------------|---------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
|`id`                                                  |`BIGINT UNSIGNED` PK AI                                                    |                                                                                                     |
|`store_id`                                            |`BIGINT UNSIGNED NULL`                                                     |FK → `stores.id`; `NULL` for the all-chains daily delta sweep (arch. §6.4)                           |
|`mode`                                                |`ENUM('full','delta') NOT NULL`                                            |D §4 schedule                                                                                        |
|`status`                                              |`ENUM('running','completed','partial','failed') NOT NULL DEFAULT 'running'`|                                                                                                     |
|`started_at`                                          |`DATETIME NOT NULL`                                                        |                                                                                                     |
|`finished_at`                                         |`DATETIME NULL`                                                            |NULL while running                                                                                   |
|`offers_seen` / `offers_published` / `offers_rejected`|`INT UNSIGNED NOT NULL DEFAULT 0`                                          |counts for the dashboard                                                                             |
|`resume_state`                                        |`JSON NULL`                                                                |chunk/cursor progress so a host-killed run resumes (arch. §6.3); `TEXT` if MySQL lacks `JSON` (D §14)|
|`error_summary`                                       |`TEXT NULL`                                                                |last error for the alert + dashboard                                                                 |

- **PK** `id`. **FK** `store_id` → `stores.id` `ON DELETE CASCADE`. **Index**
  `(store_id, started_at)` — “age of last successful crawl per chain” for `/health` (§5.5).
  Cross-run concurrency is guarded by the MySQL named lock `GET_LOCK("si_crawl_<chain>")`
  (arch. §6.3), not a DB constraint.

**`oCk_si_raw_offers`** — the **staged** parsed offer (02 §3/§9): the Crawling→Ingestion
hand-off, persisted for forensic audit and offline re-categorization, **retained 8 weeks
then pruned** (arch. §6.3, §6.5).

|Column              |Type                                                                         |Why                                                                            |
|--------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------|
|`id`                |`BIGINT UNSIGNED` PK AI                                                      |                                                                               |
|`crawl_run_id`      |`BIGINT UNSIGNED NOT NULL`                                                   |FK → `crawl_runs.id`                                                           |
|`store_id`          |`BIGINT UNSIGNED NOT NULL`                                                   |FK → `stores.id` (denormalized for prune/scan)                                 |
|`source_name`       |`VARCHAR(190) NOT NULL`                                                      |raw Bulgarian name as crawled                                                  |
|`normalized_name`   |`VARCHAR(190) NOT NULL`                                                      |normalized at parse time                                                       |
|`quantity_amount`   |`DECIMAL(10,3) NULL`                                                         |extracted `Quantity` (02 §3)                                                   |
|`quantity_unit`     |`VARCHAR(16) NULL`                                                           |                                                                               |
|`price_cents`       |`INT UNSIGNED NOT NULL`                                                      |parsed `Money`                                                                 |
|`currency`          |`CHAR(3) NOT NULL DEFAULT 'EUR'`                                             |                                                                               |
|`converted_from_bgn`|`TINYINT(1) NOT NULL DEFAULT 0`                                              |**canonical** BGN-conversion flag (arch. §8)                                   |
|`content_hash`      |`CHAR(64) NOT NULL`                                                          |per-offer source hash → idempotent re-ingest / change detection (02 §3)        |
|`source_url`        |`VARCHAR(512) NULL`                                                          |audit (D §4)                                                                   |
|`data_quality_score`|`TINYINT UNSIGNED NULL`                                                      |validation outcome (D §4)                                                      |
|`status`            |`ENUM('staged','validated','published','rejected') NOT NULL DEFAULT 'staged'`|lifecycle (02 §10)                                                             |
|`rejection_reason`  |`VARCHAR(190) NULL`                                                          |rejected rows are retained & visible in Admin, never surfaced to users (02 §10)|
|`store_product_id`  |`BIGINT UNSIGNED NULL`                                                       |FK → `store_products.id`; set once resolved                                    |
|`created_at`        |`DATETIME NOT NULL`                                                          |also the prune cutoff anchor                                                   |

- **PK** `id`. **FK** `crawl_run_id` → `crawl_runs.id` `ON DELETE CASCADE`; **FK**
  `store_id` → `stores.id`; **FK** `store_product_id` → `store_products.id` `ON DELETE SET NULL`. **Index** `(store_id, content_hash)` (change detection — §5.5), `(created_at)`
  (prune — §6.5), `(crawl_run_id)`.

-----

## 5. Indexes for the hot paths (tied to invariants)

Every index below earns its place against a named read path or invariant. Nothing is
indexed “just in case” — at 0–100 users, indexed SQL on these is fast and *correctness
beats micro-latency* (arch. §9).

### 5.1 Basket comparison — the core read (arch. §6.2, 02 §12)

For each list item: `user_product → category_id` (or `brand_anchor`), then **every**
in-bucket `store_product` per store, each with its **current** `price_entry`, across 4
stores.

- **`store_products (category_id, store_id)`** — the **trust-hinge index**. Resolves “all
  in-bucket products, grouped by store” directly; `category_id IS NULL` rows (uncategorized)
  never appear because the lookup is keyed by a concrete `category_id`.
- **`price_entries (store_product_id, valid_to, valid_from)`** — current-price resolution:
  `WHERE store_product_id = ? AND valid_from <= :now AND (valid_to IS NULL OR valid_to > :now)`. Leading `valid_to` lets the optimizer cut expired rows fast; `is_promo = 1`
  preference is applied in the small current result set, honoring “promo wins while its
  Validity is current” (02 §8) **without** a forbidden `is_current` flag.
- **`barcodes (barcode_value)`** — Phase-2 categorization (“all products sharing this
  barcode” → one bucket).
- **`store_products (category_id, brand_normalized)`** — brand-anchored items narrow the
  in-bucket set to one brand across stores (§7.2), preserving cross-store comparison.

The whole path is pure MySQL with no request-time external call — the entire reason for
proactive crawling (D §4, arch. §6.2).

### 5.2 List read (06/07)

- **`list_items (list_id)`** — fetch a list’s items; join `user_products` by PK. With the
  per-owner `lists (owner_type, owner_id)` index, “open my/our lists then their items” is
  two indexed steps.

### 5.3 Purchase-log aggregation — recently / frequently bought (02 §6, D §9)

- **`purchase_log (owner_type, owner_id, user_product_id, purchased_at)`** — one composite
  index serves all three needs: **recently bought** = `MAX(purchased_at)` per
  `user_product` for an owner; **frequently bought** = `COUNT(*)` per `user_product` for an
  owner; and the *windowed* variant (`purchased_at >= :cutoff`) rides the trailing
  `purchased_at` column. The window/threshold is **decided** as a tunable default (§7.5),
  and this same index serves it — re-tuning later needs no column change.

### 5.4 Uniqueness invariants (already declared in §4, recapped)

`user_products (owner_type, owner_id, normalized_term)` · `user_products.client_uuid` ·
`list_items.client_uuid` · `family_members (family_id, user_id)` ·
`family_invitations.token_hash` · `refresh_tokens.token_hash` · `stores.slug` ·
`categories.slug` · `barcodes (store_product_id, barcode_value)` · `store_products (store_id, source_external_id)`.

> **Sync interaction worth noting:** the `(owner, normalized_term)` unique is what makes
> offline dedup work, and it is also what two offline devices can *collide* on (same term,
> different `client_uuid`). The sync path treats a duplicate-key on this unique as a
> **merge to the existing row**, not an error — `client_uuid` keeps the *replay*
> idempotent, the composite unique keeps the *term* singular. Mechanics in `07`.

### 5.5 Crawl delta & change detection (arch. §6.4)

- **Per-chain delta**: `stores.delta_page_hash` is read by `store_id` (PK) — no extra
  index. The daily sweep compares the fresh landing-page hash to the stored one and only
  then fires a partial run.
- **Per-offer change**: **`raw_offers (store_id, content_hash)`** answers “have we already
  seen this exact offer?” for idempotent re-ingest, and **`raw_offers (created_at)`** drives
  the 8-week prune.

-----

## 6. Migrations, seed & retention

### 6.1 Versioned migration runner (arch. §10)

- Migrations are **numbered PHP files** — `migrations/001_core_tables.php`,
  `002_catalog.php`, … — each exposing an idempotent `up()` (`CREATE TABLE IF NOT EXISTS`,
  guarded `ALTER`s). No Composer, no external migration library (D §6, 03 §3.1).
- A small **idempotent runner** executes any migration whose number is greater than the
  stored `schema_version`, wrapped per file in a transaction where DDL allows.
- **`schema_version` is a WP option** (`si_schema_version`), **not** a custom table
  (arch. §10) — one less table to bootstrap, and it rides WP’s option cache.
- The runner is invoked two ways for the same result: the **plugin activation hook** and a
  **`bin/migrate.php` CLI** command (so a deploy is `git pull` → `bin/migrate.php` —
  arch. §10).
- MVP is **forward-only** (no `down()`); a mistaken migration is corrected by a new
  higher-numbered one. Reversible migrations are not worth the surface for a two-person
  team at this stage (revisit if it ever bites — note, not a standing feature).

### 6.2 Seed — ~20–30 category buckets, then lazy

- A seed routine upserts the **~20–30 popular `categories`** (milk, bread, eggs, cheese,
  yogurt, butter, flour, sugar, oil, …) by `slug` (`INSERT … ON DUPLICATE KEY UPDATE`), so
  it is **idempotent** and safe to re-run in any environment (arch. §10). Seeded rows carry
  `is_seeded = 1`.
- **Everything beyond the seed fills lazily** (D §4, 02 §7): when a user term or a crawl
  needs a bucket that doesn’t exist, the service creates it on demand. This is the whole
  demand-first point — a handful of buckets, not ~200 pre-enumerated products.

### 6.3 Retention / pruning (`bin/prune.php`, arch. §6.3/§9)

|Table               |Policy                                                                                                                             |Driven by                    |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------|-----------------------------|
|`raw_offers`        |delete `created_at < now − 8 weeks`                                                                                                |`raw_offers (created_at)`    |
|`refresh_tokens`    |delete where `expires_at < now` OR `revoked_at` older than the reuse-detection window                                              |`refresh_tokens (expires_at)`|
|`family_invitations`|mark `expired` past `expires_at`; delete long-dead rows                                                                            |`(family_id, status)`        |
|`crawl_runs`        |keep recent runs for the dashboard; prune very old completed runs (prices already reference `source_url`, and the FK is `SET NULL`)|`(store_id, started_at)`     |

`price_entries`, `purchase_log`, `user_products`, catalog and family tables are **not**
pruned — they are the durable record. Superseded `price_entries` (expired `valid_to`) are
retained as price history, cheap at this scale.

-----

## 7. Resolved physical representations (decided this session)

At the project owner’s direction, this document now **resolves** every item that
`decisions.md §14` had left open — these are **decided**, not proposals, and §8 carries
them as the paste-ready fold-back into `decisions.md §14`. Two are *tunable product/policy
values* (§7.5, §7.6): a sensible default is set now and can be changed later **without a
schema change**.

### 7.1 `normalized_term` normalization rule — **decided**

The `normalized_term` column feeds two jobs with opposite risk profiles: the
`(owner, normalized_term)` **dedup unique** (over-normalizing wrongly *merges* distinct
terms) and **bucket auto-attach** (under-normalizing misses a match).

**MVP normalizer** (deterministic PHP, applied before write):
Unicode NFC → `mb_strtolower` (Cyrillic-aware) → trim → collapse internal whitespace →
strip punctuation/quotes. **No stemming in MVP.** Bulgarian definite-article and plural
suffix folding (`-та/-то/-ът/-ят/-те/-а/-и`) is deliberately **excluded** from the dedup
key because it false-merges (e.g. distinct terms collapsing together) and the dedup key is
unforgiving. If light stemming proves valuable, it should feed the **categorization
matcher** (`05`), not the unique key — i.e. a *separate* match form, leaving
`normalized_term` conservative. **Decided: conservative normalizer, no stemming on the dedup key.**

### 7.2 `brand_anchor` representation — **decided: option (a)**

D §14 listed three candidates: (a) a brand attribute on `store_product`, (b) a finer
sub-bucket, (c) a specific `store_product`.

**Chosen: (a).** `store_products.brand_normalized VARCHAR(120) NULL` (best-effort brand
token extracted during categorization) + `user_products.brand_anchor VARCHAR(120) NULL`
holding the same normalized token, set when the user opts in by choosing an offer (we copy
that offer’s `brand_normalized`). Comparison then narrows an anchored item to in-bucket
offers where `brand_normalized = brand_anchor`, **across all stores**.

- Rejecting **(c)** specific `store_product`: a brand spans chains (Ariel is at Lidl *and*
  Kaufland); pinning to one store_product would destroy the cross-store comparison that is
  the product’s whole point.
- Rejecting **(b)** sub-bucket: a brand is *not* a neutral concept; modelling it as a child
  category violates the “bucket is not a brand” invariant (02 §7) and muddies merge/split.
- A controlled-vocabulary `brands` lookup table (id + `normalized_name`, FK’d from both
  sides) is the natural **Stage-2 refinement** once brand-selection UX wants a canonical
  list; a free token keeps the Stage-1 ingestion path light. **Decided: brand token on both
  sides, matched across stores; `brands` lookup table deferred to Stage 2.**

### 7.3 `purchase_log` offer snapshot — **decided**

D §14 asked: capture the chosen `store_product_id`/price, or stay minimal?

**Chosen: define the snapshot columns now, populate them lazily.** `purchase_log` is
**append-only and only grows**, so an `ALTER` to add columns *later* is the expensive kind
(a long table rewrite). Adding the three nullable columns (`store_product_id`,
`unit_price_cents`, `currency`) at creation costs nothing and future-proofs “what you
actually paid” + receipt reconciliation (D §4). MVP write-path may leave them `NULL`;
recently/frequently-bought work purely off `(owner, user_product_id, purchased_at)`
regardless. **Decided: snapshot columns defined now, populated lazily.**

### 7.4 Where categorization is persisted — **decided**

`category_id` is placed on **`store_products`** (identity), not on a per-offer row, with an
offer’s bucket derived through its product (§4.4 note). This diverges from the literal
`StoreOffer.category_id` wording in `02 §7` / the original brief. Rationale: bucket is
invariant across a product’s many weekly offers, and re-categorization touches one row, not
N. **Decided: `category_id` on `store_products`; an offer’s bucket derives through its
product. Reconcile 02 §7’s link wording.**

### 7.5 “Frequently bought” window & threshold — **decided (tunable default)**

`decisions.md §14` left both the window (all-time vs rolling) and the “frequent” threshold
open. **Decided default: a rolling 8-week window, and a `UserProduct` counts as “frequently
bought” once it has at least 3 `purchase_log` events inside that window.** A rolling window
beats all-time so the list tracks *current* habits, not long-abandoned staples; 8 weeks ≈ 8
shopping trips, and 3 hits in that span marks a real staple without being noisy. Both
numbers are **query parameters, not columns** (the §5.3 index already serves them), exposed
as operator-tunable WP options (arch. §9) — so real usage can re-tune either **with no
migration**.

### 7.6 Refresh-token reuse-detection window — **decided (default; flow in `06`)**

**Decided default:** the refresh token’s lifetime is **30 days** (the `httpOnly` cookie’s
max age); each refresh rotates the token and supersedes the prior one, and superseded tokens
are kept for reuse-detection across the **lineage’s lifetime** (the same 30 days) —
presenting an already-rotated token revokes the whole lineage as a theft signal. This is the
*persistence* default only; the full rotation/verification **flow is `06`’s** (arch. §6.1),
and the prune job (§6.3) deletes tokens past `expires_at`.

### 7.7 Smaller items carried forward — **noted**

- **StoreOffer / Promotion fold into `price_entries`** (§4.5) is **decided** (§8 item 2):
  Promotion-as-flag was already D §4 / 02 §8; the StoreOffer fold is this document’s call.
- **`store_products` identity resolution** when no `source_external_id` exists (fall back to
  `normalized_name` + barcode) is owned by `05`; the schema only provides the columns and
  the optional unique — no decision needed here.

-----

## 8. Amendments to fold back into `decisions.md`

These are **decided** this session at the project owner’s direction. This list is the
paste-ready fold-back: move each from *open* to *resolved* in `decisions.md §14` (and
reconcile `02` where noted).

1. **Categorization persisted on `store_products.category_id`** (identity), an offer’s
   bucket **derived** through its product — realizing 02 §7’s `StoreOffer → CategoryBucket`
   link without per-offer duplication. *Reconcile 02 §7 wording.* (§4.4, §7.4)
1. **`StoreOffer` and `Promotion` are physically one table, `price_entries`** — StoreOffer
   = the priced candidate row; Promotion = `is_promo = 1`. No separate `store_offers` or
   `promotions` table. (Promotion-as-flag already blessed by D §4 / 02 §8; the StoreOffer
   fold is new.) (§4.5)
1. **`normalized_term` MVP normalizer**: NFC + lowercase + trim + whitespace-collapse +
   punctuation-strip, **no stemming** on the dedup key; stemming, if added, feeds the
   categorization matcher, not the unique. (§7.1)
1. **`brand_anchor` = brand token (option a)**: `brand_normalized` on `store_products` +
   `brand_anchor` on `user_products`, matched across stores; `brands` lookup table deferred
   to Stage 2. (§7.2)
1. **`purchase_log` snapshot columns defined now, populated lazily** — to avoid a later
   `ALTER` on an append-only table. (§7.3)
1. **`user_products.is_archived` soft-delete** so deletion never breaks `purchase_log`
   history or the `(owner, normalized_term)` unique slot. (§4.3)
1. **App tables hold `user_id` (`wp_users.ID`) by logical reference, no DB FK**, to keep
   the `AuthProvider` export seam clean (arch. §3/§8). (§2.4)
1. **`schema_version` lives in a WP option**, not a custom table (confirms arch. §10 at the
   schema level). (§6.1)
1. **“Frequently bought” = at least 3 buys in a rolling 8-week window** — a tunable default
   held as operator WP options, re-tunable without a migration. (§7.5)
1. **Refresh-token lifetime 30 days with lineage-wide reuse-detection** — persistence
   default; the rotation/verification flow is specified in `06`. (§7.6)

Genuinely still open — and **not** invented here — are only the host-side
`memory_limit`/`max_execution_time` and the exact MySQL version (D §14), which decide `JSON`
vs `TEXT` for `resume_state` and the `VARCHAR(190)` index-prefix habit; these are host facts
to confirm, not design choices.

-----

## 9. Table → document map

|Need                                                                          |Lives in                           |
|------------------------------------------------------------------------------|-----------------------------------|
|What each table *means* (contexts, entities, invariants)                      |`02-domain-model.md`               |
|Why custom tables fit the architecture; the dependency rule                   |`01-architecture.md`               |
|Crawler parsing → `RawOffer` construction; `store_product` identity resolution|`05-crawlers.md`                   |
|Categorization pipeline internals (fuzzy → barcode → ML)                      |`05-crawlers.md` (+ Catalog 02 §7) |
|JWT internals, refresh-token rotation & reuse-detection flow, CORS            |`06-api-auth.md`                   |
|Comparison & list request/response shapes                                     |`06-api-auth.md` · `07-frontend.md`|
|Offline sync, `client_uuid` replay, last-write-wins UX                        |`07-frontend.md`                   |
|Stage-2/3 storage moves (read replica, managed DB, PDO repos)                 |`08-scaling-migration.md`          |
|Per-stage cost figures; backup/retention risk treatment                       |`09-risks-costs.md`                |

-----

*Last updated: June 2026 · Session 4 (Opus 4.8, Extra effort, Thinking ON) · written
directly against the **demand-first three-layer model** (UserProduct → CategoryBucket →
StoreProduct/StoreOffer). Canonical for **representation** only; meaning defers to `02`,
conventions to `01 §8`, decisions to `decisions.md`. The open questions in §7 are
**resolved** this session at the owner’s direction (two as tunable defaults) and collected
in §8 as ten paste-ready fold-back items for `decisions.md §14`. Table prefix
**resolved** to `oCk_si_` (`$wpdb->prefix` + `si_`, D §6/§14).*