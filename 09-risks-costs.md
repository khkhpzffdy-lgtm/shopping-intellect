# 09 — Risks & Costs

> **Load when:** assessing a risk; budgeting a stage; reviewing the security posture before
> a release; deciding whether a deferred-complexity trade-off still holds.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the
> security / observability / backup posture) · `03-tech-stack.md` (the cost bands) ·
> `08-scaling-migration.md` (the extraction targets being costed).
> **Standalone for:** the consolidated risk register, the per-stage cost model, the
> hardening checklist, the backup / retention treatment, and the deliberate-trade-off
> ledger. For trigger / runbook detail → `08` · tool & version gating → `03` · schema,
> prune & retention mechanics → `04 §6` · crawler & anti-bot specifics → `05` · auth-flow
> detail (rate-limit thresholds, token rotation) → `06`.

-----

## 1. Purpose & framing

This document consolidates **risk, cost, and hardening**. It introduces no architecture or
tools — it *assesses* what `decisions.md` / `01` / `03` already decided. Two framing
constraints, inherited verbatim:

> **Stage 1 = €0 additional infrastructure** — only already-paid-for resources plus free
> tiers (D §5). Paid services enter **only when a named bottleneck fires** (D §11, `08`).

> This document uses **cost *bands*, not invented monthly figures.** Where no figure is
> established in `decisions.md` / `03`, it gives a qualitative range and **says so**.
> (03 §4/§5)

Costing references the *what* of each extraction from `08`; the *how* (runbooks, seams)
stays in `08`. The hardening checklist promised by `arch. §9` is delivered here, in full,
as the canonical version.

-----

## 2. Risk register (extends `decisions.md §12`)

Severity is the residual level **after** the listed mitigation. “Stage” is the stage that
*carries* the risk (where it is live and must be managed). The demand-first reframe from
`D §12` is carried explicitly; the rows below `#8` extend `D §12` with risks the
architecture implies but `D §12` did not enumerate.

