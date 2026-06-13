# Shopping Intellect App

This frontend slice lives in `app/` and uses the fixed stack from `07-frontend.md`:
React 18, Vite, TypeScript, Tailwind, Zustand, TanStack Query, and a PWA service worker.

## Env vars

Create an `.env.local` file in `app/` with:

```bash
VITE_API_BASE_URL=https://www.example.com/wp-json/si/v1
```

For local development against the WordPress backend from slice `§1.4`, the backend must
allow the Vite dev origin through `SI_APP_ORIGIN` and matching CORS configuration so the
refresh cookie can be sent with `credentials: 'include'`.

## Run

```bash
npm install
npm run dev
```

## Test

```bash
npm test
npm run build
```

