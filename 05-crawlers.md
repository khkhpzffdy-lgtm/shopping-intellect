# 05 — Crawlers

> **Load when:** building or fixing a crawler; a chain changes its site and a parser
> breaks; tuning validation, categorization, rate limits, or the cron schedule; adding a
> fifth chain; debugging why an offer never reached a basket.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton) ·
> `02-domain-model.md` (the meaning) · `04-database.md` (the tables Ingestion writes through).
> **Standalone for:** the crawl subsystem — `AbstractCrawler`, the per-chain parsers,
> `RawOffer` construction, the Ingestion pipeline (validate → resolve → categorize →
> publish), offline re-categorization, CLI execution, scheduling & locking, anti-bot
> handling, and crawler observability. For *meaning* (contexts, invariants, the RawOffer
> lifecycle) → `02` · for *tables/columns/indexes* → `04` · endpoint & auth flow → `06` ·
> PWA sync → `07` · the Stage-2 crawler move → `08` · cost/risk register → `09`.

-----

## 1. Purpose & the boundary

This document is canonical for the **crawl subsystem**: how untrusted text on four
retailer websites becomes validated, categorized, basket-visible prices — and how that
pipeline stays alive on shared hosting maintained by two people. It owns the parsers, the
`RawOffer` hand-off, the Ingestion pipeline, the CLI runners, the schedule, and the
anti-bot posture.

It deliberately does **not** re-decide anything above it. The layering rule (a crawler
depends on `HttpClient`, never WordPress; Services never touch WP; only
`Repositories/Wpdb` touch `$wpdb`) is *arch. §5* and is *applied* here, not argued. The
schema the pipeline writes through — `raw_offers`, `store_products`, `categories`,
`price_entries`, `crawl_runs` — is `04`’s; this document references those tables and never
redefines a column. The *meaning* of each concept and the canonical RawOffer lifecycle are
*02 §3/§9/§10*. Where this document and `02`/`04` seem to overlap, they win on meaning and
representation respectively; `05` wins only on **how the crawl actually runs**.
`decisions.md` (cited *D §n*) is the canon over all of us.

Two framing decisions are fixed before a line is written, and this document does not
relitigate them:

- **Crawlers never write to the database.** A crawler fetches, parses, and emits a
  normalized `RawOffer[]`; `IngestionService` is the *only* thing that validates,
  categorizes and persists (*arch. §5* rule 3, *02 §9*). That boundary is what makes “move
  crawlers to a VPS” a *named* Stage-2 trigger (D §11) instead of a rewrite.
- **Categorization is product-to-*category*, lenient, and non-blocking.** Fitting a
  `StoreOffer` into a `CategoryBucket` is far easier than proving two chains’ milks are the
  *same item*, and an offer that can’t be confidently bucketed is **still validated and
  published** — its price exists, it simply isn’t basket-visible until a bucket lands
  (D §4, *arch. §6.3*, *02 §9/§10*). There is no admin approval queue on the ingestion hot
  path.

-----

## 2. The crawl subsystem at a glance

|Piece                        |Lives in           |WP-coupled?                   |Responsibility                                                                                                                                               |
|-----------------------------|-------------------|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`bin/crawl.php`              |`bin/`             |yes (bootstraps WP, `wp_mail`)|thin CLI entry: parse args, bootstrap `wp-load.php`, acquire/release the lock, invoke the runner, set the exit code, alert on failure                        |
|`CrawlRunner`                |`Services/`        |no                            |orchestrates one run: drives the chain crawler chunk-by-chunk, feeds each chunk to Ingestion, updates the `crawl_runs` row for resumability, finalizes status|
|`AbstractCrawler` + per-chain|`Crawlers/`        |no (depends on `HttpClient`)  |fetch + parse + normalize → emit `RawOffer[]`; **no DB**                                                                                                     |
|`IngestionService`           |`Services/`        |no                            |validate → resolve a `store_product` → categorize → publish a `PriceEntry`; writes via repositories                                                          |
|`MatchingService`            |`Services/`        |no                            |the categorization algorithm (`StoreOffer` → bucket), phased fuzzy → barcode → ML                                                                            |
|shared extractors            |`Support/`         |no                            |`NormalizedName`, `Quantity` extraction, `Money`/BGN handling — reused by every crawler so normalization is identical across chains                          |
|repositories                 |`Repositories/Wpdb`|yes                           |the only code that touches `$wpdb` (*arch. §5* rule 2)                                                                                                       |

`IngestionService` and `MatchingService` are named Services in *arch. §5*. **`CrawlRunner`
is a `05`-named piece** — the orchestration role *arch. §5* leaves implicit in
“`bin/crawl.php` → `Crawlers`”; it is a plain WP-free Service, the CLI counterpart to an
Api controller’s “call a service” glue.