|# |Risk                                                       |Severity             |Carried in|Mitigation (ref)                                                                                                                                                                                                                                                                                                                       |
|--|-----------------------------------------------------------|---------------------|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1 |Anti-bot blocking by chains                                |**High**             |Stage 1+  |Phased crawling, respectful rate limits, per-chain process isolation; **reactive** proxy fallback (ScrapingBee / Apify, Stage 1.5) only when a chain actually blocks us (D §5, §6 below, `05`)                                                                                                                                         |
|2 |Product **categorization** quality *(demand-first reframe)*|**Medium** (was High)|Stage 1+  |Now product-to-**category**, not product-to-product identity; **lenient** categorization + the “see all candidates” UI make mis-categorization non-fatal — it degrades gracefully (an odd extra candidate), it does not corrupt a trusted identity. Backed by fuzzy + barcode and admin **bucket** merge/split (D §4/§12, 02 §7, 00 §3)|
|3 |**UserProduct sprawl / messy user terms**                  |**Low**              |Stage 1+  |Owner-scoped — never pollutes the shared catalog — and deduped per `(owner, normalized_term)`; worst case is a slightly messy *personal* term list, fixable by the user (`is_archived` soft-delete) (D §12, 02 §6, 04 §4.3)                                                                                                            |
|4 |Crawler maintenance burden (4 chains)                      |**High**             |Stage 1+  |Isolated crawler classes; monitoring via `<TABLE_PREFIX>_crawl_runs` + `/health` alerts; **5–10 h/month time budget** (a *time* cost, not money — §4) (D §3/§12, arch. §9)                                                                                                                                                             |
|5 |ToS violation / cease-and-desist                           |**Medium**           |Stage 1+  |EU public-data grey zone; small, low-priority target; **no reselling of raw data** (D §12)                                                                                                                                                                                                                                             |
|6 |SuperHosting `memory_limit` / `max_execution_time` (CLI)   |**Medium**           |Stage 1   |**Open host-side risk — verify before the crawler build** (D §14, §7). PHP CLI via cron *should* bypass web limits (arch. §3); chunked + resumable runs are the mitigation if limits bite (arch. §6.3); the VPS move is the escalation (08 §3.1)                                                                                       |
|7 |Family sync conflicts                                      |**Low** (MVP)        |Stage 1   |Last-write-wins on the server clock + “updated X sec ago”; no real-time sync in MVP (D §9)                                                                                                                                                                                                                                             |
|8 |Scope creep (14 → 6 modules)                               |**High**             |All stages|`decisions.md` is the boundary; defer everything not in `D §1` (D §12, 00 §7)                                                                                                                                                                                                                                                          |
|9 |Single-host SPOF / total backend outage                    |**Medium**           |Stage 1   |Offline-first PWA keeps the **most frequent action** (in-store list use) alive through a full backend outage; comparison degrades with a clear message; structurally relieved by the Stage-3 HA move when justified (arch. §12, D §7, 08 §5)                                                                                           |
|10|Data loss / no point-in-time recovery on shared hosting    |**Medium**           |Stage 1   |Host backups + weekly `mysqldump` of `<TABLE_PREFIX>_*` + periodic off-host download; RPO = “since last dump” — **accepted at this scale**, revisited at the managed-DB move which brings provider PITR (§5, arch. §9, 08 §3.3/§5)                                                                                                     |
|11|Refresh-token theft / replay                               |**Medium**           |Stage 1   |Rotating refresh token in an httpOnly Secure cookie; **lineage-wide reuse-detection** revokes on replay; short-lived in-memory access JWT bounds blast radius (04 §7.6, flow in `06`, arch. §8)                                                                                                                                        |
|12|JWT staleness (membership lags ≤ 15 min)                   |**Low**              |Stage 1   |Accepted trade-off; family-mutating endpoints return a fresh token to shortcut the lag (arch. §6.1, 02 §4)                                                                                                                                                                                                                             |
|13|XSS → token exfiltration                                   |**Medium**           |Stage 1   |Access JWT **in memory only** (never `localStorage`); refresh token in an httpOnly cookie; standard output encoding in the React app (arch. §6.1; hardening §3)                                                                                                                                                                        |
|14|CORS / cross-site-cookie misconfiguration                  |**Medium**           |Stage 1   |The **one-domain rule** (`app.<domain>` + `www.<domain>`, same registrable domain) keeps the refresh cookie same-site; **exact-origin** CORS, never `*`, `Allow-Credentials: true`. A misconfig breaks sessions silently — so the domain rule is a hard prerequisite (arch. §4; hardening §3)                                          |
|15|Cloudflare free-tier dependency                            |**Low**              |Stage 1   |Fronts both origins (arch. §4); a Pages outage still serves the SW-cached shell to returning users (arch. §12); accepted single-vendor edge dependency                                                                                                                                                                                 |
|16|Crawl-data poisoning / garbage in                          |**Low–Medium**       |Stage 1+  |Rule-based validation (reject price ≤ 0 / missing name / missing store ID; per-category ceiling; > 50 % deviation flag); `data_quality_score` + `source_url`; rejected offers retained for audit, never surfaced to users (D §4, 02 §10, 04 §4.6)                                                                                      |
|17|Shared-host disk exhaustion (`raw_offers` growth)          |**Low**              |Stage 1   |**8-week prune** of `<TABLE_PREFIX>_raw_offers` via `bin/prune.php`; price history retained (cheap at this scale) (arch. §6.3, 04 §6.3, `05`)                                                                                                                                                                                          |
|18|Overlapping crawl runs                                     |**Low**              |Stage 1+  |MySQL `GET_LOCK("si_crawl_<chain>")` guard (spans hosts after the VPS move — 08 §3.1); resumable `crawl_runs` state (arch. §6.3)                                                                                                                                                                                                       |
|19|Two-person bus factor / maintenance bandwidth              |**Medium**           |All stages|Small dependency surface (no Composer, no Redis-by-default), boring `git pull` deploys, document-driven coordination; **deferring complexity aggressively is itself the mitigation** (D §1, 00 §7, §6 below)                                                                                                                           |
|20|Stage-3 provider lock-in (managed DB undecided)            |**Low** (deferred)   |Stage 3   |Provider deliberately **open** (PlanetScale / Supabase / RDS — 03 §5/§7, 08 §5); clean `<TABLE_PREFIX>_*` tables + PDO repos keep the move portable (04 §2.1, 08 §4)                                                                                                                                                                   |

