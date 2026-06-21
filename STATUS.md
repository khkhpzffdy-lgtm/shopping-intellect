# STATUS — read this first, every session

> **Purpose:** stop re-deriving repo/env/deploy facts every session and stop AI
> instances from acting in the wrong directory or against the wrong remote.
> This file is **facts only** (repos, environments, what's built, what's tested).
> For *what to build next and how*, see `13-implementation-line.md` +
> `12-execution-model.md`. For *why* anything is the way it is, see `decisions.md`.
>
> **Update this file whenever a Slice closes, a deploy target changes, or you
> discover the actual state differs from what's written here.** Stale > absent —
> if something here is wrong, fix it in place rather than leaving it.
>
> **This file can be wrong.** Before telling the Owner "X isn't built yet" or
> generating a Slice that builds something, glance at the actual code
> (`app/src/components/`, `plugin/src/`) — a few seconds of `ls`/`find` beats
> re-building something that already exists or telling the Owner a feature they
> use daily doesn't exist. Fix this file in place when you find a mismatch.

---

## 1. Repos — there are TWO, they do not share history

| | Path (local) | GitHub remote | Contains |
|---|---|---|---|
| **Root/docs+app repo** | `/Users/aleks/Documents/Shopping Intellect/` | `khkhpzffdy-lgtm/shopping-intellect` | `00`–`13` docs, `decisions.md`, `CLAUDE.md`, `design/`, `app/` (React PWA) |
| **Plugin repo** | `/Users/aleks/Documents/Shopping Intellect/plugin/` | `khkhpzffdy-lgtm/shopping-intellect-plugin` | the WP plugin (`shopping-intellect/`), PHPUnit tests |

**`plugin/` is a separate git repo nested inside the root repo's working tree.**
The root repo's `.gitignore` excludes `plugin/` entirely — commits inside `plugin/`
are invisible to the root repo and vice versa. **Always check `git remote -v` /
`pwd` before committing** — `cd plugin` first if you're touching plugin code.
There is no submodule wiring; it's just two independent checkouts sharing a folder.

Both repos are on branch `main` only, except plugin also has `staging` (see below).

**2026-06-14: merged plugin `staging` → `main` and pushed** (commit `65d79c2`,
"Implement list REST endpoints"). This had been sitting on `staging` only —
production (`shopping.flux.bg`) was missing `/lists` endpoints and the
`AddListClientUuidMigration`, which is why "Create list" failed in the app with
"Could not create the list on this device yet." After this deploy, verify the
migration ran via the plugin's admin schema-status page before relying on
list creation in production. **Going forward: when a Slice's backend half
lands, push it to `main` (not just `staging`) once verified, or explicitly flag
in this file that prod is behind staging — don't let them silently diverge.**

**IMPORTANT — FTP deploy does NOT run migrations.** `Migrator::run()` only
fires from `Plugin::activate()`, which only fires on plugin
activation — not on file deploy. After any deploy that adds a migration
(check `MigrationRegistry::defaultMigrations()` for new entries vs. what's
already applied), the Owner must go to **wp-admin → Plugins → Deactivate →
Activate** on Shopping Intellect to run pending migrations, then confirm via
**Tools → SI Schema Status** that `schema_version` matches the latest
migration id. Also note: `Plugin.php`'s REST bootstrap wraps controller/service
construction in a try/catch that silently skips registering the *entire*
`si/v1` namespace (including `/auth/refresh`) on any `\Throwable` — so a
missing-column DB error during `/lists` POST can make `/auth/refresh` 404 too,
which the frontend's `apiRequest` then treats as session-invalid and logs the
user out. This silent catch is a standing risk worth tightening (e.g. log to
a visible admin notice) in a future slice.

---

## 2. Where code runs — no local dev environment exists

**There is no local WordPress install (no Local/Docker/MAMP).** All plugin testing
happens either via PHPUnit (no WP, see below) or on the **staging server** after a
push to the plugin repo's `staging` branch. Do not propose "run it locally in WP"
— set up `staging` branch testing or PHPUnit instead.

### Plugin repo (`shopping-intellect-plugin`)
- **CI (`.github/workflows/deploy.yml`):** runs `phpunit.phar` on every push to
  `main` or `staging`.
- **`main` → production**, via FTP to a live WP install (secrets:
  `PROD_FTP_HOST/PROD_FTP_USER/PROD_FTP_PASSWORD/PROD_FTP_PATH`, `PROD_FTP_PATH`
  pointing at the plugin's directory under `wp-content/plugins/` on
  `shopping.flux.bg`). Excludes `tests/`, `.github/`, `phpunit.*`. The previous
  SSH/rsync setup was replaced (2026-06-13) — `SSH_HOST` was unresolvable from
  GitHub Actions runners and the secrets were never validated as live. The
  `SSH_*` secrets are now unused and can be removed from the repo.
- **`staging` → staging server**, via FTP (secrets: `STAGING_FTP_HOST/USER/PASSWORD/PATH`).
- **PHPUnit tests** (`plugin/tests/`) run **without WordPress** — `wp-stubs.php`
  fakes the WP functions. This is the fast, no-deploy way to verify plugin logic.
  Run locally: `cd plugin && php phpunit.phar` (or `vendor` equivalent if added).

### App repo (`shopping-intellect`, `app/` dir — React PWA)
- **CI (`.github/workflows/deploy.yml`):** on push to `main` touching `app/**`,
  builds (`npm run build`, `VITE_API_BASE_URL=https://shopping.flux.bg/wp-json/si/v1`)
  and FTP-deploys `app/dist/` to production (secrets: `FTP_HOST/USERNAME/PASSWORD/SERVER_DIR`).
  No staging deploy configured for the app yet.
- Local dev: `cd app && npm run dev` (Vite). `app/.env.local` exists locally
  (gitignored) — check it for the API base URL when running against staging/prod.

### Production site
- Live WP site: `shopping.flux.bg` — plugin runs there (via the `main`→prod rsync
  deploy) and the app's API base URL points at `https://shopping.flux.bg/wp-json/si/v1`.

---

## 3. Build status — what's actually done

Source of truth for ordering/specs is `13-implementation-line.md`; this table is
just the **checklist of closed Slices** so nobody re-derives it from git log.

| Slice | What | Status |
|---|---|---|
| §0.1 | Plugin skeleton + PSR-4 autoloader | ✅ done |
| §0.2 | Config/Clock/Logger scaffolding + table prefix resolution | ✅ done |
| §0.3 | `Money` value object | ✅ done |
| §0.4 | Full schema migrations + Admin schema-status page | ✅ done |
| §1.1 | Repository contracts + first Wpdb implementations | ✅ done (bundled with §1.2/§1.4 commits) |
| §1.2 | `AuthProvider`/`UserRepository` over `wp_users` + `si_user` role | ✅ done |
| §1.3 | JWT issuer/verifier (HS256, custom `hash_hmac`) | ✅ done |
| §1.4 | Auth REST endpoints (register/login/refresh/logout, email/password) | ✅ done |
| §1.4b | Google OAuth login (`POST /auth/google`) | ✅ done |
| §1.5 | App shell + auth screen + silent-refresh boot (email/password + Google) | ✅ done — M1 closed |
| §2.1 | UserProduct create-on-write + owner-scoped term normalization | ✅ done |
| §2.2a | Lists & `list_items` REST endpoints (backend half of §2.2) | ✅ done |
| §2.2b | Two-mode list screen frontend | ✅ done |
| §2.2 | Lists end-to-end (backend + frontend) | ✅ done |
| §2.2c | Visual redesign of Lists overview + List screen to match `design/screens2.jsx` | ✅ done |
| §2.3 | Offline mutation flush/retry engine (durable reconnect sync, drains `mutation_queue`) | ✅ done |
| §2.3a | Wpdb null-safe value binder (shared `WpdbNullSafe::bind()`) | ✅ done |
| §2.3b | Unify the frontend mutation pipeline (one `sendMutation`, no per-screen copies) | ✅ done |
| §3.1 | `HttpClient` interface + `WpHttpClient` + `AbstractCrawler` + `LidlCrawler` stub + `RawOffer` DTO + `bin/crawl.php` | ✅ done |
| §4.0 | Navigation shell + Add/Search screen (`BottomNav`, `AddSearchScreen`, `App.tsx` tab state, `HomeScreen`/`ListScreen` wired) | ✅ done |
| §2.3c | `SyncStatusIndicator` icon-only redesign + offline banner (supersedes §2.2d item 1) | ✅ done |
| §2.2d | UI consistency cleanup: `EmptyState` wired + translated, one-language copy pass, list-screen search icon → Add/Search | ✅ done |
| §2.3d | Pull lists/items from server on boot — fixes "different browsers, same account, different lists" | ✅ done |
| §4.0b | Catalog tab + move Add/Search off the bottom nav | ✅ done |
| §2.6 | Delete a list (hard delete, items/terms survive) | ✅ done |
| §2.7 | Rename a list (inline app-bar edit, `PATCH /lists/{id}`) | ✅ done |
| §4.0c | Manual StoreProduct creation (specific item path, `list_items.store_product_id`) | ✅ done |
| §4.0c-fix | "Добави конкретен артикул" button no longer hidden on term match | ✅ done |
| §4.0e | Unlimited-depth categories, many-to-many product↔category, seeded ~300 default products | ✅ done — **migration not yet run on prod, see note below** |
| §4.0f | StoreProduct dedupe across users + async Gemini metadata extraction | ✅ done — **migration not yet run on prod, see note below** |
| §2.8a | UserProduct detail screen (rename + favorite + qty/unit edits), replaces the "Expand details soon" placeholder for UserProduct-backed list rows | ✅ done — **§2.8b (StoreProduct detail) still open, see note below** |

**App (`app/`):** Vite + React PWA, FTP deploy wired. Implemented so far:
- `AuthScreen` — register/login screen, working against the plugin's auth endpoints
- `HomeScreen` — basic post-login screen
- `store/auth.ts`, `api/client.ts`, `api/session.ts` — auth state + API client
- **Theme infrastructure (done):** `src/theme.css` (design tokens for
  `[data-theme="dark"|"light"]` ported from `design/app.css`), `store/theme.ts`
  (zustand, persists `'light'|'dark'` to `localStorage` under `si-theme`, defaults
  to `'dark'`), wired onto a `.si-root` wrapper in `App.tsx` via `data-theme`.
  Onest + JetBrains Mono loaded via Google Fonts in `index.html`. No "system theme"
  option (intentionally, per product rule).