```
cron (Sofia)  ─►  bin/crawl.php  ─►  bootstrap WP  ─►  GET_LOCK("si_crawl_<chain>")
                                                              │
                          ┌───────────────────────────────────┘
                          ▼   CrawlRunner — loop, one chunk at a time:
                  ┌──────────────────────┐     RawOffer[]      ┌──────────────────────────┐
                  │ chain Crawler        │ ─────────────────►  │ IngestionService          │
                  │  fetch (HttpClient   │                     │  1 resolve store_product  │
                  │   + rate limit)      │                     │  2 validate (D §4)        │
                  │  parse (DOM / JSON)  │                     │  3 categorize → bucket    │
                  │  NO DB writes        │                     │     (lenient; may be NULL)│
                  └──────────────────────┘                     │  4 publish PriceEntry     │
                          │                                     └──────────────────────────┘
                          ▼  after each chunk
                  crawl_runs.resume_state + counts  ◄── resumable: a kill continues, not restarts
                          │
                          ▼  on finish
                  status = completed | partial | failed · promo transients invalidated · wp_mail on failure
```

Everything to the left of `RawOffer[]` only fetches and parses; everything to the right of
it writes. That single arrow *is* the Crawling → Ingestion seam.

-----

## 3. AbstractCrawler — the contract & lifecycle

`AbstractCrawler` is the template-method base every chain extends. It is
constructor-injected with the WP-free contracts (`HttpClient`, `Clock`, `Logger`) so it is
unit-testable against a fake HTTP client fed recorded fixtures and never needs a live site
or a WP install — the entire point of *arch. §5* rule 1.

Contract (illustrative pseudo-signatures):

```
abstract class AbstractCrawler {
    public function __construct(HttpClient $http, Clock $clock, Logger $log, ChainConfig $cfg);

    // per-chain: which pages/sections to crawl for this mode
    abstract protected function entryPoints(CrawlMode $mode): iterable;       // URLs / section descriptors

    // per-chain: turn one fetched page into offers (DOM/XPath or embedded JSON)
    abstract protected function parsePage(FetchedPage $page): array;          // RawOffer[]

    // base-provided: the chunked template loop — yields RawOffer[] a chunk at a time
    final public function crawl(CrawlMode $mode, ResumeState $from): Generator;

    // base-provided: polite fetch (headers, delay, retry/backoff) + block detection
    final protected function fetch(string $url): FetchedPage;
}
```

What the **base** provides, identically for all four chains:

- the **chunked template loop**: walk `entryPoints()`, `fetch()` each page, `parsePage()`
  it, and `yield` a `RawOffer[]` chunk so `CrawlRunner` can persist progress and a kill can
  resume (§9.3);
- **polite fetching**: a per-chain rate-limit delay, realistic headers (`User-Agent`,
  `Accept-Language: bg-BG`), and bounded retry with backoff on transient `5xx`/`429`;
- **block detection**: classify a response as *blocked* (HTTP 403/429/503, a
  Cloudflare/Turnstile challenge body, a CAPTCHA marker, or a previously-rich page that
  suddenly parses to zero offers) and raise a typed signal that `CrawlRunner` records as a
  `failed`/`partial` run — **never** a silent “0 offers” (§10);
- **normalization plumbing**: every parsed field is run through the **shared extractors**
  (§4) so `normalized_name`, `Quantity` and `Money` are computed identically across all
  four chains — non-negotiable, because cross-chain categorization compares on exactly
  these.

What each **chain** supplies is only the volatile part: *which pages* to visit and *how to
read a product off one page*. That is the churn *arch. §5* rule 3 isolates — when a chain
redesigns, exactly one `parsePage()` changes, and the other three crawlers, Ingestion, and
comparison are untouched.

A crawler **returns offers; it never persists.** `parsePage()` produces `RawOffer` value
objects (§6) and nothing else — no `$wpdb`, no repository, no `categories` lookup.
Resolution, categorization and writes all happen downstream in Ingestion, behind the seam.

-----

## 4. Parsing toolkit — DOM/XPath, shared extractors, no Composer

The plugin ships **no Composer / no `vendor/`** (D §6, *03 §3.1*); Stage-1 parsing needs
are met by PHP’s standard library:

- **HTML:** PHP’s built-in `DOMDocument` + `DOMXPath`. Load with libxml error suppression
  (real-world retailer HTML is rarely valid), then query with XPath. No Goutte / Symfony
  DomCrawler.
- **Embedded JSON:** where a page carries a JSON island (a
  `<script type="application/ld+json">` `Product` block, or an internal data island feeding
  the storefront), XPath to the `<script>` node and `json_decode` it. **Prefer JSON to
  scraped DOM wherever a chain offers it** — typed keys are far more stable than
  CSS-class-bound selectors.
- **Network:** the `HttpClient` interface — `WpHttpClient` (WP HTTP API) in Stage 1,
  `CurlHttpClient` on a Stage-2 VPS, a `ScrapingBeeHttpClient` if a chain is ever blocked
  (§10). The crawler never calls WP’s HTTP API directly (*arch. §7*).

Three **shared extractors** in `Support/` guarantee cross-chain consistency:

