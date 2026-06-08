# Deploying TurfPro to Vercel

The web app (everything in `src/` + `index.html`) ships to Vercel as a static SPA. The backend (Supabase + edge functions) stays where it is — Vercel doesn't touch it. Operators hit the Vercel-hosted frontend, which calls the Supabase REST/Functions/Storage endpoints directly.

## What Vercel needs

| Setting | Value | Notes |
|---|---|---|
| Framework preset | **Vite** | auto-detected from `vite.config.ts` |
| Build command | `npm run build` | already set in [vercel.json](vercel.json) |
| Output directory | `dist` | already set in [vercel.json](vercel.json) |
| Install command | `npm install` | already set in [vercel.json](vercel.json) |
| Node version | 20.x | Vercel default; no override needed |

The [`vercel.json`](vercel.json) at the repo root handles:
- **SPA rewrites** — every path that isn't a static asset rewrites to `/index.html` so react-router takes over. Without this, hitting `/quotes/abc` directly returns a 404.
- **Cache headers** — Vite emits hash-named asset files (`/assets/index-Abc123.js`), which are immutable; we set long cache + immutable on those, and `must-revalidate` on `index.html` so deploys are picked up instantly.

## One-time setup

### 1. Push to GitHub

You already have origin/main wired. If not:

```bash
git push origin main
```

### 2. Import the repo in Vercel

1. Go to https://vercel.com/new
2. Pick "Import Git Repository" and select your `Brewerjg/turf` repo
3. Vercel will auto-detect Vite from `vite.config.ts` — leave the build settings alone (they're in `vercel.json`)
4. **Before clicking Deploy**, scroll down to **Environment Variables** and add the two below. (Don't deploy without them — the app will load but every Supabase call will fail.)

### 3. Environment variables

In Vercel → Settings → Environment Variables, add these **for all three scopes** (Production, Preview, Development):

| Name | Value | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://dkksryutecjbyuscpxdb.supabase.co` | The shared Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_yJrk3OzDV3xtEOqDcd7l5w_TfPpEexP` | The anon/publishable key — safe to ship to the browser |

Both are also in your local `.env`. They're already publishable / non-secret (the RLS in Supabase is what protects data), so it's fine that they end up bundled into the client JS.

### 4. Whitelist your Vercel domain in Supabase Auth

Supabase needs to know which URLs are allowed to receive auth callbacks (signup confirmations, password resets). Add your Vercel URLs:

1. Open https://supabase.com/dashboard/project/dkksryutecjbyuscpxdb
2. Authentication → URL Configuration → Redirect URLs
3. Add these to the allow list:
   - `https://YOUR_PROJECT.vercel.app/**` — your production URL
   - `https://*-YOUR_VERCEL_USERNAME.vercel.app/**` — wildcard for preview deploys (per-PR / per-branch)
   - Replace `YOUR_PROJECT` / `YOUR_VERCEL_USERNAME` with your actual values from Vercel after the first deploy

Without this, sign-up confirmation emails will redirect to a "redirect URL not allowed" error.

### 5. Deploy

Click Deploy in Vercel. First build takes ~2 minutes. You'll get a URL like `https://turf-abc123.vercel.app`.

## After the first deploy

### Verify the app loads

Open the Vercel URL. You should land on `/auth` (because no session). Sign in with your existing operator account; you should hit `/` (Home) cleanly.

If you see a blank page or "Supabase URL is not configured" error in the browser console: env vars didn't take. Re-check step 3.

### Test the round trip

Run through one full operator flow:
1. Open a quote → tap Send → confirm status flips to `sent`
2. Open a customer detail page → confirm Plans / Properties / Quotes sections render
3. Open Home → confirm forecast + Today's route render
4. Convert a quote to a plan → confirm new plan appears on `/plans`

If any of these break with network errors in DevTools (CORS or 401), the Supabase project's CORS allow list might need your Vercel domain added too — Authentication → URL Configuration → Site URL.

### Set up a custom domain (optional)

Vercel → Settings → Domains → add a domain you own (e.g. `app.yourdomain.com`). Vercel auto-provisions HTTPS via Let's Encrypt. Add the same domain to Supabase Auth → Redirect URLs.

## What does NOT need any Vercel-side config

- **Capacitor plugins** (`@capacitor/keyboard`, `@capacitor/app`, etc.) — they're dynamically imported with `@vite-ignore`. Running in a browser, they no-op cleanly. Native shells use these; Vercel just serves the web bundle.
- **dnd-kit** — same pattern, dynamically imported
- **Stripe** — `@stripe/stripe-js` is dynamically imported; the publishable key reads from `VITE_PAYMENTS_CLIENT_TOKEN` if you set it later
- **Supabase Edge Functions** — they live in the Supabase project and are reachable from Vercel via the publishable key. Vercel doesn't host them.
- **Database migrations** — those live in Supabase. Vercel doesn't run them.

## Preview deploys

Every push to a non-main branch creates a preview URL (`https://turf-git-BRANCH-USERNAME.vercel.app`). Each preview gets the same env vars as production by default. The wildcard pattern in step 4 covers them all.

This is the killer feature for testing — push a branch, get a unique URL, share it with someone, they hit it in their browser. No "works on my machine."

## Reverting a bad deploy

Vercel → Deployments → find the previous good deployment → click "Promote to Production". Instant rollback, no rebuild.

## What to do when the Supabase project URL changes (e.g. you stand up a new test project)

Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel → Settings → Environment Variables, then redeploy (Deployments → Redeploy on the latest one). The values are read at build time, not runtime — env var changes need a redeploy to take effect.

## A note on bundle size

The current main bundle is ~600 KB / ~170 KB gzipped. Recharts is in its own ~365 KB chunk that only downloads when Reports or the GDD pre-emergent chart actually renders. First-paint on a typical phone connection is sub-second from Vercel's CDN; cold load on truck-cab 3G is maybe 2-3 seconds.

If you want to track real-world performance, Vercel offers free Web Analytics — drop `@vercel/analytics/react` in `src/main.tsx`. Not added yet; do it after you have real users.