- **Restyle to design/ tokens (done):** `AuthScreen`, `HomeScreen`, and
  `EmptyState` now use `theme.css` variables (`--bg`, `--card`, `--ink`, `--accent`,
  `--radius`, `--fs-*`) instead of ad-hoc Tailwind colors. `HomeScreen` has a
  Светла/Тъмна theme toggle wired to `store/theme.ts`'s `setTheme`. A dedicated
  Профил screen is still a future slice.
- **§2.2c visual redesign (done):** `ListsScreen` and `ListScreen` now follow
  `design/screens2.jsx`'s `ListScreen` layout — app bar, "+"-reveal add bar,
  segmented mode control (`planning`/`shopping`, capitalized via CSS to keep test
  selectors stable), emoji-row items in planning mode, large-checkbox rows in
  shopping mode. Classes ported from `design/app.css` into
  `app/src/list-screens.css` (imported in `main.tsx`), scoped under `.si-root` to
  avoid collisions with existing Tailwind/theme classes. FAB and bottom tab bar
  omitted (no backing screens yet, per slice scope). All §2.2b data wiring,
  IndexedDB/mutation-queue logic, and props/handlers are unchanged.
- **§4.0 navigation shell + Add/Search screen (done):** `BottomNav` (fixed bottom tab bar, Списъци / Добавяне tabs) and `AddSearchScreen` (search over owner's own terms from IndexedDB + server seed, "добави нов термин" affordance on no-match, optimistic add with mutation-queue offline support, QuickAddSection ×3 in empty-state). `App.tsx` holds `activeTab` state and renders both screens (`display: none` toggle) + `BottomNav` when logged in. `HomeScreen` passes `onOpenAddSearch(list)` down; `ListScreen` accepts `onOpenAddSearch` prop (wired, `+` still triggers inline add for backwards compat — tab bar is the primary entry point for AddSearch). CSS in `list-screens.css`. `getAllUserProducts()` helper added to `db.ts`. Vitest tests for `BottomNav` (render + tab switch) and `AddSearchScreen` (match, no-match, select term, add-new, offline) written. Build passes (`npm run build`). Pushed to main.

- **§2.3 offline mutation flush/retry engine (done):** `app/src/sync/flush.ts`
  (`flushQueuedMutations`) drains `mutation_queue` rows with status `pending`/
  `failed`, sorted by `created_at`, one at a time. Each mutation is atomically
  claimed via `markMutationInFlight` (returns `null` if already claimed, so a
  concurrent drain can't double-send), replayed via `apiRequest`, and on success
  mapped back onto local records by the shared `app/src/sync/
  applyMutationSuccess.ts` helper (now reused by both the inline optimistic
  fast-path in `HomeScreen.tsx` and the drain engine — no duplicated
  response-mapping). On failure, `markMutationFailed` increments `attempts` and
  leaves it for the next drain. `HomeScreen` runs a drain on mount (boot) and on
  the browser's `online` event, then refreshes lists/items/pending counts so
  `SyncStatusIndicator` updates without a reload. `db.ts` gained
  `getQueuedMutations`, `markMutationInFlight`, `markMutationFailed`,
  `getUserProduct`, `getListItem`, `getMutation`, `touchListUpdatedAt` (no
  `DB_VERSION` bump — no schema/keyPath change). `touchListUpdatedAt` also fixes
  a stale-closure race where `handleAddItem`'s `putList({...selectedList, ...})`
  could clobber a list's server `id` if the drain had just written it
  concurrently. Tests in `app/src/test/flush.test.ts`. Pushed to `main`
  (`be211c9`), CI build+deploy green.

- **§2.3b unify the mutation pipeline (done):** `app/src/sync/sendMutation.ts` is now
  the single function that dispatches every optimistic write — `resolveEndpoint`
  (moved from `flush.ts`, still exported from `sendMutation.ts`), `apiRequest`,
  `applyMutationSuccess`, and `markMutationDone`/`markMutationFailed` all live inside
  it exactly once. `flush.ts`'s `drainQueuedMutations` and all five previous
  hand-rolled call sites (`HomeScreen.tsx`'s `handleCreateList`, `handleAddItem`,
  `handleToggleChecked`, `handleRemoveItem`, and `AddSearchScreen.tsx`'s
  `addItemToList`) now call `markMutationInFlight` then `sendMutation` instead of
  duplicating the enqueue/send/apply/mark-done sequence inline. `handleAddItem`'s
  dead-end early return for an unsynced parent list (`if (!selectedList.id) return`)
  is removed — `resolveEndpoint` already resolves the real list id when available,
  so adding an item to a list created earlier in the same offline session now
  actually attempts to sync instead of silently sitting pending with no error.
  New tests: `app/src/test/sendMutation.test.ts` (asserts `flushQueuedMutations`
  routes every queued mutation through `sendMutation` exactly once — a regression
  guard against a sixth hand-rolled copy reappearing) and a new case in
  `App.test.tsx` proving the unsynced-parent-list add now reaches the network.
  Pushed to `main`.

- **§2.3c sync indicator + offline banner (done):** `app/src/store/connectivity.ts`
  (Zustand `useConnectivityStore`, `{ isOnline }`) seeded from `navigator.onLine` and
  kept current by `window`'s `online`/`offline` events plus `fetchAuth()` in
  `app/src/api/session.ts` — a `TypeError` from `fetch()` itself (network/DNS failure)
  flips it to `false`; any response that completes (even 4xx/5xx) flips it back to
  `true`, since reaching the server at all proves connectivity. `app/src/components/
  OfflineBanner.tsx` renders the exact `design/screens2.jsx` copy ("Офлайн ·
  отметките се запазват и ще се синхронизират") with the ported `wifiOff` icon
  (now in `app/src/components/icons.tsx` alongside two new icons, `SyncPendingIcon`/
  `SyncFailedIcon`, matching `design/ui.jsx`'s stroke style); rendered once, fixed at
  the top, from `App.tsx`. `db.ts`'s `getPendingMutationCounts` is replaced by
  `getMutationStatusCounts(): Record<string, {pending, failed}>`, splitting
  `pending`/`in_flight` from `failed` per entity. `HomeScreen.tsx`'s
  `refreshPendingCounts`/`pendingCounts` are renamed `refreshMutationStatusCounts`/
  `mutationStatusCounts` accordingly. The two inline `SyncStatusIndicator` copies in
  `ListScreen.tsx` and `ListsScreen.tsx` (the `§2.2d` item-1 dupe) are deleted and
  replaced by one shared `app/src/components/SyncStatusIndicator.tsx`: renders
  nothing when both counts are zero (the common synced/online case — no badge, no
  text), the warning-triangle icon when `failed > 0` (always shown, even online, per
  `10-ux-rules.md` §7 — a real rejection is never hidden), else the refresh-arrows
  icon when `pending > 0`. Both icon states carry an `aria-label`/`title` for
  accessibility despite being visually icon-only. New tests:
  `app/src/test/connectivity.test.ts`, `offlineBanner.test.tsx`,
  `syncStatusIndicator.test.tsx`, `db.test.ts` (`getMutationStatusCounts`
  independent-per-entity counts). No existing test asserted on the old
  `'sync-pending N'`/`'synced'` text, so nothing needed updating there. Build
  (`npm run build`) passes. **Supersedes `§2.2d` SCOPE item 1** (dedupe
  `SyncStatusIndicator`) — skip it when `§2.2d` runs. Pushed to `main`.
  **Note:** this session's sandbox shows `App.test.tsx`/`flush.test.ts`/
  `sendMutation.test.ts`/`addSearch.test.tsx` failing on 10s hook timeouts and a
  `btoa` "Invalid character" error — confirmed via `git stash` to be **pre-existing
  or environment-specific**, not caused by this slice (identical failures on a clean
  checkout before any `§2.3c` change). Worth a look in a normal dev environment
  before assuming they're still broken there.

This list is **not guaranteed complete or current** — if it looks stale, check
`app/src/components/` and `app/src/App.tsx` directly rather than trusting this.

**§1.4b (Google OAuth login) notes:** `POST /auth/google` is wired
(`AuthController::handleGoogle`, `AuthService::loginWithGoogle`,
`GoogleAuthVerifier` in `Repositories/Wp/`). Two WP options must be set
before real Google logins work: `si_google_client_id` and
`si_google_client_secret` (read via `Config::googleClientId()` /
`googleClientSecret()` from `get_option()`). Until those are set to real Google
OAuth credentials, the token exchange will fail and the endpoint returns
`401 google_verification_failed` (expected/safe default).

**wp-admin settings page (done):** `GoogleSettingsPage`
(`src/Admin/GoogleSettingsPage.php`) adds **Settings → SI Google Sign-In** in
wp-admin, with a form (Client ID + Client Secret) that writes
`si_google_client_id` / `si_google_client_secret` via `register_setting` /
`options.php` — no DB access needed, the Owner sets these directly in
wp-admin.

**§1.5 (frontend Google button) — done, Owner-confirmed working on
shopping.flux.bg (2026-06-13):** `AuthScreen` shows a "Вход с Google" button
below the email/password form when `VITE_GOOGLE_CLIENT_ID` is set
(`app/src/api/session.ts` `googleAuthUrl()`); it redirects to Google's OAuth
consent screen. `googleRedirectUri()` returns a **fixed** URI
(`https://shopping.flux.bg/`), not derived from `window.location` — the
dynamic version broke with `redirect_uri_mismatch` when the app was reached
via `www.` or `http://` variants of the domain, since Google requires an
exact registered match. On return, `App.tsx` boot picks up `?code=...`, strips
it from the URL, and calls `POST /auth/google` (`api/client.ts`
`loginWithGoogle`), landing on the same session flow as email/password.

Fully configured and live:
- GitHub repo secret `VITE_GOOGLE_CLIENT_ID` is set (root repo).
- wp-admin **Settings → SI Google Sign-In** (`GoogleSettingsPage`) has real
  `si_google_client_id` / `si_google_client_secret` values set.
- Google Cloud Console OAuth client has `https://shopping.flux.bg/` in
  "Authorized redirect URIs".

**M1 is closed** — register/login/reload/logout works for both email/password
and Google on shopping.flux.bg.

**§2.1 (done):** standalone `UserProduct` create-on-write is wired in the plugin:
`Support/TermNormalizer`, `Services/UserProductService`, and
`GET/POST /wp-json/si/v1/user-products` are implemented and PHPUnit-covered.
The service dedupes on `(owner_type, owner_id, normalized_term)`, un-archives
soft-deleted matches, and generates `client_uuid` values with the shared UUIDv4
helper used by auth refresh lineage IDs.

**§2.3 (done):** offline mutation flush/retry engine — see "Implemented so far"
above. Pushed to `main` (`be211c9`), CI build+deploy green. Owner verification on
shopping.flux.bg of §2.3's reconnect-drain acceptance criteria (and the still-
pending §2.2c criteria) is outstanding.

**§2.2d is done (2026-06-17).** Items 2-4 shipped (item 1 was already covered by §2.3c):
`EmptyState` now takes an `onCreate` prop wired to `ListsScreen`'s create flow (the
"Create list" CTA was previously a dead button); `ListsScreen` renders the shared
`EmptyState` instead of an inline duplicate; the listed English strings in
`ListScreen.tsx`/`EmptyState.tsx`/`HomeScreen.tsx` are now Bulgarian (item placeholders,
"Remove" → "Премахни", empty-state copy, the two `formatActionError` fallbacks);
`ListScreen.tsx`'s appbar gained a 🔍 `iconbtn` wired to the existing (previously dead)
`onOpenAddSearch` prop, matching `design/screens2.jsx`'s search icon and the bottom nav's
"Добавяне" destination. `aria-label`s and Vitest selectors were left untouched except
where a test asserted on now-translated *visible* text (`App.test.tsx`'s `'No lists yet'`
→ `'Все още нямаш списъци'`, `'Create list'`/`'Remove'` button names, the `piece` unit
value, and the two `formatActionError` negative-text assertions) — same approach as
§2.2c/§2.3c. Verified with a headless-Chromium script driving the real built app against
mocked `/auth`/`/lists` routes (no project run-skill existed for this app, so a one-off
Playwright script was used): EmptyState CTA now reveals the create-list input, the list
screen shows the 🔍 icon and clicking it opens Add/Search, and copy renders in Bulgarian
throughout. `npx tsc --noEmit` and `npm run build` both pass. The four already-flaky test
files (`App.test.tsx`, `flush.test.ts`, `sendMutation.test.ts`, `addSearch.test.tsx`) noted
in the §2.3c entry above are still flaky in this sandbox for the same pre-existing,
environment-specific reasons (confirmed again via `git stash` on this session) — all other
test files (`bottomNav`, `offlineBanner`, `syncStatusIndicator`, `theme`, `db`,
`connectivity`) pass clean. Pushed to `main` (`4f5ad83`), CI build+deploy green.

**Bug found while verifying §2.2d on shopping.flux.bg (2026-06-17): different browsers,
same account, show different lists.** The Owner tested in a normal Safari tab and an
incognito window logged into the **same account** and saw different lists in each. Root
cause: `app/src/storage/db.ts`'s `getLists()`/`getListItems()` read **only** from local
IndexedDB, which is populated exclusively by this device's own local writes. **Nothing in
the frontend ever calls `GET /lists` or `GET /lists/{id}`** to pull server-side state —
even though both endpoints are fully implemented and working
(`plugin/src/Api/ListController.php` `handleList`/`handleGet`, registered and
permission-checked). `07-frontend.md` §3.1 already specifies the intended behaviour
("data hydrates from IndexedDB first, then **reconciles with the network**") but that
network-reconciliation half was never built — §2.2b/§2.2c/§4.0/§2.3* all built and
hardened the **write** side (the mutation queue) but the **read** side has no
boot-time/list-open pull. Confirmed by reading `ListController.php` directly: its
`listData()`/`itemData()` response builders don't even return `client_uuid` per row yet
(needed for the merge), which is itself a small backend gap. New slice written:
**`slices/13-2.3d-server-pull-on-boot.md`** — adds `GET /lists`/`GET /lists/{id}` calls,
a local IndexedDB merge with last-write-wins + a pending-mutation guard (so an unsynced
local edit is never clobbered by a stale server read), wired into `HomeScreen.tsx`'s
existing boot/list-open `useEffect`s, silently no-op on offline boot.

**§2.3d is done (2026-06-17).** `app/src/api/client.ts` gained `fetchLists()`/
`fetchListWithItems(id)`; `app/src/storage/db.ts` gained `mergeServerList()`/
`mergeServerListItem()` (skip the merge entirely if a pending/in_flight/failed mutation
is queued against that entity — an unsynced local edit always wins over a stale server
read; otherwise last-write-wins on `updated_at` per `07 §4.3`); `HomeScreen.tsx`'s boot
`useEffect` now fetches `GET /lists` after the existing local-first `refreshLists()` and
merges the result in, and the list-open `useEffect` does the same with
`GET /lists/{id}` once the open list has a server `id`. Both fetches fail silently
(matching the existing mutation-flush `try/finally` pattern in the same file) so offline
boot is unaffected. **Paired plugin-repo fix:** `plugin/src/Api/ListController.php`'s
`listData()`/`itemData()` now return `client_uuid` (the column was already stored, just
never returned) — pushed to the plugin repo (`9ce5f5d`) ahead of the frontend change.
Four new Vitest regression tests added to `App.test.tsx` (server-only list appears on
boot; a pending-mutation list is not overwritten by a stale server read; offline boot
with a rejecting `GET /lists` still renders local data with no error; opening a list
pulls its items from `GET /lists/{id}`) — all four pass in isolation. Verified
end-to-end with a two-Playwright-browser-context script simulating the exact reported
bug (list + item created in one context, fresh context logged into the same account):
both now appear after the fresh context's boot/list-open, confirming the fix.
`npx tsc --noEmit`, `npm run build`, and the full PHPUnit suite (88 tests) all pass.
The same pre-existing sandbox flakiness on `App.test.tsx`'s full-file run (hook
timeouts, noted in the §2.3c and §2.2d entries above) persists — unrelated to this
slice's changes; the unaffected test files (`bottomNav`, `offlineBanner`,
`syncStatusIndicator`, `theme`, `db`, `connectivity`) all pass clean.

