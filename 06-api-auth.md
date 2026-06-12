# 06 — API & Auth

> **Load when:** adding or changing a REST endpoint; touching the auth/refresh flow;
> deciding a request/response shape; wiring CORS, rate limits, or the error envelope;
> reviewing a PR that crosses the frontend↔backend seam.
> **Depends on:** `decisions.md` (always loaded) · `01-architecture.md` (the skeleton) ·
> `02-domain-model.md` (the meaning) · `04-database.md` (the persistence).
> **Standalone for:** the `si/v1` endpoint catalog, JWT internals, the refresh-token
> rotation & reuse-detection *flow*, CORS, rate limiting, the error envelope, and API
> versioning. For storage of tokens/entities → `04` · PWA sync mechanics that *consume*
> these endpoints → `07` · why auth is shaped this way → `01 §6/§7`.

-----

## 1. Purpose & the contract rule

This document is canonical for the **wire contract**: every `si/v1` endpoint, its auth
requirement, its request and response shapes, its error codes — plus the JWT and
refresh-token *flows* that protect them. It does **not** re-decide architecture (`01`),
re-define meaning (`02`), or re-specify storage (`04`); those are referenced as *arch.
§n*, *02 §n*, *04 §n*, *D §n*.

Two contracts are fixed elsewhere and merely **applied** here (arch. §7):

- **The JWT claim set is the contract** — `user_id`, `family_ids[]`, `roles[]` — not the
  issuer. A Stage-3 standalone auth service must mint the *same* claims (arch. §7, D §8).
- **The REST response shapes are the contract** — not WordPress. A Stage-3 standalone API
  must return the *same* shapes, so the PWA never notices the backend swap (arch. §7).

Guard those two and every box behind them is swappable. Everything in this document is
written to keep both stable.

The demand-first model (D §4, 02 §4/§6/§7) shows up directly on the wire: a `list_item`
references a **`user_product_id`**, never a `product_id`; opening a UserProduct returns
**every in-bucket candidate offer across all stores** (broad by default); comparison
returns **all** in-bucket candidates per store, not a single cheapest. Those shapes are
specified in §6–§8.

-----

## 2. Fixed framing (applied, not re-decided)

|Fixed by              |What it means on the wire                                                                                                       |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------|
|REST namespace `si/v1`|Every route is under `/wp-json/si/v1/…` (arch. §8)                                                                              |
|Custom `hash_hmac` JWT|We sign/verify ourselves — **no WP-JWT plugin** (D §8, arch. §7); claim set is the contract                                     |
|Access JWT ~15 min    |Short-lived, **held in memory** by the PWA, never `localStorage` (XSS containment, arch. §6.1)                                  |
|Rotating refresh token|Opaque token in an `httpOnly` `Secure` cookie; rotated every refresh (§5, 04 §4.1)                                              |
|One-domain rule       |`app.<domain>` (PWA) + `www.<domain>` (API) are *same-site*, so the refresh cookie is sent on `credentials:'include'` (arch. §4)|
|Exact-origin CORS     |`Access-Control-Allow-Origin: https://app.<domain>` — **never `*`** — with credentials (§9)                                     |

None of these is negotiable here; they are the ground the catalog stands on.

-----

## 3. Conventions for every endpoint

- **Base.** All paths below are relative to `https://www.<domain>/wp-json/si/v1`.
- **Auth requirement** is stated per endpoint as **Public**, **JWT**, or **JWT + role**.
  A **JWT** endpoint requires a valid, unexpired access token in
  `Authorization: Bearer <jwt>`. **JWT + role** additionally checks a claim
  (e.g. family `admin`) or resource ownership (§4.3).
- **Content type** is `application/json` for request and response bodies, `utf8mb4`
  throughout (Bulgarian Cyrillic — 04 §2.2). Times on the wire are **UTC ISO-8601**
  (`2026-06-11T20:00:00Z`); the client renders `Europe/Sofia` (arch. §8).
- **Money** is always the pair `{ "price_cents": <int>, "currency": "EUR" }` — integer
  euro cents, never a float (arch. §8, 04 §2.3). The client formats; the server never
  sends a formatted string.
- **IDs** are stringified `BIGINT` on the wire (JS number-precision safety). Offline-born
  entities also carry their `client_uuid` (§6.3, arch. §6.5).
- **Validity** is sent as `valid_from` / `valid_to` (UTC, `valid_to: null` = open-ended);
  the client derives “current” — there is no `is_current` flag (arch. §8, 04 §2.3).