- **`NormalizedName`** — applies the same conservative base normalizer the term key uses
  (*04 §7.1*: NFC → Cyrillic-aware lowercase → trim → collapse whitespace → strip
  punctuation) **plus** unit/weight extraction, so `"Прясно мляко 3.6% 1 л"` yields a clean
  `normalized_name` *and* a separated `Quantity`. The categorization matcher may layer
  *additional* fuzzy transforms (light Bulgarian stemming, synonym/alias expansion) on top
  of this **for matching only** — explicitly the use *04 §7.1* reserves for the matcher
  rather than the unforgiving dedup key.
- **`Quantity` extraction** — parse `г/кг/мл/л/бр/брой/пакет…` out of the name (and any
  dedicated unit-price line such as `лв/кг`), normalized to the `Quantity` value object
  (*02 §3*). Used both in the `RawOffer` and as a categorization signal.
- **`Money` / BGN handling** — construct `Money` (integer euro cents) from the parsed price
  and its currency. During the 2026 dual-display window a chain may print BGN; `Money`
  converts at the fixed **1.95583**, half-up to the cent, and the crawler sets
  `converted_from_bgn` on the offer (*arch. §8*, D §4 — *not* re-decided here). Where both
  EUR and BGN are shown, prefer the printed EUR figure and leave the flag clear.

Barcode extraction is **best-effort and usually absent** on public retailer pages; when a
page exposes an EAN/GTIN (more likely on a real e-commerce backend such as Billa), capture
it — it is what powers Phase-2 categorization (*04 §4.4*, §7.3 below).

-----

## 5. Per-chain crawlers

All four extend `AbstractCrawler` and are built behind the one abstraction from day 1, but
**launch is phased**: the two more tractable chains first, the harder two in weeks 3–6
(D §3). Selectors and JSON key paths are *intentionally not pinned in this document* —
they are exactly the volatile detail that lives inside each `parsePage()`, discovered
against the live site and maintained there. What follows is the **strategy and the fragile
surface** per chain.

Each crawler exposes two kinds of entry point: the **promo landing page** (cheap, and the
daily-delta hash target — §9.5) and the **regular-catalog category pages** (the bulk of a
full crawl — a typical basket is mostly regular-catalog items, so crawling promos only
would make comparison useless, D §4).

### 5.1 Lidl BG — *Medium*

Lidl publishes a weekly leaflet/offers catalog plus a structured online listing, and its
pages **frequently embed structured JSON** (a JSON-LD `Product` block or an internal data
island) alongside server-rendered cards (D §3: “Structured catalog, some JSON in pages”).
**Strategy:** read the embedded JSON first — it gives typed name, price, often package
size, and the product/leaflet URL — and fall back to DOM/XPath over the rendered cards only
where the JSON island is absent. **Entry points:** the weekly-offers landing page (delta
target) plus the leaflet/category pages enumerated from the nav or a sitemap.
**Extraction:** name from the JSON title; price from the JSON price field (watch promo vs
regular, and BGN/EUR dual display); quantity usually inside the name string → shared
extractor; barcode rarely public → typically absent; `source_url` = the product/leaflet
page. **Fragile spots:** the JSON island’s key names/shape changing without notice, weights
buried in free-text names, BG-text promo date ranges, and leaflet pagination.

### 5.2 Kaufland BG — *Medium–High*

A real online catalog, but **expect Cloudflare bot management** (D §3: “Cloudflare
protection likely”) — possibly a JS/Turnstile challenge. **Strategy:** start with the
cheapest thing that works — a server-side GET with honest headers and a polite delay often
clears basic bot rules; parse the product cards and prefer any embedded JSON / `data-`
state the page exposes. **If a JS challenge actually blocks us, that is the trigger** (not a
reason to pre-install a headless browser) for the reactive ScrapingBee/Apify fallback for
*this chain only* (§10, D §5). **Entry points:** the weekly-offers page (delta target) plus
paginated category listings. **Extraction:** name, promo/regular price, quantity from the
name or a `лв/кг` line, barcode usually absent, `source_url` from the card link. **Fragile
spots:** the Cloudflare challenge itself (the dominant risk — it surfaces as 403/503 or
challenge HTML and **must** be detected as a block, never parsed as zero offers), markup
churn, and pagination tokens.

### 5.3 Billa BG — *Medium*

A genuine e-commerce shop (D §3: “Real e-commerce, anti-bot”), which usually means a
structured product/listing endpoint feeding the storefront and real product attributes on
the backend. **Strategy:** prefer the underlying listing JSON if it is discoverable and
stable — far more robust than scraping a rendered SPA, and the one chain most likely to
expose an **EAN/barcode**, which unlocks Phase-2 categorization for Billa (§7.3). Fall back
to DOM/XPath over product tiles otherwise. Respect rate limits; the anti-bot here rewards
header hygiene and pacing over cleverness. **Entry points:** the online-shop category
endpoints and the weekly-offers section (delta target). **Extraction:** name, price,
unit/quantity, barcode where present, product URL as `source_url`. **Fragile spots:** the
internal endpoint is undocumented — it can change shape or start demanding tokens/cookies —
plus SPA pagination/infinite scroll and anti-bot tightening.

