# 00 — Overview

> Executive summary, product vision, and stage goals.
> Read this first. Detailed decisions live in `decisions.md`; deeper technical
> treatment lives in documents `01`–`09` and `CLAUDE.md`.

-----

## 1. What we are building

A grocery **price-comparison and shopping-list platform** for Bulgaria, starting in Sofia.

The product answers one question for a household: **“Where do I buy this week’s groceries for the least money?”** — and gives families a shared shopping list to do it together.

Everything else in the long-term vision (recipes, meal planning, AI assistant, multi-country) is real and intended, but it is **explicitly deferred**. The platform is designed so those features can be added later without rewriting the core.

-----

## 2. The problem

Bulgarian households shop across multiple chains (Lidl, Kaufland, Billa, Fantastico) and chase weekly promotions that rotate every Thursday. Today this means:

- Flipping through 4 separate paper/PDF brochures
- No way to know which store is cheapest for a *specific* basket
- Shopping lists scattered across notes apps, with no sharing between partners

There are existing promo aggregators in BG (Discounto, Namalenia, Pazaruvai). They show promotions but **do not combine promotions with a personal shopping list and a per-basket cheapest-store calculation**. That combination is our wedge.

-----

## 3. What makes this different

|Existing tools               |This platform                                    |
|-----------------------------|-------------------------------------------------|
|Browse promotions passively  |Promotions tied to *your* shopping list          |
|One store at a time          |Cheapest store for the whole basket              |
|Personal, single-device lists|Family-shared lists                              |
|Online-only                  |Offline-first PWA (works in-store without signal)|

### The demand-first catalog (how the matching problem is reshaped)

The hard part of any price comparison is connecting what a user wants to the right offers across stores. We tackle this with a **demand-first, three-layer catalog** — *crawl broadly, normalize narrowly*:

1. **UserProduct** — how a user names a thing (“мляко”, “прах Ariel”), born when it is first written into a list, owned by the list owner (user or family).
1. **Category bucket** — a neutral, normalized concept (“milk”), *not* a brand, that a UserProduct attaches to by default. Buckets fill **lazily** from real demand.
1. **StoreProduct / StoreOffer** — a concrete offer from one chain.

The user sees the **broad** category by default — *every* candidate offer across stores, promos marked — and may **opt in** to a specific brand only if brand matters to them. Matching itself is **by selection**: the user browses the candidates and choosing *is* the match, with no “is this the same product?” dialogs. Behind that, the system does only **lenient, automatic categorization** of each store offer into a bucket (product-to-**category**, not product-to-product identity).

This reframes what used to be the project’s single biggest technical risk. **Product matching still matters**, but demand-first turns the hard problem from product-to-product *identity* (“is *this* Lidl milk the *same* item as *that* Kaufland milk?”) into the much easier product-to-**category** (“does this offer belong in the *milk* bucket?”). A debatable categorization degrades gracefully — an odd extra candidate the user’s eye can ignore — rather than corrupting a trusted identity. So categorization quality is one important risk among several (alongside crawler maintenance and scope discipline), not the lone make-or-break.

-----

## 4. MVP definition (Stage 1)

**Goal:** validate that families will use a combined promotions + shared-list + price-comparison product.

**In scope:**

- User accounts (email/password + Google login)
- Family groups with shared shopping lists
- Demand-first product catalog (UserProduct → category bucket → store offer), built from real demand across 4 chains, Sofia pricing
- Owner-level product metadata: favorites + a light purchase log (recently / frequently bought)
- Weekly-crawled promotions and regular prices
- Price comparison: cheapest store for a basket, showing **all** in-category candidates per store with promos marked
- Promotions discovery (browse current offers)

**Deliberately out of scope** (deferred to later stages): recipes, meal planning, AI assistant, notifications, subscriptions/billing, PDF brochure OCR, receipt scanning (a future store-offer enrichment source), multi-country, native mobile app, real-time list sync, non-family link-sharing.

**Definition of success:** a small cohort (50–100 users) creates lists, shares them with family, and returns weekly to check promotions. If retention is there, we build Stage 2. If not, we learned cheaply.

-----

## 5. The three stages

### Stage 1 — Validate · 0–100 users

Everything runs on existing WordPress + SuperHosting hosting. PWA frontend on Cloudflare Pages (free). Crawlers run as PHP CLI scripts via CPanel cron. **Target additional infrastructure cost: €0.**

### Stage 2 — Early growth · 100–3,000 users

WordPress stays as the backend and admin. Bottlenecks are extracted **only when a specific trigger fires** (crawlers destabilizing WP → move to a small VPS; API latency → add Redis cache; push needed → Firebase). Native app shipped by wrapping the existing PWA with Capacitor. Recipes, meal planning, and the AI assistant are introduced here. The category buckets — seeded with only a handful in Stage 1 — **broaden and deepen organically** as more users and more crawl coverage exercise the catalog; this richer normalized layer is exactly the substrate those new features build on.