- **Every** error response is the single envelope of §10. **Every** mutation is
  idempotent-safe on `client_uuid` where one applies (§6.3).

-----

## 4. Authorization model (who may call what)

### 4.1 The JWT carries the answer

The access JWT’s claims — `user_id`, `family_ids[]`, `roles[]` (arch. §6.1, 02 §4) — let
the API authorize **most** calls with no DB hit: a family-list read checks the list’s
`owner` against `family_ids[]` straight from the token. This is the deliberate
per-request DB-avoidance of arch. §6.1.

### 4.2 The staleness trade-off (and its shortcut)

Claims are a **snapshot**: a membership change propagates at the **next refresh** (≤15
min — arch. §6.1, 02 §4). To shorten that window, **every endpoint that changes the
caller’s `family_ids[]`** (create / join / leave) **returns a fresh access token** in its
response body (`auth.access_token`), so a user who just joined/left carries correct
`family_ids[]` immediately rather than waiting up to 15 minutes (§7.4). Endpoints that do
this are marked **↻ fresh token** below. A **per-family role change** (admin↔member, §6.6)
needs **no** fresh token: the per-family role is read from `family_members` on each request
(§4.3), so it takes effect on the caller’s next call without a refresh.

### 4.3 Ownership & role checks (the cases the JWT can’t pre-answer)

- **Personal resources** (a user-owned list, the caller’s UserProducts) — checked by
  `owner_id == user_id`.
- **Family resources** — `owner_id ∈ family_ids[]` for read; **role `admin`** (from a
  per-family role check) for member-removal, **member role changes**, family-deletion, and
  invitation management (02 §5). **Self-leave is the one member-level exception**: a member
  may `DELETE` *their own* membership (`caller == userId`) without admin role (§6.6). Because
  `roles[]` in the JWT is app-level, the *per-family* admin check reads
  `oCk_si_family_members` for that one family (cheap, single-row, 04 §4.2).
- **Not-found vs forbidden.** A resource the caller may not see returns **`404`**, not
  `403`, so the API never confirms the existence of another household’s data.

-----

## 5. JWT internals & the refresh lifecycle (flow; storage is 04’s)

### 5.1 Access JWT structure

A compact JWS, signed with **`hash_hmac('sha256', …)`** over `base64url(header) · base64url(payload)` using the `SI_JWT_SECRET` `wp-config.php` constant (arch. §9). No
external library — the verifier is a few lines in the WP-free `Auth` service (D §8,
03 §3.1).

```
header  : { "alg": "HS256", "typ": "JWT" }
payload : {
  "sub": "<user_id>",            // the identity anchor (02 §4)
  "fids": [<family_id>, …],      // family_ids[]  — projection of memberships (arch. §6.1)
  "roles": ["si_user", …],       // app-level roles
  "iat": <unix>, "exp": <iat + 900>   // ~15-minute lifetime
}
```

- **`sub`/`fids`/`roles` are the contract** (arch. §7). Renaming or dropping a claim is a
  breaking change → `v2` (§11). Adding an *optional* claim is additive.
- Verification rejects on bad signature, `exp` in the past, or `alg` mismatch (the
  `alg:none` class of attack is refused — `alg` must equal `HS256`).
- The access token is **never persisted server-side** — it is self-validating. Only the
  refresh token is stored, and only as a hash (§5.2, 04 §4.1).

### 5.2 Refresh token — rotation & reuse-detection flow

This is the **flow**; the columns (`token_hash`, `lineage_id`, `issued_at`, `expires_at`,
`rotated_at`, `revoked_at`) live in `oCk_si_refresh_tokens` (04 §4.1). Decided
persistence defaults (04 §7.6): **30-day** token lifetime; reuse-detection spans the
**lineage’s** 30-day life.

**Issue (on login / Google):**

1. Generate an opaque random token (high-entropy, e.g. 256-bit, base64url).
1. Store **SHA-256(token)** as `token_hash` with a fresh `lineage_id` (UUIDv4), `issued_at = now`, `expires_at = now + 30d`.
1. Set it in the response as the `httpOnly` `Secure` `SameSite=Lax` cookie (§5.3).
1. Return the access JWT in the body.

**Refresh (`POST /auth/refresh`):**

1. Read the cookie; hash it; look up `token_hash`.
1. **Not found** → `401 token_invalid`, clear cookie.
1. Found but `revoked_at` set, or already `rotated_at` set (a **superseded** token being
   replayed) → **theft signal**: revoke the *entire lineage* (`revoked_at = now` for all
   rows sharing `lineage_id`), `401 token_reuse_detected`, clear cookie. The user must log
   in again. This is the reuse-detection guarantee.
