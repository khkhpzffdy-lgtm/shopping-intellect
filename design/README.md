# `design/` — Visual-language prototype (v2)

> **What this is:** the handoff bundle from [claude.ai/design](https://claude.ai/design),
> landed in-repo as the **canonical visual-language reference** for Shopping Intellect.
> It is a clickable HTML/React prototype, **not production code** — it establishes the
> look & feel (palette, type, spacing, component styles) so the real app can be built
> against it later. Code for the actual PWA does not exist yet (see `CLAUDE.md §6`).

## Run it

No build step. Open `design/index.html` in a browser (or serve the folder):

```sh
cd design && python3 -m http.server 8000   # then open http://localhost:8000
```

It loads React 18 + Babel-standalone from a CDN and renders a **board of four iPhone
frames**. Top-right toggles **Тъмна / Светла** (dark / light). Open **Tweaks**
(the host's edit-mode toggle) to live-adjust accent colour, font, corner radius, and
**text size** (a Dynamic-Type-style multiplier, 0.85×–1.35×).

## The four screens

1. **Списък · планиране** — shopping list, planning mode. emoji rows, favorite heart,
   opt-in brand-anchor chip (Верея), a "съпоставяне на цени…" (matching-in-progress)
   row. **No prices on resting rows.**
2. **Списък · пазаруване** — the same list toggled to in-store mode: large checkboxes,
   `added_by` avatars, offline banner, progress bar. Calm, large-target, no prices.
3. **Добави · търсене** — Add/Search: Любими + Често купувани quick-add, then an emoji
   category grid. A term outside the list becomes a new UserProduct.
4. **Продукт · оферти** — Product Detail: emoji hero, broad candidate offers across 4
   stores, promo markers, one anchored brand. **This is where prices live.**

## Visual language (reuse this)

- **Accent** — purple `#6D4AE6` by default (Tweakable). Used for *meaning only*:
  active mode, favorite, cheapest/anchored, progress. Promo is an independent warm-gold
  `#C98A12` so it never competes with the accent.
- **Stores** — deliberately monochrome mono labels (JetBrains Mono). Unbiased, no
  per-chain colour.
- **Type** — Onest (full Cyrillic grotesque) for everything; JetBrains Mono for store
  labels / `BROAD` tag / BGN secondary. Prices use tabular numerals. A single `--ts`
  multiplier scales all UI text (Dynamic Type).
- **Money** — EUR primary, quiet BGN secondary at the fixed 1.95583 rate (the 2026
  dual-display rule). "Not available" is never `0`.
- **Themes** — dark + light, driven by `[data-theme]` on `.si-root`; contrast-safe
  `--chip-text` / `--chip-bg` tokens keep accent-on-tint text legible in both.

## Files

| File | Role |
|------|------|
| `index.html` | Entry point (was `Shopping Intellect v2.html`). Mounts the board, defines tweak defaults. |
| `app.css` | The design tokens + every component style (dark/light, Dynamic Type). |
| `screens2.jsx` | The four screens (Bulgarian copy, EUR prices). |
| `ui.jsx` | Shared primitives: icons, `Money`, `BrandChip`, `TabBar`. |
| `ios-frame.jsx` | iOS device bezel / status bar (starter scaffold). |
| `tweaks-panel.jsx` | The live Tweaks panel + form controls (starter scaffold). |

## Canon adherence

The prototype stays strictly inside the rulebook in `10-ux-rules.md` and the MVP scope
in `00-overview.md`:

- **Product Detail** = broad candidates across all stores + opt-in brand anchor. No
  single-/pinned-store, no priority, no reminders — those concepts don't exist in the
  canon, and a pinned store would contradict broad-by-default cross-store comparison.
- **Bottom nav** = Списъци / Семейство / Профил only. No История tab: the purchase log
  surfaces **only** as recently / frequently bought in Add/Search (`10 §6.4`), never as a
  standalone history screen.
- Broad-by-default, opt-in anchor, owner metadata, offline-first, no prices at rest or in
  store, no conflict UI.

Theme switching lives in the board header here; in the real app it belongs in **Профил**
as a manual **Светла / Тъмна** toggle — **exactly these two themes, no "Системна" /
OS-driven option, ever.** Logged-out screens (e.g. auth) default to **dark**.