### Stage 3 — Scale · 3,000+ users

A standalone API service (reusing the same PHP service classes) takes over application logic. WordPress is demoted to CMS / marketing / SEO. Managed database, multi-country support, native apps. High availability.

The key property across all three stages: **migration is incremental and additive, not a rewrite.** Each stage reuses the artifacts of the previous one.

-----

## 6. Guiding principles

1. **Zero additional infrastructure cost in Stage 1.** Use what we already pay for. Introduce paid services only when a named bottleneck forces it.
1. **WordPress is the container, not the framework.** Business logic lives in plain PHP service classes that do not depend on WordPress APIs, so they can be lifted out later.
1. **The MVP is production-quality, not a throwaway.** Modular from day one. We never plan to rewrite — only to extract.
1. **Replaceable providers.** Auth providers, AI providers, and crawlers are all behind abstractions so they can be swapped without touching the rest of the system.
1. **The frontend is already decoupled.** PWA talks to the backend over a REST contract from day one. The same backend serves the future native app.
1. **Demand-first, broad by default.** Build the catalog from what users actually ask for; show every candidate and let the user’s eye be the final judge, rather than standing up an admin moderation queue.
1. **Defer complexity aggressively.** Scope is the enemy of a two-person team. `decisions.md` is the scope boundary; anything not listed there waits.

-----

## 7. Team & constraints

- **Team:** 2 people, side project.
- **Existing assets:** WordPress expertise, SuperHosting hosting (SSH, CPanel cron, MySQL — all confirmed adequate), an established custom-plugin pattern (PSR-4, no Composer) carried over from a prior project.
- **Hard constraint:** near-zero additional spend until the idea is validated.
- **Biggest non-technical risk:** scope creep. The original brief listed 14 modules; this overview commits to roughly 6 for the MVP.

The catalog is **not pre-enumerated**: rather than seeding ~200 hand-curated staple products up front, Stage 1 seeds only **~20–30 popular category buckets** (milk, bread, eggs, cheese, …) so day-one demand lands somewhere sensible, and every other bucket is created lazily, on demand. This keeps the two-person up-front data effort small and lets the catalog grow exactly where users pull it.

-----

## 8. How the document set is organized

|#             |Document           |Covers                                                  |
|--------------|-------------------|--------------------------------------------------------|
|`decisions.md`|Decisions log      |Single source of truth for every choice made            |
|`00`          |Overview           |This document                                           |
|`01`          |Architecture       |High-level system architecture, components, data flow   |
|`02`          |Domain model       |Bounded contexts, entities, relationships               |
|`03`          |Tech stack         |Technologies per stage, with introduction triggers      |
|`04`          |Database           |Schema strategy, custom tables, migration path          |
|`05`          |Crawlers           |The promotion-crawler subsystem (most complex piece)    |
|`06`          |API & Auth         |REST API design, JWT, Google login                      |
|`07`          |Frontend           |PWA, offline-first, Capacitor path to native            |
|`08`          |Scaling & migration|Stage 1→2→3 triggers and extraction plan                |
|`09`          |Risks & costs      |Risks, trade-offs, per-stage cost estimates             |
|`10`          |UX Rules           |Screen-state & component-level UX behaviour (pre-design)|
|`CLAUDE.md`   |AI context         |Persistent context file for Claude Code sessions        |

-----

## 9. One-paragraph summary

We are building a Sofia-first grocery price-comparison and family shopping-list app, starting on existing WordPress hosting at near-zero cost. The MVP combines weekly-crawled promotions from four chains with shared family lists and a cheapest-basket calculator, built on a demand-first three-layer catalog (the user’s own term → a normalized category bucket → concrete store offers) that is broad by default and matched by selection rather than by an admin queue. The architecture keeps business logic in plain PHP behind a REST API and a decoupled PWA frontend, so that as we grow we can extract crawlers, caching, and eventually the whole backend onto cheap infrastructure — incrementally, without ever rewriting. The biggest risks are categorization quality, crawler maintenance across four chains, and our own scope discipline; all are managed deliberately rather than hoped away.

-----

*Last updated: June 2026 · **demand-first re-sync**: reframed the matching risk from product-to-product identity to the easier product-to-category; replaced the “~200 pre-seeded staples” plan with ~20–30 lazily-filled category buckets; added the three-layer demand-first model to the product description. · **Doc set:** added `10-ux-rules.md` (screen-state & component-level UX; §§1–7 done, §§8–9 next session) to §8.*