1. Found, live, not yet rotated → **rotate**: mark the presented row `rotated_at = now`,
   insert a new row in the *same* `lineage_id` with a new token + hash, set the new cookie,
   mint a fresh access JWT, return it. (Rotation chains within one lineage; a lineage ≈ one
   login session.)

**Logout (`POST /auth/logout`):** revoke the current lineage (`revoked_at = now` for the
lineage), clear the cookie, `204`.

**Prune** (04 §6.3): tokens past `expires_at`, and lineages whose reuse-detection window
has closed, are deleted by `bin/prune.php` — not by this flow.

### 5.3 The cookie

```
Set-Cookie: si_refresh=<opaque>; HttpOnly; Secure; SameSite=Lax;
            Path=/wp-json/si/v1/auth; Max-Age=2592000
```

- **`HttpOnly`** — JS cannot read it (XSS containment; the access token already lives only
  in memory — arch. §6.1).
- **`Secure`** — HTTPS only (Cloudflare gives TLS on both origins — arch. §4).
- **`SameSite=Lax`** works **because** of the one-domain rule (arch. §4): `app.<domain>`
  and `www.<domain>` are the same registrable site, so the cookie rides
  `fetch(..., { credentials:'include' })`. On `*.pages.dev` it would be cross-site and
  silently dropped by Safari / phased out by Chrome — the reason the one-domain rule is a
  hard prerequisite.
- **`Path`** scopes the cookie to the auth routes, so it is not attached to every API call.

-----

## 6. Endpoint catalog

Grouped by bounded context (02 §2). Each entry: **method · path · auth · request →
response · errors**. Shapes are illustrative-but-binding skeletons; fields not shown are
not silently present. The error envelope is §10; the codes column lists the *additional*
endpoint-specific codes beyond the universal `400 validation_error` /
`401 token_invalid` / `500 internal`.

### 6.1 Auth context

All auth responses that establish a session set the refresh cookie (§5.3) **and** return
the access JWT in the body — identical shape for password and Google, so **the frontend
cannot tell providers apart** (D §8, arch. §6.1).

**`POST /auth/login`** — Public — email/password.

```
→ { "email": "...", "password": "..." }
← 200  { "auth": { "access_token": "<jwt>", "expires_in": 900 },
         "user": { "id": "...", "display_name": "...", "family_ids": ["..."] } }
   + Set-Cookie: si_refresh=…
errors: 401 credentials_invalid · 429 rate_limited
```

**`POST /auth/google`** — Public — Google authorization code → verify with Google →
find-or-create the `wp_users` record (arch. §6.1) → **identical** output to `/auth/login`.

```
→ { "code": "<google_auth_code>", "redirect_uri": "https://app.<domain>/..." }
← 200  { "auth": {…}, "user": {…} }   + Set-Cookie: si_refresh=…
errors: 401 google_verification_failed · 429 rate_limited
```

**`POST /auth/refresh`** — Public (authenticated *by the cookie*, not a Bearer token) —
the silent boot call (§7.1). No request body; the `httpOnly` cookie is the credential.

```
→ (empty body; cookie carries the refresh token)
← 200  { "auth": { "access_token": "<jwt>", "expires_in": 900 } }
   + Set-Cookie: si_refresh=<rotated>
errors: 401 token_invalid · 401 token_reuse_detected (lineage revoked — §5.2)
```

**`POST /auth/logout`** — JWT — revoke the current lineage, clear cookie.

```
← 204   + Set-Cookie: si_refresh=; Max-Age=0
```

### 6.2 Shopping List context — lists & list_items

**`GET /lists`** — JWT — all lists the caller owns or can see (personal + every family in
`family_ids[]`).

```
← 200 { "lists": [ { "id":"...", "name":"...", "owner_type":"user|family",
                     "owner_id":"...", "item_count": 12, "updated_at":"…Z" }, … ] }
```

**`POST /lists`** — JWT (+ family `member` if `owner_type=family`) — create.

```
→ { "name":"Седмични", "owner_type":"family", "owner_id":"...", "client_uuid":"<uuid>" }
← 201 { "list": { "id":"...", … } }
errors: 403 not_a_member · 409 duplicate_client_uuid (idempotent replay → returns existing)
```

**`GET /lists/{id}`** — JWT (owner/member) — the list with its items. Each item carries
its resolved UserProduct summary so the list renders without N extra calls.