### 5.4 Fantastico — *High*

The least structured and most fragile (D §3: “Less structured, fragile crawler”), launched
last. **Strategy:** defensive DOM/XPath scraping that assumes inconsistent layouts across
categories and tolerates missing fields gracefully. Expect the **highest reject/flag rate**
— which is fine, because validation (§7.2) catches garbage and the demand-first model
degrades gracefully. Where promos appear only as flat images or PDFs, some offers are simply
**uncrawlable in MVP** (PDF/brochure OCR is deferred, D §1) — acceptable under broad-crawl.
**Entry points:** the offers/promo page (delta target) plus whatever category pages exist.
**Extraction:** best-effort name and price from HTML, quantity from name text, barcode
essentially never present, `source_url` from the page. **Fragile spots:** effectively
everything — inconsistent class names, mixed/legacy markup, image-only promos, weak
pagination. This is the crawler most likely to be the **“~1 broken at any time”** the
maintenance budget assumes (D §3/§12).

### 5.5 Difficulty & strategy at a glance

|Chain      |Launch (D §3)|Difficulty |Primary parse strategy           |Barcode (Phase 2)  |Dominant fragile surface           |
|-----------|-------------|-----------|---------------------------------|-------------------|-----------------------------------|
|Lidl BG    |Day 1        |Medium     |embedded JSON first, DOM fallback|rare               |JSON island shape; weights in names|
|Kaufland BG|Day 1        |Medium–High|DOM cards (+ JSON where present) |rare               |Cloudflare challenge; pagination   |
|Billa BG   |Weeks 3–6    |Medium     |underlying listing JSON first    |sometimes available|undocumented internal endpoint     |
|Fantastico |Weeks 3–6    |High       |defensive DOM/XPath              |effectively never  |inconsistent / image-only markup   |

-----

## 6. RawOffer — the hand-off contract

This is the single DTO that crosses the Crawling → Ingestion seam (*02 §3/§9*). It is an
immutable plain-PHP value object in `Models/`; constructing one is the crawler’s entire
output. It is **also** staged to `raw_offers` for audit + offline re-categorization
(*04 §4.6*) — but that staging is Ingestion’s write, not the crawler’s.

The exact fields a parser fills (extending the core list in *02 §3*; the staged-row layout
is *04 §4.6*):

|Field               |Source                           |Note                                                                                                                                                    |
|--------------------|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
|`source_name`       |the page, verbatim               |raw Bulgarian name as crawled — never cleaned in place (kept for audit + re-normalization)                                                              |
|`normalized_name`   |shared `NormalizedName`          |lowercased, unit/weight extracted — the fuzzy-categorization + search key (*arch. §8*)                                                                  |
|`quantity`          |shared `Quantity` extractor      |amount + unit pulled from the name / unit-price line (*02 §3*)                                                                                          |
|`price` (`Money`)   |the page → `Money`               |integer euro cents; BGN converted at construction (§4)                                                                                                  |
|`converted_from_bgn`|set by the crawler               |`true` only when the source figure was BGN (*arch. §8*); **canonical on `raw_offers`** (*04 §2.3*)                                                      |
|`store` ref         |the run context (`--chain`)      |the crawler is built for one chain → one `store_id`; a missing store ref is an internal guard, not a parse miss                                         |
|`source_url`        |the page                         |audit + user back-link (D §4)                                                                                                                           |
|`content_hash`      |computed at parse                |deterministic hash over the salient parsed fields → idempotent re-ingest & per-offer change detection (*04 §5.5*, *02 §3*)                              |
|`source_external_id`|the page, where present          |the chain’s own SKU id — the strongest cross-crawl identity anchor for `store_product` resolution (*04 §4.4*); often `NULL`                             |
|`barcode`           |the page, where present          |EAN/GTIN; usually absent; feeds Phase-2 categorization (§7.3)                                                                                           |
|`is_promo` (hint)   |the source section / struck price|the crawler knows whether it read the offer off a promo surface; Ingestion uses it to set `price_entries.is_promo` and choose the validity window (§7.5)|

Two clarifications so the contract is unambiguous:

- **`is_promo` and price validity are *publish-time* attributes, not staged fields.**
  `raw_offers` (*04 §4.6*) stores neither an `is_promo` column nor `valid_from/valid_to`;
  promotion-ness flows through to `price_entries.is_promo`, and the validity window is
  computed by Ingestion from the Sofia promo-week calendar (§7.5). Staging exists for
  *identity and audit*, and live promo state is always refreshed by the weekly crawl — it
  is never reconstructed from stale staged rows, so it need not persist on the raw offer.
