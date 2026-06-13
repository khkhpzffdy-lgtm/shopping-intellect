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
- **`main` → production**, via SSH + `rsync` to a live WP install (secrets:
  `SSH_HOST/PORT/USER/SSH_PRIVATE_KEY/SSH_TARGET_PATH`). Excludes `tests/`,
  `.github/`, `phpunit.*`.
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
| §1.5+ | Everything after §1.4b | ❌ not started |

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
`GoogleAuthVerifier` in `Repositories/Wp/`). Two WP options must be set in
wp-admin before real Google logins work: `si_google_client_id` and
`si_google_client_secret` (read via `Config::googleClientId()` /
`googleClientSecret()` from `get_option()`). Until those are set to real Google
OAuth credentials, the token exchange will fail and the endpoint returns
`401 google_verification_failed` (expected/safe default).

**§1.5 (frontend Google button) — done:** `AuthScreen` shows a "Вход с Google"
button below the email/password form when `VITE_GOOGLE_CLIENT_ID` is set
(`app/src/api/session.ts` `googleAuthUrl()`); it redirects to Google's OAuth
consent screen with `redirect_uri` = the app's own origin+path. On return,
`App.tsx` boot picks up `?code=...`, strips it from the URL, and calls
`POST /auth/google` (`api/client.ts` `loginWithGoogle`), landing on the same
session flow as email/password. **Needs a `VITE_GOOGLE_CLIENT_ID` build env var** — without it the button is
hidden. Wired into `.github/workflows/deploy.yml` as
`secrets.VITE_GOOGLE_CLIENT_ID`; **the Owner must add a `VITE_GOOGLE_CLIENT_ID`
repo secret** (GitHub → repo → Settings → Secrets and variables → Actions) with
the Google OAuth client ID, and add it to `app/.env.local` for local dev. The
Google client ID's "Authorized redirect URIs" in Google Cloud Console must
include the app's origin (e.g. `https://app.<domain>/`), matching what
`googleRedirectUri()` sends.

**Next up:** whatever the next unstarted M1/M2 slice is in
`13-implementation-line.md` (M1 closes after §1.5; M2 starts at §2.1) — check
there for the spec before starting. Cross-check against the files above so you
don't re-build something that already exists.

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