```
← 200 { "list": { "id":"...", "name":"...", "owner_type":"...", "updated_at":"…Z",
        "items": [
          { "id":"...", "client_uuid":"...", "user_product_id":"...",
            "term":"мляко", "category_id":"...", "brand_anchor": null,
            "quantity": 2, "unit":"piece", "is_checked": false,
            "added_by_user_id":"...", "updated_at":"…Z" }, … ] } }
errors: 404 not_found (covers forbidden — §4.3)
```

**`POST /lists/{id}/items`** — JWT (owner/member) — add a line. **References a
`user_product_id`, never a `product_id`** (D §9, 02 §6). The UserProduct may be created in
the *same* call when the term is new (the demand-first birth point — §6.3): send
`user_product` inline and the server upserts it by `(owner, normalized_term)` (04 §4.3)
before linking.

```
→ { "client_uuid":"<item-uuid>", "quantity":2, "unit":"piece",
    "user_product_id":"...",            // when the term already exists, OR
    "user_product": {                    // when it's newly typed (often offline — §6.3)
        "client_uuid":"<up-uuid>", "term":"прах Ariel" } }
← 201 { "item": { "id":"...", "user_product_id":"...", … },
        "user_product": { "id":"...", "term":"...", "category_id": null, … } }
errors: 404 list_not_found · 409 duplicate_client_uuid (→ returns existing item)
```

**`PATCH /lists/{id}/items/{itemId}`** — JWT (owner/member) — edit quantity/unit, or
toggle `is_checked`. **Checking an item also appends a `purchase_log` row** (the
recently/frequently-bought substrate — 02 §6, 04 §4.3) when `is_checked` goes false→true.

```
→ { "is_checked": true }            // or { "quantity": 3 } / { "unit":"kg" }
← 200 { "item": { … "is_checked": true, "updated_at":"…Z" } }
note: last-write-wins on server updated_at (D §9); the client shows "updated X sec ago".
errors: 404 not_found
```

**`DELETE /lists/{id}/items/{itemId}`** — JWT (owner/member) — remove the line. Does **not**
delete the UserProduct (a term outlives a list line — 04 §4.3 `RESTRICT`) and does **not**
touch `purchase_log`.

```
← 204
```

### 6.3 UserProduct context (the demand-first layer-1 surface)

**Idempotent offline birth.** A UserProduct is born the moment a term is first typed into
a list — **often offline** (arch. §6.5, D §4). It therefore carries a **`client_uuid`**
exactly like a `list_item`, and every create is idempotent on it: a replayed create
returns the existing row rather than duplicating. The server *also* dedupes on
`(owner, normalized_term)` (04 §4.3), so two offline devices that typed the same term
**merge to one row** on sync (the duplicate-key-as-merge rule — 04 §5.4); mechanics in
`07`.

**`GET /user-products`** — JWT — the caller’s (or a family’s) term list, with the
owner-level metadata sections derived from `purchase_log` (02 §6).

```
→ ?owner_type=family&owner_id=...&section=favorites|recent|frequent  (filters optional)
← 200 { "user_products": [
        { "id":"...", "term":"мляко", "normalized_term":"мляко",
          "category_id":"...", "brand_anchor": null, "is_favorite": true,
          "last_purchased_at":"…Z",        // recently-bought (02 §6)
          "purchase_count_window": 5 }, … ] }   // frequently-bought count (window per §6.3 note)
note: the "frequently bought" window/threshold is a tunable default (04 §7.5); the count
      field reflects whatever window the server is configured with — open per D §14.
```

**`POST /user-products`** — JWT (+ family member) — create a term explicitly (the inline
form under `POST …/items` is the common path; this is the standalone one).

```
→ { "client_uuid":"<uuid>", "term":"кисело мляко", "owner_type":"user", "owner_id":"..." }
← 201 { "user_product": { "id":"...", "category_id": null, … } }
errors: 409 duplicate_client_uuid / duplicate_term (→ returns existing, possibly un-archived — 04 §4.3)
```

**`GET /user-products/{id}/candidates`** — JWT (owner/member) — **the demand-first read.**
Returns the candidate `StoreOffer`s for this term’s CategoryBucket **across all stores**,
**broad by default**, each with a promo flag (D §4/§10, 02 §7 “user matching by
selection”). If the term carries a `brand_anchor`, the set is **narrowed** to that brand
across stores (02 §7, 04 §7.2). **No “is this the same product?” dialog exists** — the
client renders this list and *choosing is the match* (02 §7).