- **The crawler resolves no identity and assigns no category.** It fills
  `source_external_id`/`barcode`/`normalized_name` as *signals*; turning those into a
  concrete `store_product` and a bucket is Ingestion’s job (§7.1, §7.3). This keeps the
  crawler free of every catalog lookup.

-----

## 7. Ingestion — validate → resolve → categorize → publish

`IngestionService` is the only bridge from the high-churn crawl world into the stable
pricing world (*02 §9*). It consumes a `RawOffer[]` chunk and, per offer, runs the sequence
below, writing exclusively through repositories (*arch. §5* rules 1–2). It realizes the
canonical lifecycle of *02 §10* (*fetched → parsed → validated → categorized → published*);
`05` fixes the **operational ordering** that lifecycle leaves implicit — in particular that
**`store_product` resolution runs first**, because both the deviation check and the
per-category ceiling need a product (and its history/category) to judge against.

### 7.1 Resolve the `store_product` (identity)

Map the offer to exactly one `store_products` row for this chain (*04 §4.4*), creating one
only if it is genuinely new:

1. **By `source_external_id`** when the page exposed a SKU id — the strongest, cheapest
   anchor (`store_products (store_id, source_external_id)` unique, *04 §5.4*).
1. **By barcode** when present — match an existing `store_product` carrying the same
   `barcode_value` (*04 §4.4*/§5.1).
1. **By `normalized_name` (+ `Quantity`)** otherwise — fuzzy-match within this store’s
   products; above threshold reuse, below threshold create a new `store_product` (still
   uncategorized at this point).

Resolution is **per-store** (a `store_product` belongs to one chain); cross-store
relationships are expressed only later, through the shared bucket. The resolved
`store_product_id` is recorded on the staged `raw_offer` (*04 §4.6*).

### 7.2 Validate (D §4)

Rule-based, auto-publishing, **no admin queue** (D §4):

|Check                                                        |Action                                                                                                                                                  |
|-------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
|`price ≤ 0`                                                  |**reject**                                                                                                                                              |
|missing product name                                         |**reject**                                                                                                                                              |
|missing store id                                             |**reject** (defensive — store comes from run context, so this should never fire)                                                                        |
|per-category sane max ceiling                                |**reject** *when a category is known* — applied to an already-categorized product immediately, and to a freshly-categorized new product right after §7.3|
|price deviates > 50 % from the product’s last published price|**flag, still publish** — record `data_quality_score`, surface in Admin, never hide                                                                     |

Every offer carries `data_quality_score` + `source_url`. **Rejected offers are retained**,
not deleted: the staged `raw_offer` is marked `rejected` with a `rejection_reason`, visible
in the Admin dashboard, never surfaced to users (*02 §10*, *04 §4.6*). Validation **never
silently drops data** (*arch. §12*).

### 7.3 Categorize — `StoreOffer` → `CategoryBucket` (lenient, phased)

Categorization is **product-to-category** and is persisted on the **product** —
`store_products.category_id` — so an offer’s bucket is *derived through its product*, and a
bucket is invariant across a product’s many weekly offers (*04 §7.4*; this is `04`’s
representation of *02 §7*’s `StoreOffer → CategoryBucket` link). `MatchingService`
(*arch. §5* rule 5) assigns it in phases:

- **Phase 1 — fuzzy name.** Score the offer’s `normalized_name` (+ `Quantity`) against
  (i) the per-bucket lexical signals seeded for the ~20–30 core buckets and (ii) the growing
  corpus of `normalized_name`s already categorized into each candidate bucket; assign the
  best bucket above a confidence threshold. **Where these per-bucket signals live is a
  `05`/config concern** — operator-tunable WP options alongside the category price ceilings
  (*arch. §9*), **not** a new schema column; if they ever need to be DB-backed, that is a
  future additive change to record in `decisions.md`, *not* made here.
- **Phase 2 — barcode.** When the offer carries an EAN/GTIN already mapped to a categorized
  `store_product` (across any store), inherit that bucket — the strong signal *04 §5.1*’s
  barcode index exists for (“all products sharing this barcode → one bucket”).
- **Phase 3 — ML-assisted.** Stage 3 only (D §4) — direction, not built; fuzzy + barcode
  are the MVP.

**Lenient and non-blocking, by design.** Below threshold with no barcode, the product stays
**uncategorized** (`category_id` `NULL`): its price is still published (§7.5), it just does
not appear in any bucket and so is not basket-visible until a later pass categorizes it
(*02 §9/§10*, D §4). A debatable offer landing in a roughly-right bucket costs nothing
because the user sees every candidate and judges by eye (D §10); mis-categorization
degrades to an odd extra candidate, never a corrupted identity. If a brand-new product just
received its first category here, the per-category ceiling (§7.2) is applied now as a
deferred check.

A bucket the offer needs may not exist yet: buckets fill **lazily** (D §4) — if matching
points at a concept with no bucket, the bucket is created on demand (`categories` upsert by
slug, *04 §6.2*). The matcher gets better for free as the categorized corpus grows; nothing
about that requires a code change or a re-crawl.

