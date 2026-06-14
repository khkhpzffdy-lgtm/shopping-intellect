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

**Next up: §2.3 — Offline mutation flush / retry engine**
(the durable reconnect sync pass that drains `mutation_queue`).

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