```
← 200 {
  "user_product": { "id":"...", "term":"мляко", "category_id":"...", "brand_anchor": null },
  "candidates": [
    { "store": { "id":"...", "slug":"lidl" },
      "store_product_id":"...", "name":"Прясно мляко 3.6% 1L",
      "brand_normalized":"vereya",
      "price": { "price_cents": 189, "currency":"EUR" },
      "is_promo": true, "valid_from":"…Z", "valid_to":"…Z",
      "data_quality_score": 95, "updated_at":"…Z" }, … ],
  "broad": true                          // false when narrowed by brand_anchor
}
errors: 404 not_found · 409 not_categorized (category_id is NULL → no bucket yet; see note)
```

> **`not_categorized` is not an error path for the user** — it is the empty-bucket state
> (a brand-new term the crawler hasn’t been matched into a bucket yet, 02 §7/§10). The
> client shows “matching in progress”, not a failure. Returned as `200` with an empty
> `candidates[]` + `"category_id": null` is the **preferred** shape; `409` is reserved for
> the rare case a caller explicitly demanded candidates. **(Flagged — §12, leans toward
> the `200`-empty shape.)**

**`POST /user-products/{id}/anchor`** — JWT (owner/member) — **opt-in brand narrowing**
(D §4). The user picks one candidate offer; the server copies that offer’s
`brand_normalized` into the UserProduct’s `brand_anchor` (04 §7.2). Sending `null` clears
the anchor → back to broad.

```
→ { "brand_anchor": "ariel" }          // or { "brand_anchor": null } to widen again
← 200 { "user_product": { "id":"...", "brand_anchor":"ariel" } }
```

**`PATCH /user-products/{id}`** — JWT (owner/member) — toggle `is_favorite`, edit the term,
or `is_archived` (soft-delete — 04 §4.3).

```
→ { "is_favorite": true }              // or { "is_archived": true } / { "term":"…" }
← 200 { "user_product": { … } }
```

### 6.4 Price Comparison context

**`GET /lists/{id}/comparison`** — JWT (owner/member) — **the core read path** (arch.
§6.2, 02 §12, D §10). Pure MySQL, **no external call at request time** (the whole point of
proactive crawling — D §4). For **each** list item it returns **every** in-bucket
candidate per store (broad by default — *not* a single cheapest), plus per-store basket
totals, the cheapest store, and `not_available` / `promo` flags.

```
← 200 {
  "list_id":"...",
  "stores": [ { "id":"...", "slug":"lidl" }, { "id":"...", "slug":"kaufland" }, … ],
  "items": [
    { "user_product_id":"...", "term":"мляко", "broad": true,
      "candidates_by_store": {
        "lidl":     [ { "store_product_id":"...", "name":"…",
                        "price": {"price_cents":189,"currency":"EUR"},
                        "is_promo": true } , … ],
        "kaufland": [ … ],
        "billa":    [],                          // empty → not_available at this store
        "fantastico": [ … ] },
      "store_contribution": {                    // what this item adds to each store's total
        "lidl": {"price_cents":189,"currency":"EUR","is_promo":true,"basis":"cheapest_in_category"},
        "kaufland": {"price_cents":205,"currency":"EUR","is_promo":false,"basis":"cheapest_in_category"},
        "billa": null,                           // not_available
        "fantastico": {"price_cents":199,"currency":"EUR","is_promo":false,"basis":"cheapest_in_category"} }
    },
    { "user_product_id":"...", "term":"прах Ariel", "broad": false,
      "brand_anchor":"ariel",
      "candidates_by_store": { … only ariel offers … },
      "store_contribution": { … "basis":"brand_anchored" … } }
  ],
  "store_totals": {
     "lidl":     {"price_cents":  …, "currency":"EUR", "missing_items": 0},
     "kaufland": {"price_cents":  …, "currency":"EUR", "missing_items": 1}, … },
  "cheapest_store": "lidl",
  "computed_at":"…Z"
}
```

**Contribution rule (D §10/§14).** A **brand-anchored** item contributes only its anchored
brand’s offer (or `not_available` where that store lacks it — `null`). A **broad
(category)** item contributes a *representative* in-category price per store; the
**proposed default representative is the cheapest in-category offer per store**
(`basis: "cheapest_in_category"`). That default is **recorded as the leading candidate but
flagged `confirm` in D §10/§14** — surfaced here on the wire as the explicit `basis` field
**so the rule is visible and the default is reversible without a shape change** (§12).

