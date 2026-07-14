# PressurePro

Pressure & soft-wash quoting, scheduling, and billing — the standalone
PressurePro app.

**Forked from [Brewerjg/turf](https://github.com/Brewerjg/turf) at `805e3f4`
(2026-07-13)**, with the lawn vertical removed and pressure hardwired as the
only vertical. Full git history retained.

## Shared infrastructure — coordinate with the turf repo

- **Database:** the same live Supabase project (`dkksryutecjbyuscpxdb`) serves
  both this app and TurfPro. Rows are discriminated by the `app` column
  (`pressurepro` here). Never apply migrations with `supabase db push` — use
  `supabase db query -f <file> --linked` (see `docs/runbooks/`).
- **Edge functions:** `supabase/functions/` are shared runtime infra with the
  turf repo. Either repo can deploy them
  (`npx supabase@latest functions deploy <name> --project-ref dkksryutecjbyuscpxdb`)
  — coordinate so the deployed code matches whichever repo changed last.
- **Fixes to shared core** (auth, quotes, plans, invoices, payments, comms):
  after the 2026-07-13 split these must be applied to BOTH repos.

## Development

```powershell
npm install
npm run dev      # boots PressurePro (VITE_VERTICAL defaults to "pressure")
npx vitest run
npm run build
```

Deploys: Vercel project `pressure-pro-quoter`
(https://pressure-pro-quoter.vercel.app) builds `main`.

Native (`com.pressurepro.app`): not generated yet — `npx cap add android` /
`npx cap add ios` when the native effort starts (`capacitor.config.ts` is
already PressurePro-branded).