### The risks that actually decide the project

- **Crawler-facing risks (#1, #4) are the live, recurring cost.** Anti-bot blocking and
  4-chain maintenance are the two High risks that persist every week of Stage 1. Both are
  managed by *isolation* (one broken chain never blocks the others — arch. §12) and a
  standing **time** budget (#4), not by money — the money cost (reactive proxies) is itself
  contingent (#1, §4, §6).
- **Categorization (#2) is no longer the make-or-break.** The demand-first reframe is the
  single biggest change to this register: the dominant technical risk dropped from **High**
  to **Medium** because the problem became product-to-**category** (easy, graceful failure)
  instead of product-to-product identity (hard, corrupting failure) (D §4, 00 §3). It is now
  *one important risk among several*, alongside #1/#4 and the perennial #8.
- **Scope creep (#8) is the perennial non-technical risk.** It is carried in **every**
  stage, and its only mitigation is discipline: `decisions.md` is the boundary (00 §7).
- **The host-limit unknown (#6) is the one open Stage-1 risk to retire early.** It is the
  flagged host-side item — verify before the crawler build (§7).

-----

## 3. Hardening checklist (the one `arch. §9` promised)

The canonical, auditable list. It consolidates the security statements scattered through
`arch. §4/§8/§9` and `04 §7.6` into one place; the **exact values** (rate-limit thresholds,
token-rotation flow, CORS header strings) live in `06` and are referenced, not invented
here.

**Auth & tokens**

- [ ] Access JWT short-lived (~15 min), **held in memory only** — never `localStorage` /
  `sessionStorage` (XSS containment) (arch. §6.1/§8).
- [ ] Refresh token in an **httpOnly, `Secure`** cookie; `SameSite` set to suit the
  one-domain layout (arch. §4/§8).
- [ ] Refresh-token **rotation + lineage-wide reuse-detection** (a replayed, already-rotated
  token revokes the whole lineage); 30-day lifetime (04 §7.6; flow in `06`).
- [ ] **Rate-limit the auth endpoints** — transient counters per IP + identifier
  (arch. §9; thresholds in `06`).
- [ ] JWT signed with `hash_hmac` using `SI_JWT_SECRET`; verify signature **and** expiry on
  every request; the **claim set is the contract** (arch. §7/§8).

**Transport & origin**

- [ ] **Exact-origin CORS** — `Access-Control-Allow-Origin: https://app.<domain>`, never
  `*`; `Allow-Credentials: true`; answer preflight `OPTIONS` (arch. §4; headers in `06`).
- [ ] **One-domain rule** enforced (PWA + API share one registrable domain) so the refresh
  cookie stays same-site (arch. §4).
- [ ] TLS everywhere — Cloudflare fronts both origins (arch. §4).

**Data access**

- [ ] **Prepared statements only**; all `$wpdb` access confined to `Repositories/Wpdb`
  (arch. §5 rule 2, §9).
- [ ] Input validation at the controller edge; typed DTOs into Services (arch. §5 rule 4).

**WordPress surface reduction**

- [ ] App users hold the **zero-capability `si_user` role** and are **blocked from
  `wp-admin`** (arch. §3/§8/§9).
- [ ] **XML-RPC disabled**; other unused WP surface locked down (pingbacks, author
  enumeration, public REST user listing) (arch. §9).
- [ ] Registration only through `si/v1` endpoints, never WordPress’s own (arch. §3).

**Secrets & config**

- [ ] Secrets (`SI_JWT_SECRET`, Google client ID / secret) in **`wp-config.php` constants** —
  never in the DB, never in the repo (arch. §9).
- [ ] Operator-tunable values (rate limits, crawl toggles, category price ceilings) as WP
  **options** with an Admin UI — these are config, not secrets (arch. §9).

-----

## 4. Per-stage cost model (bands only)

**Every figure below is a band or an established value, never an invented monthly sum.**
Where a provider is undecided, the figure is explicitly an *estimate range*, not a quote.

### 4.1 Stage 1 — €0 additional (broken down by component)

The €0 figure is the *established* target (D §5), not an estimate. The breakdown:

|Component                |Host / service                      |Cost                 |
|-------------------------|------------------------------------|---------------------|
|WordPress backend + MySQL|SuperHosting (existing)             |€0 — **already paid**|
|Crawler scheduling       |CPanel **system** cron              |€0                   |
|Frontend PWA             |Cloudflare Pages                    |€0 (free)            |
|CDN / DDoS / TLS         |Cloudflare free tier                |€0 (free)            |
|Uptime monitoring        |UptimeRobot free check on `/health` |€0 (free)            |
|Auth (JWT + Google)      |In-plugin `hash_hmac` + Google login|€0                   |
|**Total additional**     |                                    |**€0**               |

The only real Stage-1 costs are the **already-paid SuperHosting plan** (a sunk cost, not
*additional*) and **team time** — chiefly the **5–10 h/month** crawler-maintenance budget
(risk #4, D §3). Time is the binding Stage-1 cost, not money.

### 4.2 Stage 2 — trigger-gated bands (each dormant until its `08`/§3 trigger fires)

Nothing here is scheduled; each row activates only when its named trigger fires (`08 §3`).

|Extraction (08 ref)                             |Trigger (D §11)                                    |Cost band (03 §4)|Nature                                                                       |
|------------------------------------------------|---------------------------------------------------|-----------------|-----------------------------------------------------------------------------|
|VPS for crawlers (08 §3.1)                      |Crawlers destabilize WP                            |**~€5/mo**       |Recurring — only once triggered                                              |
|ScrapingBee / Apify (anti-bot, 08 §3.1-adjacent)|A crawler is **actually blocked** (Stage 1.5, D §5)|**~€5–20/mo**    |**Reactive, per-chain** — not preemptive                                     |
|Redis object cache (08 §3.2)                    |API p95 > 500 ms                                   |**free / low**   |Free tier or co-located on the VPS                                           |
|Read replica / early managed DB (08 §3.3)       |WP DB connections maxed                            |**low** band     |Precursor to the Stage-3 managed DB; firms up with the provider choice (open)|
|Firebase Cloud Messaging (08 §3.4)              |Push needed                                        |**free tier**    |Free tier                                                                    |
|Gemini (08 §3.5)                                |AI requested                                       |**free tier**    |Behind the AI provider abstraction                                           |

**Do not total these into a monthly number.** They are **independent and conditional**:
Stage-2 cost is the *sum of only the triggers that have fired*, and a project that hits no
trigger stays at €0. The most likely first paid line is the **VPS (~€5/mo)** *or* the
**reactive anti-bot (~€5–20/mo)** — both small bands, both contingent.

### 4.3 Stage 3 — managed DB + apps (provider TBD → estimate ranges, marked as such)

Every Stage-3 figure is an **estimate band pending the open managed-DB provider**
(PlanetScale / Supabase / RDS — 03 §5/§7, 08 §5). No exact monthly figure is committed.

|Item (08 §5)                 |Cost posture                                                                                                                                                                                                                  |
|-----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Managed DB                   |**Provider-dependent and genuinely unestablished** — ranges from free-tier / low (Supabase, PlanetScale entry tiers) to a higher recurring band (RDS production with HA). **Estimate band, not a quote.**                     |
|Standalone API hosting       |A VPS / container band — provider-dependent, low-to-moderate recurring. **Estimate only.**                                                                                                                                    |
|Apps (Capacitor vs RN — D §7)|Build-time effort + the app stores’ **standard developer-account fees** (small, fixed, periodic — figure not quoted here as it is external and changes). Capacitor-vs-RN itself is contingent on measured performance (08 §5).|
|HA / multi-region            |Cost proportional to redundancy — **estimate only**, deferred until the user base justifies it.                                                                                                                               |

The honest summary: **Stage-3 cost cannot be priced until the provider is chosen** (an open
decision — §7). What *is* fixed is that the move is additive (same Services, copied data —
08 §4/§5), so there is no rewrite cost hiding in the number.

-----

## 5. Backups & retention risk treatment

The treatment for risks #10 and #17, referencing `arch. §9`, `04 §6.3` and `05`.

- **What is backed up, and how.** SuperHosting’s own host-managed backups, **plus** a
  **weekly `mysqldump` of `<TABLE_PREFIX>_*`** to the home directory via cron (arch. §9),
  **plus periodic manual off-host download** (arch. §9).
- **Recovery posture.** RPO = “since the last successful dump / backup” (weekly for the
  app-table dump; the host backup cadence is SuperHosting’s). RTO = restore-and-replay-
  migrations time. At 0–100 users this is an **explicitly accepted** posture (risk #10) —
  not a gap to close now — revisited at the managed-DB move (08 §3.3/§5), which brings
  provider-managed point-in-time recovery.
- **A restore is reproducible, not fragile.** Because the schema is reproduced from numbered
  migrations and the data is loaded as a copy (04 §6.1, 08 §4), a restore is **migrations +
  data load**, not a brittle DDL-dump restore — which lowers restore risk materially.
- **Retention (the prune job, risk lens).** `<TABLE_PREFIX>_raw_offers` pruned at **8 weeks**
  (`bin/prune.php` — arch. §6.3, 04 §6.3, `05`); refresh tokens pruned past expiry; expired
  invitations cleaned; very old `crawl_runs` pruned (04 §6.3). The **durable** tables —
  `price_entries`, `purchase_log`, `user_products`, catalog and family — are **not** pruned;
  they are the record. The prune job’s purpose *here* is to bound shared-host disk
  (risk #17) without discarding the audit trail or the price history that matter.
- **Operational gap (flagged, not invented — see §7).** The **off-host download cadence** is
  only “periodic” in `arch. §9`; the exact interval is **not set**. It should be recorded as
  an operational policy; no interval is invented here.

-----

## 6. Deliberate-trade-off ledger (deferred complexity as a choice, not debt)

Each row is a *defended* choice with an explicit reversal condition. The presence of a
trigger is what makes it **deferred complexity, not debt** (D guiding-principle 7, 00 §6).

|Choice                                                 |Benefit now                                                                                                                          |Trigger that reverses it                                                                            |
|-------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
|**No Composer / no `vendor/`**                         |Small dependency surface, no supply-chain audit, `git pull` deploys; PHP stdlib covers Stage 1 (DOM/XPath, cURL/WP-HTTP, `hash_hmac`)|A genuinely non-trivial library becomes necessary — record it in `decisions.md` (03 §3.1, arch. §11)|
|**No Redis by default**                                |Indexed SQL is fast at 0–100 users; correctness beats micro-latency                                                                  |API p95 > 500 ms (08 §3.2, 03 §4)                                                                   |
|**No real-time sync in MVP**                           |Last-write-wins + “updated X sec ago” is enough for a small family list; avoids WebSocket / Mercure infra                            |Real-time sync becomes a Stage-2 requirement (D §9, 08, arch. §11)                                  |
|**Reactive anti-bot (no preemptive proxies)**          |Proxies cost money + complexity; most crawls will not need them                                                                      |A specific chain actually blocks us — Stage 1.5 (D §5, §4)                                          |
|**PWA-first (no native shell in MVP)**                 |One codebase, instant deploys, offline-first covers in-store use; Capacitor later wraps the *same* PWA                               |Native APIs (camera / push) or store presence needed — Stage 2 (D §7, 08 §3.4)                      |
|**`wp_users` reused (no separate identity store)**     |Battle-tested hashing + reset machinery for free, behind `AuthProvider`                                                              |The Stage-2/3 standalone auth export (arch. §3/§8, 08 §5)                                           |
|**WP transients, not Redis, for cross-user cache only**|Zero infrastructure; MySQL-backed                                                                                                    |Redis at the p95 trigger (arch. §9, 08 §3.2)                                                        |
|**Forward-only migrations (no `down()`)**              |Less surface for a two-person team; a mistake is fixed by a higher-numbered migration                                                |Revisit only if it bites (04 §6.1)                                                                  |
|**Custom tables, not WP post/meta**                    |Typed columns + composite indexes for the comparison hot path; clean extraction tables                                               |**Does not reverse** — a foundational choice that *enables* later moves (04 §2.1)                   |

The last row is deliberate: not every trade-off has a reversal. Some choices (custom
tables) are simply *right* and become the substrate the reversible ones rely on.

-----

## 7. Open risks & host-side unknowns (flagged, not invented)

Per the project rule, no values are invented for any of these — each is flagged for
confirmation or decision.

- **SuperHosting `memory_limit` / `max_execution_time` for PHP CLI (risk #6).** **Open
  host-side risk** (D §14). PHP CLI via cron *should* bypass web request limits (arch. §3),
  and CLI memory limits are typically far higher — but this is an **assumption to verify
  before the crawler build**, not a confirmed fact. If CLI limits turn out constrained, the
  chunked + resumable crawl design (arch. §6.3) is the mitigation and the VPS move
  (08 §3.1) is the escalation. **Verify, then record in `decisions.md §14`.**
- **Exact MySQL version (D §14).** Decides `JSON` vs `TEXT` for `crawl_runs.resume_state`
  and the `VARCHAR(190)` index-prefix habit (04 §2.2/§4.6). A host fact to confirm, not a
  design choice.
- **Off-host backup download cadence (§5).** `arch. §9` says only “periodic”; the interval
  is **unset**. A **newly-surfaced operational decision** — recommend recording a concrete
  cadence (see §8); no interval invented here.
- **Stage-3 managed-DB provider (03 §5/§7, 08 §5).** Genuinely open; it gates the Stage-3
  cost band (§4.3) and the cutover specifics (08 §4). Referenced as open, **not**
  pre-selected.

-----

## 8. Amendments to fold back into `decisions.md`

One **proposed** item (operational; raised for the owner to record — not asserted as
decided):

1. **Off-host backup download cadence — operational, newly surfaced.** `arch. §9` specifies
   “periodic manual off-host download” without an interval. This document (§5/§7) flags the
   interval as an **unset operational policy**; recommend recording a concrete cadence in
   `decisions.md §14` (at minimum: before and after any risky release). *Not a design
   change — an operational decision to record.*

The remaining open items (host-side `memory_limit` / `max_execution_time`, exact MySQL
version, Stage-3 managed-DB provider) are **already** tracked in `D §14` and are referenced
in §7, not re-added.

-----

## 9. Risk / cost → document map

|Need                                                                  |Lives in          |
|----------------------------------------------------------------------|------------------|
|Trigger definitions & extraction runbooks (the moves being costed)    |`08`              |
|Tool / version per stage; the **source** cost bands                   |`03 §4/§5`        |
|Schema, prune & retention mechanics                                   |`04 §6`           |
|Crawler internals; anti-bot specifics                                 |`05`              |
|Auth-flow detail — rate-limit thresholds, token rotation, CORS headers|`06`              |
|Security-posture rationale (the source of the hardening items)        |`01 §9` (+ §4/§8) |
|Risk **source** list (the seed this register extends)                 |`decisions.md §12`|
|Stage-3 storage moves (read replica, managed DB, PDO repos)           |`08 §3.3/§5`      |

-----

*Last updated: June 2026 · Session 5 of 6 (Opus 4.8, Extra effort, Thinking ON) ·
canonical for the **risk register, the per-stage cost model, the hardening checklist, and
the backup / retention treatment**. Costs are **bands, not quotes** (03 §4/§5); every
Stage-3 figure is an **estimate pending the open managed-DB provider** (03 §7). Carries the
**demand-first** risk reframe from `D §12` (categorization is product-to-category — Medium,
lenient; UserProduct sprawl — Low). Open host-side unknowns (D §14) are **flagged, not
invented**. `<TABLE_PREFIX>` retained throughout pending the final prefix.*