**Invariants** (arch. §6.2): reads **only published, current `PriceEntry`s** (04 §4.5); a
missing price is an explicit `not_available` (`null`), never a silent `0`; no request-time
crawl.

### 6.5 Catalog / promo browse

**`GET /promotions`** — Public (short edge-cacheable — arch. §4/§9) — browse current
offers, the passive discovery surface (00 §3). Cross-user, so it may carry a short
Cloudflare/transient TTL invalidated at crawl completion (arch. §9).

```
→ ?store=lidl&category=milk&page=1&per_page=40   (all optional)
← 200 { "promotions": [ { "store":{"slug":"lidl"}, "store_product_id":"...",
          "name":"…", "category":{"slug":"milk"},
          "price":{"price_cents":189,"currency":"EUR"}, "valid_to":"…Z" }, … ],
        "page":1, "per_page":40, "total": 312 }
```

**`GET /categories`** — Public — the bucket list (seeded + demand-created — 04 §6.2), for
browse/filter chips.

```
← 200 { "categories": [ { "id":"...", "slug":"milk", "name":"Мляко" }, … ] }
```

### 6.6 Family context

**`GET /families`** — JWT — the caller’s families with roles.

```
← 200 { "families": [ { "id":"...", "name":"...", "role":"admin",
                        "member_count": 3 }, … ] }
```

**`POST /families`** — JWT — create; caller becomes first `admin` (02 §5). **↻ fresh
token** (the new `family_id` must enter `family_ids[]` at once — §4.2).

```
→ { "name":"Семейство" }
← 201 { "family": { "id":"...", "name":"...", "role":"admin" },
        "auth": { "access_token":"<fresh jwt>", "expires_in":900 } }
```

**`POST /families/{id}/invitations`** — JWT + **admin** — invite by email (the only join
path in MVP — D §9, 02 §5). Mails an opaque token; only its hash is stored (04 §4.2).

```
→ { "invited_email":"...", "invited_role":"member" }
← 201 { "invitation": { "id":"...", "status":"pending", "expires_at":"…Z" } }
errors: 403 not_admin · 409 already_member
```

**`POST /invitations/{token}/accept`** — JWT — accept (idempotent, one-shot — 02 §5).
Creates the membership. **↻ fresh token** (the accepter’s `family_ids[]` must update at
once — §4.2).

```
→ (token in path; caller identified by JWT)
← 200 { "family": { "id":"...", "name":"...", "role":"member" },
        "auth": { "access_token":"<fresh jwt>", "expires_in":900 } }
errors: 410 invitation_expired · 409 already_accepted (idempotent → returns membership) · 404 invitation_not_found
```

**`DELETE /families/{id}/invitations/{invId}`** — JWT + **admin** — revoke a pending
invitation (02 §5). `← 204`.

**`PATCH /families/{id}/members/{userId}`** — JWT + **admin** — change a member’s role
between `admin` and `member` (the hand-off path — D §14 “D-2”). Demoting the **last admin**
is refused. **Not ↻ fresh token**: the per-family role is read from `family_members` on each
request (§4.2/§4.3), so the change takes effect on the target’s next call.

```
→ { "role": "admin" }                  // or { "role": "member" }
← 200 { "member": { "user_id":"...", "role":"admin" } }
errors: 403 not_admin · 409 last_admin (cannot demote the only admin) · 404 not_found
```

**`DELETE /families/{id}/members/{userId}`** — JWT + (**admin** removing anyone, **or** a
member removing **themselves** — `caller == userId`, the self-leave path — D §14 “D-2”). The
**last admin cannot leave or be removed while other members remain** (02 §5 invariant,
enforced in `FamilyService`) — promote another member first (the `PATCH` above). If the
departing member is the **only** member, the leave succeeds and the now-empty family is
**deleted** server-side. **↻ fresh token** for the *caller* (a self-leaver’s `family_ids[]`
shrinks; when an admin removes someone else, the admin’s own view also refreshes — the
removed member’s claims correct at their next refresh ≤15 min, arch. §6.1).

```
← 200 { "auth": { "access_token":"<fresh jwt>", "expires_in":900 } }
errors: 403 not_admin (a non-admin removing someone other than self) · 409 last_admin (cannot remove/leave the only admin while members remain) · 404 not_found
```

### 6.7 Health

**`GET /health`** — Public — liveness + age of last successful crawl per chain (arch. §9),
for the UptimeRobot check.