*(The mirror-image problem — attaching a* user’s *`normalized_term` to a bucket — uses the
same normalized-form + fuzzy machinery but is a Shopping-List / write-time concern; its
specifics live with `02`/`04`/`06`, not here.)*

### 7.4 Money & currency on ingest

Already settled upstream and **not re-decided**: prices are integer euro cents in `Money`;
BGN figures from the dual-display window were converted at the fixed **1.95583**, half-up,
with `converted_from_bgn` set on the raw offer (*arch. §8*, D §4, §4 above). Ingestion
mirrors `converted_from_bgn` onto the published `price_entries` row as cheap provenance
(*04 §2.3*); the canonical flag stays on `raw_offers`.

### 7.5 Publish — `PriceEntry` / `Promotion`

Publishing writes the validated price to `price_entries` (*04 §4.5*) — the only table
comparison reads (*arch. §6.2*). `price_entries` is also the physical home of *02*’s
`StoreOffer` (the priced, selectable candidate) and `Promotion` (a row with `is_promo = 1`)
— one table, by *04 §4.5*; `05` does not re-open that fold, it just writes it correctly:

- **Validity (*arch. §8*).** A **regular** price is published with `valid_from = now`,
  `valid_to = NULL` (open-ended until superseded). A **promo** (the offer’s `is_promo` hint,
  §6) is published with the current Sofia promo week as its validity — `valid_from` = this
  week’s Thu 00:00, `valid_to` = Wed 23:59 — computed from the promo-week calendar, never a
  stored `is_current` flag.
- **Supersession.** Before inserting a new regular price for a product, **close the prior
  open-ended entry** (set its `valid_to = now`) and insert the new `[now, NULL)` row;
  superseded rows are retained as price history (*04 §6.3*). Concurrent regular + promo
  prices simply coexist as two current rows; “promo wins while its `Validity` is current” is
  resolved at *read* time in comparison (*02 §8*, *04 §5.1*), not by deleting the regular
  price.
- **Idempotence.** An offer whose `content_hash` already exists for the chain in the current
  window is a no-op re-observation (*04 §5.5*) — so a run can re-enter a chunk after a
  resume without double-writing.

A published price whose product is still uncategorized exists and is correct; it is simply
**not basket-visible** until §7.3 assigns a bucket. Publication of the price and assignment
of the bucket are distinct steps (*02 §10*).

-----

## 8. Offline re-categorization & re-normalization (no re-crawl)

Because raw offers are **staged for 8 weeks** (*04 §4.6*, *arch. §6.3*) and the
categorization input (`normalized_name`, barcode, the categorized corpus) is already
persisted, the catalog can be **improved without touching the network** — the property
*02 §9/§10* calls out and the demand-first model leans on. Two distinct offline passes, both
**on-demand** (operator-triggered after shipping a better algorithm, *not* scheduled):

- **Re-categorize** (the *matcher* improved): re-run `MatchingService` over `store_products`
  — especially `category_id IS NULL` ones — and update the bucket assignment (*04 §7.4*). No
  crawl, no parse; it reads existing products + the corpus. This is the common case and the
  reason leniency is safe: today’s unmatched offer becomes tomorrow’s matched one for free.
- **Re-normalize / re-ingest** (the *parser/normalizer* improved): re-run normalization +
  resolution over the **staged `raw_offers`**, correcting `normalized_name`/`Quantity` and
  re-resolving identity, then re-categorize. Rarer, and bounded by the 8-week staging window.

Both run as a **`bin/recategorize.php`** CLI (`05`-named, `bin/` pattern) guarded by its own
`GET_LOCK` so it never races a live crawl’s Ingestion writes to the same tables. Neither
re-opens the network nor re-publishes promo windows from stale data — live prices are always
the weekly crawl’s job (§7.5).

-----

## 9. CLI execution, scheduling & locking

### 9.1 `bin/crawl.php`

The CLI entry, run by CPanel **system** cron (real cron, not WP pseudo-cron — D §5). It is
thin glue, the CLI counterpart to a thin Api controller (*arch. §5* rule 4):

- `--chain=lidl|kaufland|billa|fantastico` and `--mode=full|delta`.
- **Bootstraps `wp-load.php`** so repositories (`$wpdb`) and `wp_mail` are available. CLI
  mode bypasses the web server’s `max_execution_time`, and `memory_limit` is far higher than
  a web request’s (*arch. §3*) — **confirm both on SuperHosting before the crawler build**
  (D §14; chunking, §9.3, makes memory pressure a non-issue regardless).
- **One OS process per chain** — failure isolation by construction: one chain’s crawler
  crashing, hanging, or being blocked never touches the other three (*arch. §3*, *§12*).
- Acquires the lock (§9.2), invokes `CrawlRunner`, sets a **non-zero exit code** on
  `failed`/`partial`, and fires a `wp_mail` alert on failure (*arch. §9*). The `bin/` entry
  may use WP freely; the crawler classes it drives may not.

