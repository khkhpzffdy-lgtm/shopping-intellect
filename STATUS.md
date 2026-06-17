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

**Next up: §2.3c** — `SyncStatusIndicator` redesign + offline banner, now displaying the unified queue.

**Build order (2026-06-17, revised same day):** §3.1 (done) → §4.0 (done) → §2.3a (done) → §2.3b (done) → **§2.3c**
→ §2.2d → §3.2 → §3.3 → §4.1 → §4.2 → §4.3 → §2.4 (Family) → §2.5 (Favorites) → M5.
Rationale: §4.0 is pure frontend with no DB dependency. §3.2/§3.3 (ingestion + cron) follow
immediately so real offers are in the DB before §4.1 ships — the Owner sees real prices from
day one, not empty state. §2.3a/§2.3b/§2.3c jumped the queue ahead of §2.2d same day — see incident
note immediately below. See `13-implementation-line.md` "Re-sequencing" for full reasoning.

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
`SyncStatusIndicator`) is now superseded by `§2.3c`** (added same day, runs first per the
revised build order below) — skip item 1 when this slice actually runs, it'll already be done.
Slotted in before §3.2 — see
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