```
← 200 { "status":"ok",
        "crawls": { "lidl": {"last_success":"…Z","age_hours":18,"status":"completed"},
                    "kaufland": {…}, "billa": {…}, "fantastico": {…} } }
```

-----

## 7. Auth flows end-to-end

### 7.1 App boot (silent refresh)

1. PWA shell loads from the SW cache — instant, offline-capable (arch. §6.1; `07`).
1. The PWA fires a silent **`POST /auth/refresh`** with `credentials:'include'`; the
   same-site `httpOnly` cookie authenticates it (§5.3).
1. On `200`: hold the returned access JWT **in memory only** (never `localStorage` —
   arch. §6.1), schedule a silent re-refresh shortly before `exp` (~15 min).
1. On `401`: route to login. No token leakage to storage at any point.

### 7.2 Email/password vs Google — provider-blind output

Both `POST /auth/login` and `POST /auth/google` terminate in the **identical**
`{ auth, user } + Set-Cookie` shape (§6.1). The frontend stores the same JWT, follows the
same refresh schedule, and **cannot tell which provider authenticated** — the provider
abstraction of D §8 / arch. §6.1, on the wire.

### 7.3 Per-request authorization

Each JWT call: verify signature + `exp` (§5.1), then authorize from claims (§4.1) or, for
the per-family admin case, one `family_members` row (§4.3). No DB hit on the common path.

### 7.4 Membership freshness shortcut

Family-mutating endpoints (`POST /families`, accept-invitation, member-removal — all
marked **↻ fresh token** in §6.6) return a freshly-minted access JWT so the caller’s
`family_ids[]`/role are correct immediately, collapsing the ≤15-min snapshot lag for the
person who made the change (§4.2). Everyone *else* affected corrects at their next refresh.

-----

## 8. Request/response shape rules (binding)

- **A `list_item` always references `user_product_id`** — never `product_id`, never free
  text (D §9, 02 §6). New terms are born via the inline `user_product` on
  `POST …/items` or via `POST /user-products` (§6.2/§6.3).
- **Candidate & comparison reads are broad by default** — they return **all** in-bucket
  offers per store with `is_promo` flags, not one cheapest (D §10). Narrowing happens only
  when a `brand_anchor` is set (§6.3/§6.4).
- **`not_available` is explicit `null`**, never `0` or omission (§6.4 invariant).
- **Money is always `{price_cents, currency}`**; the server never formats money (§3).
- **Mutations are idempotent on `client_uuid`** where the entity is offline-born
  (`list_items`, `user_products`); a replayed `client_uuid` returns the existing resource,
  not a `409` failure to the user (§6.2/§6.3, arch. §6.5).

-----

## 9. CORS, rate limiting

### 9.1 CORS (arch. §4)

Because the PWA (`https://app.<domain>`) and the API (`https://www.<domain>`) are
different *origins* (same site, different subdomain), CORS is required even though the
refresh cookie is same-site.

- Preflight: the plugin answers `OPTIONS` for every `si/v1` route with
  `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: Authorization, Content-Type`, and `Access-Control-Max-Age`.
- Actual responses carry **`Access-Control-Allow-Origin: https://app.<domain>`** — an
  **exact origin, never `*`** (arch. §4) — together with
  **`Access-Control-Allow-Credentials: true`** (required for the cookie). `*` is invalid
  with credentials and is never sent.
- The allowed origin is a config constant, so a staging origin can be added without code
  change (arch. §10).

### 9.2 Rate limiting

- **Auth endpoints** (`/auth/login`, `/auth/google`, `/auth/refresh`,
  `/invitations/*/accept`) are rate-limited with **transient counters keyed by
  IP + identifier** (e.g. IP + email) — arch. §9. On exceed: **`429 rate_limited`** with a
  `Retry-After` header.
- **Mutation endpoints** get a looser per-user ceiling to blunt runaway offline-sync
  replays; idempotency on `client_uuid` (§8) means a legitimate replay storm is cheap
  anyway.
- Counters are WP transients (MySQL-backed) in Stage 1; they move behind Redis only on the
  arch. §9 / D §11 trigger — no code change at the call sites (the limiter is a service).

-----

## 10. The one error envelope (arch. §8)

**Every** non-2xx response — validation, auth, not-found, conflict, rate-limit, server —
uses one shape with a **stable machine-readable `code`**. The frontend switches on `code`,
never on `message` (which is human-facing and may change / localize).

```
{ "error": {
    "code": "credentials_invalid",      // stable, machine-readable — the contract
    "message": "Email or password is incorrect.",   // human, may localize/change
    "details": { … }                    // optional, e.g. per-field validation
  } }
```