**§4.0b is done (2026-06-18).** Bottom nav holds only browse destinations now: `BottomNav`'s
`'add'` tab is replaced with `'catalog'` (label "Каталог", 📦 icon); `Tab`/`ActiveTab` types
are `'lists' | 'catalog'`. **Backend (plugin repo, pushed to `main`, `a946388`):** new
`Models/Category.php` (id/slug/name only — `is_seeded`/`replaced_by_category_id` stay
internal, never hydrated), `Repositories/Contracts/CategoryRepositoryInterface.php`,
`Repositories/Wpdb/WpdbCategoryRepository.php` (`listAll()`, `SELECT id, slug, name FROM
{prefix}categories ORDER BY name ASC`), and `Api/CategoryController.php` registering a
**public** `GET /categories` (`permission_callback: '__return_true'`, matching
`AuthController`'s public-route pattern) — wired into `RestApiBootstrap` (now takes a 4th
`CategoryController` constructor param) and `Plugin.php`'s services try-block. New
`CategoryControllerTest.php` (seeded-rows shape assertion, empty-table case); `SqliteWpdb`
test stub gained a `categories` table (it didn't have one before). All 90 PHPUnit tests
pass. **Frontend (app repo, pushed to `main`, `9428f9a`):** new `CatalogScreen.tsx` —
on-mount (gated by an `isActive` prop, mirroring `AddSearchScreen`) calls the now-public
`apiRequest<{categories}>('/categories')` (no `authenticated: true`), shows `SkeletonLoader`
while loading, a plain Bulgarian message on error/empty, otherwise a flat name list — no
prices, no offers, nothing tappable. `App.tsx`'s top-level tab switch now renders
`CatalogScreen` instead of `AddSearchScreen`, and no longer threads `onOpenAddSearch`/
`onItemAdded`/`selectedListRecord` — that state moved into `HomeScreen.tsx`, which now
holds `addSearchOpen` and renders `AddSearchScreen` as a `position: fixed` full-screen
overlay (with its own `.appbar`/`.iconbtn` back button) above the open `ListScreen` when
true. `ListScreen.tsx`'s existing 🔍 button (already wired to `onOpenAddSearch`) needed no
changes — it now opens the overlay instead of switching the app-level tab. Closing the
overlay (back tap or `onItemAdded`) clears `addSearchOpen`; the list underneath is
untouched, so the Owner lands back on the same list, not the Lists overview.
`bottomNav.test.tsx` updated (Каталог assertions); new `catalogScreen.test.tsx` (renders
categories, empty state, error/offline state, doesn't fetch while inactive — all pass); new
`App.test.tsx` case asserting the 🔍 → overlay → close round-trip (passes in isolation; see
below). `npx tsc --noEmit` and `npm run build` both pass. Running the **full** Vitest suite
in one process reproduces the same pre-existing, environment-specific failures already
flagged in the §2.3c/§2.2d/§2.3d entries above (`App.test.tsx` hook timeouts,
`addSearch.test.tsx`'s `btoa` "Invalid character") — confirmed identical when running just
those two files together; the new test passes cleanly when run alone or alongside the other
seven unaffected files (`bottomNav`, `catalogScreen`, `offlineBanner`,
`syncStatusIndicator`, `theme`, `db`, `connectivity`, all 7 files green). **Owner
verification on shopping.flux.bg of this slice's acceptance criteria is outstanding** —
after the next FTP deploy, confirm: bottom nav shows exactly "Списъци"/"Каталог" (no
"Добавяне"); Каталог lists category names with nothing tappable; the List screen's 🔍 opens
Add/Search as an overlay and closing it returns to the same list; adding an item through
that overlay still works (offline-safe, optimistic, syncs). No migration is needed for this
slice (the `categories` table and its seed already existed from `§0.4`), so no
deactivate/reactivate step is required — `GET /categories` should work immediately once the
plugin's `main` branch FTP-deploys.

**Build order (2026-06-19, revised — added §4.0c-fix):** §3.1 (done) → §4.0 (done) → §2.3a (done) → §2.3b (done) → §2.3c (done)
→ §2.2d (done) → §2.3d (done) → §4.0b (done) → §2.6 (done) → §2.7 (done) → §4.0c (done) →
§4.0c-fix (done) → §4.0e (done) → §4.0f (done) → §2.8a (done) →
**§2.8b (next) → §4.0d → §2.9** →
§3.2 → §3.3 → §4.1 → §4.2 → §4.3 → §2.4 (Family) → §2.5 (Favorites) → M5.
**2026-06-18/19 re-sequencing:** the Owner asked for list management (delete/rename), item/
product detail management, Catalog product management, and a Profile screen to be fully
solid **before** any store-offer matching work starts — so §2.6/§2.7/§4.0c/§4.0e/§4.0f/
§2.8/§4.0d/§2.9 (new Slices, see `13-implementation-line.md`) are inserted ahead of §3.2.
§4.0c is also a real schema/iron-rule amendment: `list_items` can now reference a
`StoreProduct` directly (a specific item, e.g. "Мляко Данон 2% 1л"), not just a
`UserProduct` (a broad term, "мляко") — see `decisions.md` "Resolved — list_items can
target a specific StoreProduct directly" (2026-06-18) for the full rationale and schema
delta (`list_items.store_product_id`, `store_products.source`/`created_by_user_id`/
`image_url`). **§4.0e (added 2026-06-19) is a second, larger schema amendment**:
`categories.parent_id` for unlimited-depth nesting, a `product_categories` junction table
replacing the single `category_id` FK on `user_products`/`store_products` (including the
one §4.0c just added on `store_products` — retired one migration later, before any
shipped UI relied on it), a third `user_products.owner_type` value `'system'` +
`is_global_default` flag, and a one-time seed of ~300 generic products from
`shopping_intellect_mvp_starter_catalog_v1 2.md`. See `decisions.md` "Resolved —
unlimited-depth categories, many-to-many product↔category, and seeded default products"
(2026-06-19) for the full rationale. **§4.0f (added 2026-06-19) fixes a real bug found
in §4.0c**: two different users typing the same specific item each got their own
`store_products` row, with no cross-user dedupe — defeating StoreProduct's purpose as a
shared identity. Adds exact-`normalized_name` dedupe across all users (not fuzzy-match-
with-confirmation, which would reopen the "no yes/no matching dialogs" rule, D §4) plus
an async Gemini API call (the project's first LLM integration; usage-based cost, a
deliberate exception to D §5's "€0 additional infra in Stage 1") that extracts
brand/size/variant/category metadata from the free-text name *after* the item is already
usable — never blocking the optimistic add. See `decisions.md` "Resolved — StoreProduct
dedupe across users + async Gemini metadata extraction" (2026-06-19) for the full
rationale. **§4.0d (added 2026-06-18, now also depends on §4.0e) amends the 2026-06-17
"Catalog has no connection to list-adding" rule** — Catalog becomes the owner's own
product/item manager, grouped by bucket (now via the junction table, with child-bucket
drill-down), not just a read-only taxonomy browse; see `decisions.md` "Resolved —
Catalog becomes 'browse my products'" for the full rationale and the
`store_products.is_archived` column it needs. §3.2/§3.3 (ingestion + cron) still follow
immediately after, so real offers are in the DB before §4.1 ships. §2.3a/
§2.3b/§2.3c jumped the queue ahead of §2.2d on 2026-06-17 — see incident note immediately
below. See `13-implementation-line.md` "Re-sequencing" for full reasoning.

**§2.6 is done (2026-06-18).** Delete a list (hard delete, items/terms survive). **Backend
(plugin repo):** `ListRepositoryInterface` gained `delete(int $id): bool`;
`WpdbListRepository::delete()` runs a prepared `DELETE FROM {prefix}lists WHERE id = %d`,
returns whether a row was affected — it does not touch `list_items`/`user_products` itself,
relying on the existing `list_items.list_id` `ON DELETE CASCADE` FK (`04-database.md` §4.3,
already in the schema) and the `RESTRICT` FK on `user_product_id`/`store_product_id` to keep
those rows untouched. `ListService::deleteList(int $userId, int $listId)` reuses
`findOwnedList` for the ownership check, returns `false` for not-found/not-owned.
`ListController` gained `DELETE /lists/{id}` → `handleDeleteList`, 204 on success, the
existing 404 `not_found` error otherwise. The PHPUnit `SqliteWpdb` test stub didn't enforce
real FKs before this slice (no `PRAGMA foreign_keys`, no `FOREIGN KEY` clauses on
`si_list_items`) — added both so `WpdbListRepositoryTest`'s new delete-cascade test is a real
regression guard, not a tautology. New tests: `WpdbListRepositoryTest::testDeleteRemoves...`
(cascade + user_product survival), `::testDeleteReturnsFalseForUnknownList`,
`ListControllerTest::testHandleDeleteListRemoves...`,
`::testHandleDeleteListReturns404ForUnknownOrUnownedList`. All 94 PHPUnit tests pass.
**Frontend (app repo):** `db.ts` gained `deleteList(listKey)` (removes the list row and any
`list_items` rows referencing it, mirroring the server cascade locally). `sendMutation.ts`'s
`resolveEndpoint` gained a `DELETE` branch parallel to the existing `POST .../items` one,
matching bare `/lists/{clientUuid}` and resolving to `/lists/{realServerId}` via `getList`
once known, else falling back to the literal endpoint. `ListsScreen.tsx`'s `.listcard` is no
longer itself a `<button>` (can't nest a delete `<button>` inside one) — it's now a wrapper
`<div>` containing a `.listcard__open` button (the original open-list click target, same
visual layout via updated CSS in `list-screens.css`) plus a new trash-icon `.iconbtn` (new
`TrashIcon` in `icons.tsx`) that confirms via `window.confirm` before calling the new
`onDeleteList` prop. `HomeScreen.tsx`'s new `handleDeleteList` follows the exact optimistic-
local → enqueue → `markMutationInFlight` + `sendMutation` shape as `handleRemoveItem`/
`handleCreateList`. New tests: `db.test.ts` (`deleteList` removes list + items),
`sendMutation.test.ts` (`resolveEndpoint` DELETE branch, both the resolved and
not-yet-known-server-id cases), two new `App.test.tsx` cases (online delete-with-confirm
survives reload; offline delete queues and applies once back online) — all pass in
isolation. `npx tsc --noEmit` and `npm run build` both pass. **Note:** adding a second test
to `db.test.ts`/`sendMutation.test.ts` that both call `clearDatabase()` reproduces the same
pre-existing `fake-indexeddb` hook-timeout flakiness already flagged in the §2.3c/§2.2d/
§2.3d/§4.0b entries above — confirmed via `git stash` that this exact hang already happens
on `main` before this slice's changes (e.g. `sendMutation.test.ts`'s original two tests hang
when run together). Root cause looks like `db.ts`'s `getDb()` never closing/reusing IndexedDB
connections across calls, so a later `deleteDB` in the same process can block on a still-open
handle from an earlier test — worth a real fix (singleton connection + explicit `close()`) in
a future slice, out of scope here. All new/changed test files pass when run individually or
alongside the other unaffected files, matching the verification bar used in every prior
"flaky in this sandbox" note above. Pushed to `main` in both repos.

**§2.7 is done (2026-06-18).** Rename a list, inline from the List screen's app bar.
**Backend (plugin repo):** `ListService` gained `renameList(int $userId, int $listId,
string $name): ?ShoppingList` — reuses `findOwnedList` for the ownership check (null for
not-found/not-owned), trims and rejects a blank name the same way `createList` already does
(`\InvalidArgumentException`), then calls the existing `ListRepositoryInterface::update()`
(`WpdbListRepository::update()` already supported a name-only update — no repository
changes needed) with a fresh `updated_at` from the injected `Clock`. `ListController` gained
`PATCH /lists/{id}` → `handlePatchList`: 200 with the updated list on success, 400
`validation_error` on a blank name, the existing 404 `not_found` otherwise. New
`ListControllerTest` cases: successful rename + `updated_at` bump, 404 for unknown/unowned
list (and confirms the other user's list name is untouched), 400 on a blank/whitespace-only
name (and confirms the original name survives). All 97 PHPUnit tests pass.
**Frontend (app repo):** `ListScreen.tsx`'s app-bar title is now a button that swaps to an
autoFocus `<input>` on click; Enter or blur commits (skipped if the trimmed value is blank or
unchanged), Escape reverts without saving. New `onRenameList: (name: string) => void` prop.
`HomeScreen.tsx`'s new `handleRenameList` follows the exact optimistic-local (`putList`) →
enqueue (`PATCH /lists/{id}`, body `{ name }`) → `markMutationInFlight` + `sendMutation` shape
as `handleDeleteList`/`handleToggleChecked`; for a still-offline-born list (no server `id`
yet) it merges into the pending create mutation's body via the existing
`updateMutationBody`, exactly like `handleToggleChecked` does for quantity/checked edits.
`sendMutation.ts`'s `resolveEndpoint` had three independent `if` blocks (`POST` / `DELETE` /
unconditional fallback) — **not** a `method !== 'POST'` shared branch as a first draft of
this slice's spec assumed (corrected in `13-implementation-line.md` §2.7 before
implementation); a `PATCH` mutation previously fell through to the literal endpoint
unresolved. Fixed by widening the existing `DELETE` condition to
`mutation.method === 'DELETE' || mutation.method === 'PATCH'` (identical resolution logic for
both). New tests: `sendMutation.test.ts` (PATCH `resolveEndpoint` case, mirroring the DELETE
one), three new `App.test.tsx` cases (online rename persists after reload; offline rename
queues and survives reconnect; blank-name save is a no-op and issues no PATCH). All pass in
isolation; running the offline-rename test alongside other tests in the same file reproduces
the same pre-existing `fake-indexeddb` cross-test flake already flagged in the §2.6 entry
above (confirmed via `git stash` that "deleting a list while offline..." hangs the same way
on unmodified `main`) — not introduced by this slice. `npx tsc --noEmit` and `npm run build`
both pass. Pushed to `main` in both repos.

**§4.0c-fix is done (2026-06-19).** Fixed the bug below: `AddSearchScreen.tsx`'s
`noMatch` (`query.trim() !== '' && results.length === 0`) gated **both** the "нов
термин" and "конкретен артикул" buttons on `results.length === 0`, hiding both
whenever any UserProduct term partially matched the query. Replaced with `hasQuery`
(`query.trim() !== ''`) — both buttons now render whenever the query is non-empty,
independent of `results`, per the Owner's explicit instruction ("и двата бутона винаги
видими, когато има текст"). No change to matching logic, `addNewTerm`, or
`addManualStoreProduct` — visibility-only. `addSearch.test.tsx`: removed the now-wrong
assertion that `add-new-term` is absent on a match, and added a new test asserting both
`add-new-term` and `add-specific-item` render when a term matches. `npx tsc --noEmit`
and `npm run build` both pass. The full `addSearch.test.tsx` file fails entirely in
this sandbox on the pre-existing, environment-specific `btoa` "Invalid character" issue
(Node 25's stricter `btoa` rejecting the Cyrillic display name in the test fixture) —
confirmed via `git stash` identical on unmodified `main`, same issue flagged in the
§4.0c entry below; all other test files (`bottomNav`, `db`, `theme`, `connectivity`,
`offlineBanner`, `syncStatusIndicator`, `catalogScreen`) pass clean. Pushed to `main`.

**Original bug report (2026-06-19) — "Добави конкретен артикул" button is hidden whenever any
UserProduct term partially matches the search text.** `AddSearchScreen.tsx`'s `noMatch`
(`query.trim() !== '' && results.length === 0`) gated **both** the "нов термин" and the
"конкретен артикул" buttons identically. Since `results` matching is substring-`includes`
(line ~79-80), typing "мляко" when the Owner already has a UserProduct term "мляко" made
`results.length > 0` → `noMatch === false` → **neither** button rendered, including the
manual-StoreProduct one, which should always be offered regardless of term matches. This is
why the Owner saw "no button" testing §4.0c on shopping.flux.bg; not a deploy/migration
issue, a real frontend logic bug. **Fixed above.**

**§4.0c is done (2026-06-18), with the above bug found 2026-06-19.** Manual StoreProduct creation — the "specific item" path,
alongside the existing broad-term path, in Add/Search. **Backend (plugin repo):** new
migration `AllowDirectStoreProductListItemsMigration` (id `6`) makes `list_items.user_product_id`
nullable, adds `list_items.store_product_id` (nullable, FK `RESTRICT`), makes
`store_products.store_id` nullable, and adds `store_products.source`
(`ENUM('crawler','user')`), `created_by_user_id`, `image_url`. New `Models/StoreProduct.php`,
`Repositories/Contracts/StoreProductRepositoryInterface`, `Repositories/Wpdb/
WpdbStoreProductRepository` (mirrors `WpdbUserProductRepository`'s shape, all nullable columns
bound via the existing `WpdbNullSafe::bind()` helper), `Services/StoreProductService::findOrCreate`
(creates a `source='user'`, `store_id=null`, `category_id=null` row; replays on duplicate
`client_uuid` the same way `UserProductService::findOrCreate` does). `Models/ListItem` gains a
nullable `storeProductId` alongside the now-nullable `userProductId`; `WpdbListItemRepository::insert()`
throws `InvalidArgumentException` unless exactly one of the two is set — the app-level
enforcement point the canon calls for, since the DB has no `CHECK` constraint for this.
`ListService::createItem()` widened to accept an optional `storeProductId`/`inlineStoreProduct`
alongside the existing UserProduct params, resolving exactly one of the four into the new
`ListItem` (throws `InvalidArgumentException` if zero or more than one is given).
`ListController::handleCreateItem` reads the new `store_product_id`/`store_product` request
params the same way it already read the UserProduct ones; `itemData()`'s response now returns
`user_product_id`/`store_product_id` (either may be null) and, for a StoreProduct-backed item,
`name`/`image_url` instead of `term`/`category_id`/`brand_anchor`. `Plugin.php` wires the new
repository/service through to `ListService`/`ListController`. The PHPUnit `SqliteWpdb` test stub
gained a `store_products` table and the same nullable/new columns on `list_items`. Every existing
`new ListItem(...)` call site across the test suite needed a `storeProductId` argument added —
all updated. New tests: `WpdbStoreProductRepositoryTest`, `StoreProductServiceTest`, two new
`WpdbListItemRepositoryTest` cases (store-product-only round trip; rejects both/neither set),
two new `ListControllerTest` cases (inline StoreProduct create returns `store_product_id` set/
`user_product_id` null; rejects both UserProduct and StoreProduct provided together). All 109
PHPUnit tests pass (was 97). **Frontend (app repo):** `db.ts`'s `DB_VERSION` bumped to `2`, adding
a `store_products` IndexedDB object store; `ListItemRecord` gained optional
`store_product_id`/`store_product_client_uuid` (and `user_product_id`/`user_product_client_uuid`
are now optional too, mirroring the backend's exactly-one-of); new `putStoreProduct`/
`getStoreProductByClientUuid` helpers mirror the UserProduct ones; `getListItems()` now falls
back to a StoreProduct's `name` when no UserProduct match exists, so an existing rendering code
path (`ListScreen.tsx`/`HomeScreen.tsx`'s `item.term`) needed no changes to display a manually-
added specific item correctly. `mergeServerListItem` (the §2.3d server-pull-on-boot merge,
out of this slice's scope to rebuild but needed a type/null-safety pass so it doesn't throw on a
store-product-backed server item) now handles a null `user_product_id` and an optional
`store_product_id`/`name` pair. `AddSearchScreen.tsx` gained a second create affordance next to
the existing "Добави „...” като нов термин" button — "Добави конкретен артикул" — opening an
inline form (name required, photo-URL and barcode optional text inputs only, per slice scope: no
camera/upload/scanner). Submitting creates the StoreProduct locally (optimistic, via the new
`putStoreProduct`), enqueues the create mutation with `store_product` (inline) in the body
instead of `user_product`, and follows the exact same optimistic-add → enqueue →
`markMutationInFlight` + `sendMutation` shape `addItemToList` already used. Barcode is collected
in the form but not persisted anywhere yet (the `StoreProduct` model/migration has no barcode
column — out of scope per the slice, flagged here as a known gap for whenever barcode-scanner
work (`decisions.md §14`) lands). New tests: `db.test.ts` (StoreProduct helper round-trip;
`getListItems` resolves a store-product-backed item's name), six new `addSearch.test.tsx` cases
(shows the new affordance + form; submitting posts `store_product` with name/image; blank name
is a no-op; offline still adds immediately). `npx tsc --noEmit` and `npm run build` both pass.
The new `db.test.ts` cases pass individually but hang with the same pre-existing
`fake-indexeddb`/`clearDatabase()` cross-test flakiness already flagged in the §2.6/§2.7 entries
above when run alongside the file's other tests (confirmed via `git stash` identical on
unmodified `main`); the new `addSearch.test.tsx` cases are blocked by the same pre-existing
sandbox-wide `btoa` "Invalid character" failure in that file's `beforeEach` (Node 25's stricter
`btoa` rejecting the Cyrillic display name used in the test fixture — confirmed via `git stash`
that every test in this file, old and new, fails identically on unmodified `main` in this
sandbox) — both are environment-specific, not introduced by this slice, matching the verification
bar used in every prior "flaky in this sandbox" note above. Pushed to `main` in both repos.
**This slice added a migration (id `6`) — after deploy, go to wp-admin → Plugins → Deactivate →
Activate on Shopping Intellect, then confirm via Tools → SI Schema Status that `schema_version`
is `6`. Owner verification on shopping.flux.bg of this slice's acceptance criteria is
outstanding.**

**§4.0e is done (2026-06-19).** Unlimited-depth categories, many-to-many product↔category, and
~300 seeded default products. **Backend (plugin repo, pushed to `main`):** new migration
`AddCategoryHierarchyAndProductCategoriesMigration` (id `7`) does, in order: (1) adds
`categories.parent_id` (self-FK, `ON DELETE SET NULL`, indexed) for unlimited-depth nesting —
**no depth limit enforced anywhere in code**; (2) creates `oCk_si_product_categories` (nullable
`user_product_id`/`store_product_id`, `category_id`, two unique indexes), migrates every existing
single-FK `category_id` row from `user_products`/`store_products` into it, then drops the
`category_id` column from both tables; (3) widens `user_products.owner_type` to
`ENUM('user','family','system')` and adds `is_global_default`; (4) inserts the 25 new root
categories from `shopping_intellect_mvp_starter_catalog_v1 2.md`'s Category column (slugs:
`fruits`, `vegetables`, `dairy_products`, `meat`, `cold_cuts_deli`, `fish_seafood`,
`bread_bakery`, `pantry_staples`, `canned_jarred`, `spices_baking`, `oils_sauces`,
`sweets_desserts`, `nuts_snacks`, `coffee_tea`, `soft_drinks`, `alcohol`, `frozen_foods`,
`ready_meals`, `home_cleaning`, `personal_care`, `cosmetics`, `baby`, `pets`, `health_pharmacy`,
`seasonal_kitchen_supplies`), then re-parents 19 of the 20 existing `§0.4`-seeded categories
underneath them by the Owner's exact mapping (2026-06-19) — **`eggs` deliberately stays a root
category with no parent**, no matching bucket exists in the new 25; (5) seeds exactly 300
`system`-owned, `is_global_default=1` `user_products` rows (`owner_id=0`), each linked via the
junction table to its file-specified category, `term`/`normalized_term` taken directly from the
file's Product column (Default unit/Quantity suggestions/alias columns are **not** modelled, per
`decisions.md`'s explicit scope note). `Models/Category.php` gained `parentId`;
`CategoryRepositoryInterface`/`WpdbCategoryRepository` gained `findChildren(int): array` (flat
one-level query, no recursive ancestor/descendant chain yet — that's a future slice's job).
`Models/UserProduct.php`/`Models/StoreProduct.php` lost `categoryId` entirely — category
membership now lives only in the junction table, read via the new
`UserProductRepositoryInterface::categoryIdsFor()`/`attachCategory()`/`listGlobalDefaults()`
methods (kept deliberately minimal — no full CRUD API yet). `UserProductController`'s
`GET /user-products` now merges `listGlobalDefaults()` into the caller's own
`listByOwner()` results, so every account sees the seeded terms without any extra request, and
its response shape replaces `category_id` (singular, nullable) with `category_ids` (array) —
also gained `client_uuid`/`owner_id`/`created_at` fields it was missing before (needed so the
frontend's `putUserProduct` can actually cache a fetched seeded term locally; this was a latent
gap that would have silently broken the very acceptance criteria this slice introduces).
`ListController`'s two `category_id` read sites were updated the same way.
`ListService::resolveExistingUserProduct` now allows adding a `system`-owned, global-default
term to **any** owner's list (previously only an exact owner_type/owner_id match was accepted,
which would have rejected every seeded term) — D §14's "adding a seeded product to a list...
[is] unaffected" rule. New `UserProductService::archive()` + `UserProductForbiddenException`
enforce that an ordinary user can never archive a `system`-owned row (no edit/archive UI exists
yet — `§2.8`/`§4.0d`'s job — this is the guard method those future slices will call). The
PHPUnit `SqliteWpdb` test stub gained `categories.parent_id` (with FK), a new
`product_categories` table (with FKs), `user_products.is_global_default`, and lost
`category_id` from both `user_products`/`store_products`. Every existing test constructing a
`new UserProduct(...)`/`new StoreProduct(...)` positionally needed its now-removed `categoryId`
argument dropped — mechanical, all call sites updated. New tests: `MigratorTest` (25 root
categories inserted; 19 of 20 existing categories re-parented and `eggs` excluded; ~300 seed
rows + matching junction rows), new `WpdbCategoryRepositoryTest` (`findChildren`,
`parentId` hydration), `WpdbUserProductRepositoryTest` (`listGlobalDefaults`
filtering, `attachCategory`/`categoryIdsFor` round-trip),
`UserProductServiceTest` (`archive()` rejects a system-owned row, succeeds for the owner's own,
rejects another user's), `ListControllerTest` (adding a system-owned term to a list succeeds),
`UserProductControllerTest` (`category_ids` is an array; `GET /user-products` merges in a
seeded global default alongside the caller's own term). All 122 PHPUnit tests pass (was 109).
**Frontend (app repo, pushed to `main`):** `UserProductRecord.owner_type` widened to
`'user' | 'system'`, gained optional `category_ids`/`is_global_default`; `AddSearchScreen.tsx`'s
`loadTerms` filter changed from `t.owner_id === user.id` to
`t.owner_id === user.id || t.owner_type === 'system'` so seeded terms actually appear in search
results. New `addSearch.test.tsx` case asserts a system-owned seeded term shows up in results
without the Owner ever creating it. `npx tsc --noEmit` and `npm run build` both pass; the
unaffected test files (`bottomNav`, `db`, `theme`, `connectivity`, `offlineBanner`,
`syncStatusIndicator`, `catalogScreen`, `sendMutation`) all pass clean. `addSearch.test.tsx`'s
whole-file run and one `flush.test.ts` case still hit the same pre-existing, environment-specific
sandbox failures flagged in every prior slice's notes above (Node 25 `btoa`/Cyrillic in this
file's `beforeEach`; a timing-sensitive concurrent-drain assertion in `flush.test.ts`) —
confirmed via `git stash` identical on unmodified `main` before this slice's changes.
**This slice adds migration id `7` — after deploy, the Owner must go to wp-admin → Plugins →
Deactivate → Activate on Shopping Intellect to run it (this also runs the 300-row seed step,
which may take a few seconds longer than prior migrations), then confirm via Tools → SI Schema
Status that `schema_version` is `7`. Owner verification on shopping.flux.bg of this slice's
acceptance criteria (a fresh account's Add/Search shows seeded terms like "Домати",
"Краставици", "Шампоан", "Кафе на зърна" without ever typing them; favoriting a seeded term still
works) is outstanding until that migration step runs.**

**§4.0f is done (2026-06-19).** StoreProduct dedupe across users + async Gemini metadata
extraction. **Built directly by Claude (not Codex), by explicit Owner instruction
overriding the normal Claude-designs/Codex-implements split for this one slice** — see
full implementation notes in `slices/13-4.0f-storeproduct-dedupe-gemini-metadata.md`.
**Backend (plugin repo, pushed to `main`):** `StoreProductRepositoryInterface` gained
`findByNormalizedName`, `findPendingMetadataExtraction(int $limit)`,
`updateMetadata(int, ?string, ?string, ?string, DateTimeImmutable)`, `attachCategory(int,
int)`; `WpdbStoreProductRepository` implements all four.
`StoreProductService::findOrCreate` now looks up an existing `source='user'` row by
**exact `normalized_name` match across all users** (no owner/created-by filter) before
inserting — two different accounts typing the same specific item now share one row;
first writer wins, no merge logic, no fuzzy matching, no confirmation dialog. New
migration `AddStoreProductMetadataExtractionMigration` (id `8`) adds
`store_products.size_text`/`variant_text`/`metadata_extracted_at` (all nullable;
`brand_normalized` already existed). `Models/StoreProduct` gained the three new fields
as **trailing optional constructor params** (default `null`) so every existing
positional `new StoreProduct(...)` call site across the test suite needed no changes.
New `HttpClientInterface::post()` (mirrors `get()`'s `is_wp_error`/status/body handling
in `WpHttpClient`, deliberately skips `get()`'s blocked-status/challenge-page detection
— Gemini doesn't need it). New `Models/GeminiExtractionResult` (brand/size/variant/
category, all nullable) + `Services/GeminiMetadataExtractor::extract()` (calls Gemini's
`generateContent` REST endpoint, strips a possible ` ```json ` fence, parses the JSON;
any HTTP failure, non-2xx, or unparseable response returns an all-null DTO rather than
throwing — this runs in a background job, a bad response should never crash it). New
`Services/StoreProductMetadataService::processPending(int $limit = 20)`: pulls pending
rows oldest-first via `findPendingMetadataExtraction`, calls the extractor, writes via
`updateMetadata`, and on a non-null extracted category does a case-insensitive name/slug
match against `CategoryRepositoryInterface::listAll()` — attaches via `attachCategory` on
a match, silently skips on no match (never blocks on a bad guess). New
`bin/extract-metadata.php`, mirroring `bin/crawl.php`'s exact bootstrap shape (same
wp-load.php probe, same autoloader registration), calls `processPending()` once and
exits — **not** wired to `wp_schedule_event`, matching how `bin/crawl.php` is already
operated (real server crontab, not WP-Cron). `ConfigInterface`/`Config` gained
`geminiApiKey()`/`geminiModel()` (`get_option('si_gemini_api_key', '')`/
`get_option('si_gemini_model', 'gemini-1.5-flash')`), mirroring
`googleClientId()`/`googleClientSecret()` exactly. New `Admin/GeminiSettingsPage.php`, a
near-exact copy of `GoogleSettingsPage.php` (Settings → SI Gemini API, API key as a
password input, model as a text input defaulting to `gemini-1.5-flash`), wired into
`Plugin.php` exactly where `GoogleSettingsPage` is wired. The PHPUnit `SqliteWpdb` test
stub gained the three new nullable `store_products` columns, and got a real bug fixed in
its `prepare()` reimplementation: `WpdbNullSafe::bind()`'s pattern of pre-quoting a
nullable string and interpolating the already-quoted SQL literal into an outer
`$wpdb->prepare()` call works in real WordPress (core `prepare()` escapes literal `%`
before its own `vsprintf`), but the stub's naive `vsprintf` reimplementation didn't
replicate that escaping — a value containing a literal `%` (e.g. `variant_text = "2%"`)
crashed `vsprintf` with "Unknown format specifier". **Fixed in the test stub only**, not
production code — this was a test-double gap (every other `WpdbNullSafe::bind()` call
site had simply never been exercised with a literal `%` in its value before), not a real
production bug. New tests: `StoreProductServiceTest` (cross-user dedupe returns the same
id; different wording still creates a separate row), `WpdbStoreProductRepositoryTest`
(`findByNormalizedName` round-trip; `findPendingMetadataExtraction` oldest-first + limit
+ excludes already-extracted rows; `updateMetadata` field+timestamp write;
`attachCategory` junction-table round-trip), `GeminiMetadataExtractorTest` (well-formed
parse, markdown-fenced parse, malformed-JSON-returns-nulls, non-2xx-returns-nulls,
client-throws-returns-nulls), `StoreProductMetadataServiceTest` (writes extracted fields
+ attaches a matching category; skips attachment gracefully on no category match;
returns 0 when nothing is pending). All 137 PHPUnit tests pass (was 122). **This slice
adds migration id `8`** — after deploy, go to wp-admin → Plugins → Deactivate → Activate
on Shopping Intellect, then confirm via Tools → SI Schema Status that `schema_version` is
`8`. **Flags for the Owner:** (1) a real Gemini API key + model must be set in wp-admin →
Settings → SI Gemini API before extraction does anything beyond writing nulls; (2)
`bin/extract-metadata.php` needs a real crontab entry on the server — this is a new
operational dependency, and there is no existing documented crontab entry for
`bin/crawl.php` either (checked `09-risks-costs.md` and this file — neither records one),
so there's no precedent line to copy; whoever has server access needs to add crontab
entries for both scripts. Owner verification on shopping.flux.bg of this slice's
acceptance criteria (cross-user dedupe via DB query; manual item add stays instant; the
new settings page persists a saved key/model; a real Gemini key + a cron run populates
extracted fields) is outstanding.

**§4.0f follow-up (2026-06-19): optional synchronous Gemini test mode.** The Owner wants
to test the Gemini integration immediately after creating each item, without waiting for
a cron cycle or a real crontab entry to exist yet. Added a **wp-admin-only opt-in**, not a
permanent architecture change — `si_gemini_sync_test_mode` (new checkbox on Settings →
SI Gemini API, "Extract synchronously (testing only)", off by default). When checked,
`StoreProductService::findOrCreate` calls `StoreProductMetadataService::processOne()`
(new method, factored out of `processPending()`'s loop body so both share the same
extract → updateMetadata → category-attach logic) inline, right after insert, and returns
the re-fetched row with metadata already populated — **this blocks the add-to-list
request on the Gemini round-trip**, a deliberate, explicit exception to the offline-
first/optimistic-add iron rule (CLAUDE.md §2), scoped to manual testing only. When the
checkbox is off (the default, and the only state anyone should ship/leave running),
behavior is byte-for-byte the same as the original §4.0f: `findOrCreate` returns
immediately, Gemini only runs later via `bin/extract-metadata.php`.
`StoreProductService` gained two new optional trailing constructor params
(`?StoreProductMetadataService $metadataService = null`, `bool $syncMetadataExtraction =
false`) — both default to "off," so the one existing call site in `Plugin.php` needed an
explicit wiring change to turn it on, and no other code or test had to change to keep the
old behavior. `ConfigInterface`/`Config` gained `geminiSyncTestMode(): bool`
(`get_option('si_gemini_sync_test_mode', '') === '1'`). `Plugin.php` only constructs the
`GeminiMetadataExtractor`/`StoreProductMetadataService` pair when the flag is on, so a
normal request with the checkbox unchecked does zero extra work. New tests:
`StoreProductServiceTest::testFindOrCreateRunsGeminiSynchronouslyWhenTestModeEnabled`
(fake Gemini HTTP client, asserts the returned StoreProduct already has
brand/size/variant/extracted-at populated) and
`::testFindOrCreateSkipsGeminiWhenTestModeDisabled` (fake client throws if ever called —
proves Gemini is never touched when the flag is off, the production-default path). All
139 PHPUnit tests pass (was 137). Pushed to `main`. **No new migration** — this is
config/wiring only. **Reminder for whoever flips the checkbox on:** turn it back off
before considering the feature "live" for real users; it exists solely so the Owner can
see Olympus/1л/2%-style fields appear immediately while testing with a real (free-tier)
Gemini API key, and free-tier rate limits (~15 RPM) will be hit fast if synchronous mode
is left on under real traffic.

**§4.0f follow-up #2 (2026-06-19): "Test Gemini connection" button on the settings page.**
The Owner wanted a quick way to verify the Gemini key/model work *before* relying on the
production add-item flow to surface problems. `Admin/GeminiSettingsPage.php` gained a
second form below the existing settings form — a "Test connection" section with a
secondary-style "Test Gemini connection" button, disabled if no API key is saved yet.
Submitting it posts to a new `admin_post_si_gemini_test_connection` handler
(`GeminiSettingsPage::handleTestConnection()`, capability-checked + nonce-verified via
`check_admin_referer`), which builds a `GeminiMetadataExtractor` from the **currently
saved** key/model (not whatever's typed but unsaved in the form) and calls
`extract()` on a fixed sample string, `"Мляко Олимпус 2% 1л"`. Since
`GeminiMetadataExtractor::extract()` never throws — every failure mode (bad key, wrong
model name, network error, unparseable response) collapses into "all four fields come
back null" — that's the one signal available to distinguish success from failure here:
all-null renders a yellow `notice-warning` ("Gemini responded with nothing usable...");
anything else renders a green `notice-success` listing the extracted
brand/size/variant/category inline. Result is passed back via a `wp_safe_redirect` with
the values in the query string (sanitized through `sanitize_text_field` on read), so a
page reload doesn't resubmit the test. **This is a real, metered Gemini API call** — same
quota/cost as a production extraction, not a stub — so don't click it repeatedly. No new
tests (admin-page rendering wired to live WP functions, consistent with
`GoogleSettingsPage`/the rest of `GeminiSettingsPage` having no PHPUnit coverage either —
this class's logic is exercised by the already-tested `GeminiMetadataExtractor` it calls
into). All 139 PHPUnit tests still pass (unchanged count — no new testable logic, just
wiring). Pushed to `main`. **No new migration.**

**§2.8a is done (2026-06-20).** UserProduct detail screen — rename, favorite, and
quantity/unit editing, replacing `ListScreen`'s "Expand details soon" placeholder for any
list row backed by a `user_product_id`/`user_product_client_uuid` (StoreProduct-backed
rows are still untouched — that's `§2.8b`, not built yet). **Backend:**
`UserProductService::rename()`/`setFavorite()` (`src/Services/UserProductService.php`) —
both share a private `ownedNonSystemUserProduct()` guard mirroring `archive()`'s existing
system-row/ownership check. `rename()` re-runs `TermNormalizer`, rejects a collision with
another existing row for the same owner via `DuplicateUserProductTermException` (409, no
merge semantics — rejected outright per the iron rule on dedupe). New
`PATCH /user-products/{id}` route (`UserProductController::handlePatch()`) accepts
`term` and/or `is_favorite`, 400 if neither given, 403 on a system row, 409 on a
duplicate term. 157 PHPUnit tests pass (11 new ones from this slice). **Frontend:** new
`UserProductDetailScreen.tsx` (term input + Save, favorite ♥/♡ toggle disabled for
`owner_type === 'system'`, read-only category badges via the existing public
`GET /categories`, quantity/unit inputs committed on blur) opened from `ListScreen`'s
planning-mode item row (now a `<button>` instead of static text, only when
`user_product_client_uuid` is set). `HomeScreen.tsx` generalized `handleToggleChecked`
into `handleUpdateItem(item, patch)` (carries `is_checked`/`quantity`/`unit`, same
optimistic-local → enqueue → `markMutationInFlight` + `sendMutation` shape as before) and
added `handleRenameUserProduct`/`handleSetFavorite`. Offline-safety nuance: a rename on a
UserProduct with no server `id` yet (still riding the list item's create-on-write inline
payload) merges into that pending CREATE mutation's nested `user_product.term` via
`updateMutationBody` rather than enqueueing a second PATCH; a rename that gets a same-session
403/409 back reverts the optimistic local write and drops the now-permanently-failing
mutation (shown inline, not just as a generic failed-sync badge) — but a queued rename that
fails later while offline still gets surfaced only via `SyncStatusIndicator`, not retroactively
inline. `is_favorite` added to `UserProductRecord` (`storage/db.ts`); `sendMutation.ts`'s
`resolveEndpoint` gained a `/user-products/{clientUuid}` → real-id resolution branch
(mirrors the existing `/lists/{clientUuid}` one). New test file
`src/test/userProductDetail.test.tsx` (6 tests). `npm run build` and `tsc -b` pass.
**Known gap, not fixed in this slice:** `mergeServerListItem` (`storage/db.ts`) hardcodes
`owner_type: 'user'` when first creating a local `user_products` row from a synced list
item, because `ListController::itemData()` doesn't return the UserProduct's real
`owner_type`/`is_favorite`/`category_ids` — so immediately after a hard sync (before
`AddSearchScreen` has ever run its own `GET /user-products` fetch in that session), the
detail screen's "hide favorite/edit on a system row" check could see the wrong
`owner_type` for a seeded term. Flagging this for `decisions.md` rather than fixing it
here — fixing it properly means widening `itemData()`'s response shape, a separate,
slightly bigger change. **Verification note:** browser automation (chromium-cli/Playwright)
isn't installed in this sandbox, so this slice was verified via PHPUnit + Vitest/jsdom
(real DOM render/click/blur) + `tsc`/`vite build`, not an actual rendered-browser
screenshot — Owner should still eyeball the real flow on `shopping.flux.bg` per usual.

**§2.8a fix (2026-06-20): item tiles going permanently unclickable after navigating a
few screens.** Owner-reported on `shopping.flux.bg`: after opening/closing a couple of
lists, planning-mode tiles stopped responding to taps. Root cause:
`HomeScreen::handleOpenItemDetail()` looked up the tapped item's UserProduct **only**
in the local `user_products` IndexedDB store and silently `return`ed if that lookup
missed — which looks identical to "not clickable" from the Owner's side. A list item's
`user_product_client_uuid` can outlive its own `user_products` row locally (e.g. the
hard sync's `clearSyncedData()` wipes `user_products` before that specific item's own
`mergeServerListItem()` call has re-populated it). Fix: on a local cache miss,
`handleOpenItemDetail()` now falls back to `GET /user-products` (same endpoint
`AddSearchScreen` already uses) before giving up, and a definitive failure now shows a
visible `setErrorMessage(...)` instead of doing nothing. Confirmed as a real regression
risk, not a hypothetical: reverting just this fix (`git stash` on `HomeScreen.tsx`
alone) reproduces the silent-failure timeout in the two new tests below before the fix,
and they pass after it. New test file `src/test/itemDetailOpen.test.tsx` (2 tests,
seeds a list item whose `user_product_client_uuid` has no matching local
`user_products` row, asserts the server-fallback opens the screen, and that a
double-miss surfaces the inline error rather than silence). **Not yet confirmed
whether this fully explains every occurrence** — the exact trigger (which precise hard
sync timing/ordering produces the missing local row) wasn't reproduced end-to-end, only
the resulting cache-miss-then-silent-failure symptom; if tiles still go unclickable
after this deploys, that points at a different/additional cause and needs fresh
Owner repro steps (which screens, in what order, online or offline at the time).

**§2.8a fix #2 (2026-06-20): actual root cause found — `mergeServerListItem`'s
freshness guard, not navigation order.** The Owner's follow-up report was more precise:
it's positional within one list (everything above a given tile is stuck, everything
below it works), not tied to "2-3 screens." That ruled out fix #1's hard-sync-timing
theory and pointed at `storage/db.ts`'s `mergeServerList()`/`mergeServerListItem()`,
both of which skip re-writing a row whenever `local.updated_at >= server.updated_at` —
**including when they're equal**. Confirmed via `plugin/`'s own git history: commit
`84cf0b7` ("Include client_uuid in itemData()'s user_product/store_product fields",
2026-06-20 09:40) changed the *shape* of `GET /lists/{id}`'s response — adding
`user_product_client_uuid` for items that previously didn't get it — **without**
bumping those items' `updated_at` (the underlying data never changed, only the API
contract did). Any item not touched since stays at `local.updated_at === server's
updated_at` forever, so the `>=` guard skips its re-merge on every subsequent hard
sync, permanently freezing it at its old, incomplete shape — exactly "everything
synced before today's backend fix is stuck, everything synced after it works,"
matching a positional split by creation order (`getListItems()` sorts by
`created_at`). This is a **latent bug independent of `§2.8a`** — any future field
added to a response without bumping `updated_at` would hit the same trap — `§2.8a`
only made it *visible* by being the first thing to actually act on
`user_product_client_uuid`'s presence. **Fix:** loosened both guards from `>=` to
strict `>` (`db.ts`), so an equal-timestamp server response still re-applies instead of
being skipped — safe, since it's then either a true no-op rewrite or it's picking up a
newly-added field. **Verified, not assumed:** reverted just this one-line-pair via
`git stash` and confirmed the new regression test
(`db.test.ts` — `mergeServerListItem re-applies a same-timestamp server response that
gained a field`) fails on the old `>=` guard and passes on `>`. This self-heals on the
next hard sync after deploy — no migration needed, no manual data fix.

**§2.8a fix #3 (2026-06-21): selecting an existing autocomplete term threw a sync
error.** Owner-reported: picking an *existing* term from Add/Search's search results
(not "добави нов термин") showed the failed-sync (exclamation) icon. Root cause was
already diagnosed and fixed in a **prior, uncommitted** local change to
`AddSearchScreen.tsx` that had been sitting in the working tree this whole time without
ever being pushed — so `shopping.flux.bg` never actually had the fix, despite it
looking "already handled" in the source. The bug itself: selecting an existing term
(in particular a `system`-owned seeded one) re-sent it inline as
`user_product: { client_uuid: product.client_uuid, term }`. Server-side,
`ListService::createInlineUserProduct()` → `UserProductService::findOrCreate()` looks
up an existing row scoped to the *list's own* `owner_type`/`owner_id` — a `system`-owned
row never matches that scope, so it falls through to `insert()` with the **incoming
client_uuid**, which collides with the client_uuid the seeded row already owns →
`DuplicateClientUuidException`. `findOrCreate()`'s catch only re-checks for an
owner-scoped match (still none, same reason) and re-throws — and
`ListController::handleCreateItem()` only catches `\InvalidArgumentException`, so this
exception was uncaught, producing a 500 and the failed-sync icon. The fix (now verified
and shipped): when `product.id` is already known, send `user_product_id` instead of
re-sending the inline create payload — only a term created locally and never yet synced
(no `id` yet) still needs the inline path. **Verified, not assumed:** the matching test
in `addSearch.test.tsx` ("selecting an existing term posts ... with user_product_id")
was *also* sitting uncommitted; running the full file surfaced a second, unrelated,
genuinely-universal bug — `makeToken()`'s test helper called plain `btoa()` on a payload
containing Cyrillic, which throws `InvalidCharacterError` in any JS engine (not a sandbox
quirk, despite that being this file's standing excuse in earlier entries) — fixed by
keeping the *token's* payload ASCII-only (the explicit `user:` field passed to
`setSession()` is what the UI actually reads, untouched, still Cyrillic). With that
fixed, all 13 tests in the file pass, confirming the product fix is correct. **Separate
finding, not fixed here:** `app/.github/workflows/deploy.yml` never runs `npm test` —
only `tsc -b && vite build` — so a broken test file (like this one was, universally,
for months) can never block a deploy; nothing today gates merges on the Vitest suite
passing. Worth a future slice. Pushed to `main`.

**§2.8a fix #4 (2026-06-21): Owner screenshot of the "Домати" detail screen raised
"is this what we have?" — investigated rather than assumed.** Wrote a throwaway probe
test reproducing the screenshot's exact real-world precondition (a `system`-owned seeded
term whose local `user_products` cache already has the *full, correct* shape — proven
by the fact the screenshot's "Зеленчуци" category badge rendered at all, since
`mergeServerListItem()`'s placeholder write never sets `category_ids`, only a full
`GET /user-products` response does). Result: `term`/`is_favorite` **were already
genuinely disabled** under the hood (`disabled` attribute confirmed `true` for all
three controls) — the system-row protection works. The real, confirmed bugs were two
separate UI/display gaps, not a permissions bug:
1. **Disabled controls were visually indistinguishable from enabled ones** —
   `.iconbtn`/`.addbar__field` had no `:disabled` styling anywhere in `list-screens.css`,
   so a correctly-blocked Save/♥/input looked exactly as tappable as a working one.
   Added `opacity: .4`/`.5` + `cursor: default` for both classes' `:disabled` state.
2. **The internal default unit value `'piece'` (English) rendered verbatim** in list
   rows — it's a real default on both sides (`ListService::createItem()`'s PHP fallback
   *and* the `oCk_si_list_items.unit` column's own `DEFAULT 'piece'`), so the stored
   value itself was deliberately left alone (a data/schema decision, not mine to make
   unilaterally) — only the **read-only display** in `ListScreen.tsx`'s two item rows
   now maps `'piece'` → `'бр.'` via a small `displayUnit()` helper. The detail screen's
   quantity/unit *inputs* are intentionally left untranslated (translating an editable
   field's initial value would make `commitQuantityUnit()`'s "did the user actually
   change anything" comparison misfire and send a spurious PATCH on open).
Both verified the same way as every other fix today: written, reverted via
`git stash`, confirmed failing on the old code, restored. New tests:
`userProductDetail.test.tsx`'s existing disabled-state test (unchanged, already covered
this) + a new case in `itemDetailOpen.test.tsx` ("shows бр. instead of ... piece").
Pushed to `main`.

**2026-06-17 production incident — sync pipeline, four stacked bugs.** Every list/item was stuck
`sync-pending` forever. Root-caused and fixed live (outside the normal Slice flow, by explicit
Owner direction, since it was actively breaking production):
1. Host stripped the `Authorization` header before PHP saw it → fixed in `app/.htaccess`
   (`RewriteRule ... [E=HTTP_AUTHORIZATION:...]`). Pushed `3ac40ad`.
2. `fetchAuth()` spread a `Headers` instance (`{...init.headers}`), which silently drops every
   entry → fixed in `app/src/api/session.ts` (`new Headers(init.headers)`). Pushed `540fb75`.
3. `WpdbUserProductRepository::insert()`/`update()` bound a brand-new term's
   `category_id: null` through a raw `%d` placeholder, which `$wpdb->prepare()` coerces to `0`,
   violating the `fk_user_products_category` FK and 500ing every "add a new item" call.
   **Targeted hotfix shipped live** (plugin `main` `e5c58cc`, verified via direct API call —
   `201` with `category_id: null` correctly returned) so item-add works again now. **Fixed
   for real in §2.3a** (plugin `main` `2b99243`): a shared `WpdbNullSafe::bind()` helper in
   `Repositories/Wpdb/` now backs `WpdbUserProductRepository` (replacing the inline TODO
   ternary), `WpdbUserProfileRepository::upsert()`, and `WpdbRefreshTokenRepository::insert()`
   (the latter two had the same coercion bug — silent wrong-value writes, not yet a crash).
   PHPUnit's `SqliteWpdb` test stub was also corrected to replicate real `$wpdb`'s null→0/''
   coercion (it had been silently doing the right thing itself, masking the bug from tests) —
   88 tests green, including new null-path coverage that fails without the fix.
4. Frontend mutation-send logic was hand-duplicated **five** times (`HomeScreen.tsx` ×4 — create
   list, add item, toggle checked, remove item — `AddSearchScreen.tsx` ×1) — why (1)-(3) could be
   fixed for "create a list" without fixing "add an item." **Fixed in §2.3b**: all five now route
   through the single shared `app/src/sync/sendMutation.ts`.
Full writeup + the architecture decision (shared null-safe binder; one shared `sendMutation`):
`decisions.md` "Resolved — sync-pipeline incident" · `01-architecture.md` §5/§6.5 (amended) ·
`07-frontend.md` §5.5 (added).

**§2.2d (new, added 2026-06-17):** a UI-consistency audit (triggered by an Owner request for a
unified design/UX pass) found four concrete bugs in the screens §2.2c/§4.0 shipped: a
`SyncStatusIndicator` duplicated verbatim in `ListScreen.tsx` and `ListsScreen.tsx`; `EmptyState`'s
"Create list" button has no `onClick` (dead) and `ListsScreen.tsx` renders its own duplicate
inline empty-state instead of using the `EmptyState` component; a partial English/Bulgarian copy
mix (`ListScreen.tsx`/`EmptyState.tsx`/`HomeScreen.tsx` error strings are English while
`ListsScreen.tsx`/`AddSearchScreen.tsx` are Bulgarian); and `ListScreen.tsx`'s `onOpenAddSearch`
prop is threaded all the way from `App.tsx` but never called by any button. Full findings +
build instructions in `slices/13-2.2d-ui-consistency-cleanup.md`. **Item 1 (dedupe
`SyncStatusIndicator`) is done — `§2.3c` (closed 2026-06-17) superseded it** by replacing
both inline copies with a new shared component anyway — skip item 1 when this slice
runs. Slotted in before §3.2 — see
`13-implementation-line.md` §2.2d. Also see new `14-user-stories.md` (user stories per flow,
flags that there is no `PATCH`/`DELETE /lists/{id}` anywhere in the canon — no way to rename or
delete a whole list today — as an open `decisions.md §14` candidate, not invented here).

---

## 4. Before you start work, checklist for the AI instance

This applies whether you're Claude planning a Slice or Codex building one.
**The Owner does not read or write code, and does not know repo paths, branches,
or deploy mechanics — don't ask them.** Everything you need is in this file.

1. **Which repo does this task touch?** `plugin/` (PHP/WP) or root (`app/`, docs)?
   `cd` there and confirm with `git remote -v` before committing.
2. **No local WP exists** — use PHPUnit for plugin logic, `staging` branch for
   anything that needs a live WP to verify.
3. **Check this file's §3 table** before claiming a Slice is "not started" or
   "already done" — it's the live checklist, `13-implementation-line.md` is the
   static plan.
4. **To ship:** commit + push to the repo/branch in §2 (CI deploys automatically —
   you don't trigger deploys manually). Push plugin work to `staging` for the
   Owner to test against `shopping.flux.bg` unless the Slice says `main`.
5. **Before reporting a Slice done:** update §3 below — flip this slice to ✅ and
   move "Next up" to the next one. This is the Owner's only signal of progress —
   if you skip it, the next session re-derives everything from scratch.
6. Secrets (FTP/SSH) live in GitHub Actions secrets — never ask the Owner for
   credentials. If a deploy fails, that's a GitHub Actions logs question.