### 9.2 Concurrency — `GET_LOCK` per chain

Each run guards with the MySQL named lock **`GET_LOCK("si_crawl_<chain>")`** (*arch.
§6.3/§9*) — no filesystem permissions to fight on shared hosting. The lock is
**connection-scoped**, held by the CLI process’s DB connection for the run’s duration and
auto-released if the process dies. A **per-chain** name means chains never block one
another; it does mean a still-running Thursday full crawl will make that chain’s daily delta
a no-op until it finishes (§9.5), which is the intended safety, not a bug.

### 9.3 Chunked & resumable runs

`CrawlRunner` persists progress to **`crawl_runs.resume_state`** (*04 §4.6*; `JSON`, or
`TEXT` on an older MySQL — D §14) after **every chunk**: the current section/category
cursor, the page within it, and the set of completed chunks. A host-side kill therefore
**resumes, not restarts** (*arch. §6.3*, *§12*):

- On start for a chain, the runner looks for a recent unfinished run (`status='running'`/
  `'partial'`, `finished_at IS NULL`); if the lock is now free (the prior process died) and
  the run is recent, it **continues from `resume_state`** — otherwise it opens a fresh run.
- Counts (`offers_seen` / `offers_published` / `offers_rejected`) accrue on the run row for
  the dashboard (*04 §4.6*, §11).
- On clean completion the run is `completed` (or `partial` if some sections failed or were
  blocked), `finished_at` is set, and the chain’s cross-user promo transients are
  invalidated so the next browse reflects fresh data (*arch. §9*).

### 9.4 Cron schedule (Sofia)

`05` implements, but does not change, the schedule fixed in *arch. §9* (Thursday aligns with
BG promo rotation, D §4):

|Job                                                  |When (Sofia)                     |Entry                                |
|-----------------------------------------------------|---------------------------------|-------------------------------------|
|Full crawl, per chain (staggered ~1h)                |Thu 01:00 / 02:00 / 03:00 / 04:00|`bin/crawl.php --chain=X --mode=full`|
|Delta check, all chains                              |daily 06:00                      |`bin/crawl.php --mode=delta`         |
|Prune (raw offers, tokens, expired invites, old runs)|Sun 05:00                        |`bin/prune.php`                      |

Staggering keeps the four full crawls from overlapping in one host window and preserves
failure isolation. `bin/prune.php` enforces the retention table in *04 §6.3* (raw offers at
8 weeks, etc.) — its policy is `04`’s; `05` only schedules it.

### 9.5 Daily delta check

A lightweight change detector (*arch. §6.4*, D §4), **not** a full re-crawl. For each chain:
GET the promo landing page, hash it, compare to `stores.delta_page_hash` (*04 §4.4*); on
change, **trigger a partial crawl of that chain** (at least its promo surface) and update
`delta_page_hash` + `delta_checked_at`. The delta sweep itself runs as a single all-chains
process recorded as a `crawl_runs` row with `store_id = NULL` (*04 §4.6*); it does **not**
hold per-chain crawl locks while merely hashing — when it fires a partial crawl for a changed
chain, *that* crawl acquires `si_crawl_<chain>`. The page-level `delta_page_hash` is a coarse
“did promos rotate?” signal, distinct from the per-offer `content_hash` Ingestion uses for
idempotence (§7.5).

-----

## 10. Anti-bot & resilience

The posture is **respectful, reactive, and budget-bounded** (D §3/§5/§12):

- **Respectful by default.** One process per chain (already serial per chain), a per-chain
  configurable inter-request delay, realistic headers (`User-Agent`, `Accept-Language: bg-BG`), bounded retry/backoff on `429`/`5xx`. Rate limits are operator-tunable WP options
  (*arch. §9*). We are a small, low-priority, public-data crawler in an EU grey zone and do
  not resell raw data (D §12) — behaving politely is both ethics and self-interest.
- **Detect blocks explicitly — never fake success.** A `403`/`429`/`503`, a
  Cloudflare/Turnstile challenge body, a CAPTCHA marker, or a page that previously yielded
  many offers and now yields zero is classified as **blocked** by the base fetcher (§3) and
  recorded as a `failed`/`partial` run with a clear `error_summary`. The cardinal sin is
  parsing a challenge page as “this chain has 0 products,” which would silently wipe a
  chain’s prices from comparison; block detection exists precisely to prevent it. Existing
  prices then **age visibly** (“updated X days ago”, D §4) rather than vanishing.
- **Reactive proxy fallback (Stage 1.5).** ScrapingBee / Apify (~€5–20/mo, D §5) is
  introduced **the day a specific chain is actually blocked** — per chain, never preemptively
  (D §5). Because fetching is behind the `HttpClient` seam (*arch. §7*), this is an
  implementation swap (a `ScrapingBeeHttpClient` for that one chain), **not** a crawler
  rewrite — the same seam that turns `WpHttpClient` into `CurlHttpClient` on a VPS.
  Kaufland’s likely Cloudflare protection (§5.2) is the most probable first trigger.