Canonical codes (per HTTP status):

|HTTP|`code`(s)                                                                                                        |
|----|-----------------------------------------------------------------------------------------------------------------|
|400 |`validation_error` (`details` carries per-field messages)                                                        |
|401 |`token_invalid` · `token_expired` · `token_reuse_detected` · `credentials_invalid` · `google_verification_failed`|
|403 |`not_admin` · `not_a_member`                                                                                     |
|404 |`not_found` (covers forbidden-as-not-found — §4.3)                                                               |
|409 |`duplicate_client_uuid` · `duplicate_term` · `already_member` · `already_accepted` · `last_admin`                |
|410 |`invitation_expired`                                                                                             |
|429 |`rate_limited` (+ `Retry-After`)                                                                                 |
|500 |`internal`                                                                                                       |

The `code` set is part of the wire contract: adding a code is additive; removing/renaming
one is breaking → `v2` (§11).

-----

## 11. API versioning

- **Additive within `v1`.** New endpoints, new **optional** request fields, new response
  fields, and new error `code`s are additive and ship under `si/v1` without a version bump
  (arch. §8). Clients must ignore unknown response fields.
- **Breaking → `v2`.** Removing/renaming a field or `code`, changing a type, or changing
  a JWT claim name is breaking. It ships as a **parallel `si/v2` namespace** served
  alongside `v1` until the PWA migrates — the Stage-3 standalone API serves the same
  contract, so a backend swap is *not* a version event (arch. §7).
- **The two contracts that must never break silently:** the **JWT claim set** (§5.1) and
  the **response shapes** (§6). Both are guarded by this rule.

-----

## 12. Amendments to fold back into `decisions.md` (proposed)

Two wire-level resolutions this document proposes; both are **reversible without a shape
change** and are flagged rather than silently adopted:

1. **Empty-bucket read shape.** When a UserProduct’s `category_id` is still `NULL` (the
   crawler hasn’t matched it into a bucket yet — 02 §7/§10), `GET …/candidates` **prefers** returning `200` with an empty `candidates[]` and
   `"category_id": null` (rendered client-side as “matching in progress”), reserving `409 not_categorized` for an explicit-demand caller. *Proposed default: `200`-empty.* This
   touches no schema and no other doc; confirm in `decisions.md §14`.
1. **Comparison `basis` field makes the D §10/§14 contribution rule explicit on the wire.**
   The per-store contribution carries an explicit `basis`
   (`cheapest_in_category` | `brand_anchored`), so the **proposed default representative —
   cheapest in-category offer per store (still flagged `confirm` in D §10/§14)** — is
   *visible* and can be changed to another representative (e.g. median, or
   most-recently-seen) **without altering the response shape**. Recorded so the open D §10
   question is resolved *at the wire* by a field, not a hard-coded rule.

Genuinely still open and **not** invented here: the “frequently bought” window/threshold
surfaced in `GET /user-products` (a tunable default per 04 §7.5, open per D §14) and the
barcode-scanner stage placement (D §14) — both referenced, neither decided in `06`.

-----

*Last updated: June 2026 · Session 5 of 6 (Opus 4.8, High effort, Thinking OFF) · canonical
for the `si/v1` **wire contract**: endpoint catalog, custom `hash_hmac` JWT internals,
refresh-token rotation & reuse-detection flow, exact-origin CORS, auth-endpoint rate
limiting, the single error envelope, and additive-`v1` versioning. Written on the
**demand-first** foundation — `list_item → user_product_id`, broad-by-default candidate &
comparison reads with `is_promo` flags, opt-in brand anchoring, match-by-selection (no
yes/no dialog), owner-level favorite + purchase-log metadata. Persistence defers to `04`,
meaning to `02`, skeleton to `01`, canon to `decisions.md`. Table prefix **resolved**
to `oCk_si_` (`$wpdb->prefix` + `si_`, D §6/§14).*

*Amended — June 2026 · **family membership lifecycle (D §14 “D-2”)**: added
`PATCH /families/{id}/members/{userId}` (admin role change admin↔member; not ↻ fresh token)
and widened `DELETE /families/{id}/members/{userId}` to **admin-or-self** (member self-leave;
solo-member leave deletes the empty family). Both are **additive in `si/v1`** and reuse
existing codes (`not_admin`, `last_admin`, `not_found`) — no new error code, no `v2`. §4.2/§4.3
updated accordingly.*