- **Budget & expectations.** Each crawler is ≈ 20–40 h initial + 2–5 h/mo upkeep; budget
  **5–10 h/month** across all four and **expect ~1 broken at any time** (D §3/§12). The
  isolation (one `parsePage()` per chain), explicit block detection, and monitoring (§11)
  are what keep that number small enough for two people — the concrete cash-out of *arch.
  §5* rule 3.

-----

## 11. Observability & health

`crawl_runs` is the **source of truth for crawler health** (*arch. §9*, *04 §4.6*):

- **Admin dashboard** reads it for per-chain last-run status, `offers_seen`/`published`/
  `rejected` counts, the last `error_summary`, and `resume_state` — plus the staged
  `raw_offers` view (rejected rows with reasons, never shown to users, *02 §10*). This is the
  operator’s window into “is everything crawling, and is the data clean?”
- **`GET /wp-json/si/v1/health`** reports app liveness and the **age of the last successful
  crawl per chain**, derived from the `crawl_runs (store_id, started_at)` index (*04 §5.5*),
  and is polled by a free UptimeRobot check (*arch. §9*).
- **Alerts:** a `failed`/`partial` run fires a `wp_mail` from `bin/crawl.php` (§9.1, *arch.
  §9*). No external APM in Stage 1 — it waits for a Stage-2 trigger (*arch. §9*).
- **User-facing staleness:** the same per-chain crawl recency feeds the “updated X days ago”
  the UI shows on prices (D §4) — staleness is transparent, never hidden (*arch. §12*).

-----

## 12. Open questions this document inherits

Recorded in `decisions.md §14` and *referenced, not resolved* here:

- **SuperHosting `memory_limit` / `max_execution_time` for PHP CLI** — confirm before the
  crawler build (D §14). PHP CLI via cron already bypasses web request limits (*arch. §3*),
  and chunked runs (§9.3) bound memory regardless; this is a host fact to verify, not a
  design choice.
- **`resume_state` storage type** — `JSON` vs `TEXT` for `crawl_runs.resume_state` depends on
  the exact MySQL version (*04 §8*, D §14).
- **`normalized_term` normalization** (D §14) is decided conservatively for the *dedup key*
  (*04 §7.1*); any **light stemming for matching** belongs to this subsystem’s categorization
  matcher (§4, §7.3), kept separate from that key — a tuning detail, not a blocked decision.

A practical unknown that is *not* a `decisions.md` item: **per-chain barcode availability** is
discovered at implementation and determines how much Phase-2 categorization coverage each
chain can actually contribute (§5, §7.3). It changes coverage, not design.

-----

## 13. Crawler → document map

|Need                                                                                                                              |Lives in                                                   |
|----------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
|What a `RawOffer`/`CrawlRun`/bucket *means*; the canonical RawOffer lifecycle                                                     |`02-domain-model.md` (§3/§9/§10)                           |
|The layering & dependency rule the crawler obeys                                                                                  |`01-architecture.md` (§5/§6.3)                             |
|Tables, columns, indexes the pipeline writes through (`raw_offers`, `store_products`, `categories`, `price_entries`, `crawl_runs`)|`04-database.md`                                           |
|`store_product` identity-resolution columns; the trust-hinge `category_id`                                                        |`04-database.md` (§4.4/§7.4) — *algorithm* here (§7.1/§7.3)|
|DOM/XPath & `HttpClient`; the no-Composer rationale                                                                               |`03-tech-stack.md` (§3.1)                                  |
|JWT/auth, CORS, the `/health` endpoint shape                                                                                      |`06-api-auth.md`                                           |
|How “updated X days ago” / offline data is shown to users                                                                         |`07-frontend.md`                                           |
|Moving crawlers to a VPS (the Stage-2 trigger & runbook)                                                                          |`08-scaling-migration.md`                                  |
|Crawler cost band, ToS / anti-bot risk treatment, maintenance budget                                                              |`09-risks-costs.md`                                        |

-----

*Last updated: June 2026 · Session 5 of 6 (Opus 4.8, Max effort, Thinking ON) · written
from scratch against the **demand-first three-layer model**. Canonical for the **crawl
subsystem** only: `AbstractCrawler` + per-chain parsers (strategy, not pinned selectors),
`RawOffer` construction, the Ingestion pipeline (validate → resolve → categorize → publish,
lenient & non-blocking), offline re-categorization, CLI execution, scheduling & `GET_LOCK`,
anti-bot, and observability. Meaning defers to `02`, representation to `04`, conventions to
`01 §8`, and every decision to `decisions.md`. Crawlers never write the DB; categorization is
product-to-category and persisted on `store_products.category_id` (per `04 §7.4`);
`StoreOffer`/`Promotion` are `price_entries` rows. Open items (host
`memory_limit`/`max_execution_time`, `resume_state` `JSON`/`TEXT`) are left to D §14, not
invented. Placeholder `<TABLE_PREFIX>` retained throughout.*