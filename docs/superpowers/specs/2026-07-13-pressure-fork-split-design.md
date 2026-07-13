# Pressure fork split — design + plan

Date: 2026-07-13. Status: user-approved direction (reverses the 2026-07-04
multi-vertical convergence decision — user finds one-codebase-many-apps a
maintenance burden; accepts that shared fixes now get applied per-repo).

## Decisions (user, 2026-07-13)

1. **Full fork at today's HEAD** (turf `805e3f4`): new standalone PressurePro
   repo, `VITE_VERTICAL` hardwired to pressure, lawn vertical code deleted.
2. **Turf strips pressure code out** afterwards (lawn-only again, but KEEPS
   the seam architecture — deleting it would be a huge risky revert).
3. Database + edge functions stay SHARED (app discriminator already separates
   data; no DB change, no function change).
4. Git history comes along in the fork (clone, not file-copy).
5. Native: fork gets a pressurepro `capacitor.config.ts`; actual native
   project generation (`cap add`) is a later effort (unchanged from before).
6. Old `pressure-pro-quoter` repo: now doubly obsolete; retirement still a
   later cleanup.

## Sequencing constraint (CRITICAL)

The live pressure Vercel project (`pressure-pro-quoter`, domain
pressure-pro-quoter.vercel.app) builds from the TURF repo today. Stripping
pressure from turf while Vercel still points there would ship a build whose
`vertical.ts` throws "Unknown VITE_VERTICAL \"pressure\"" at boot (white
screen) on the next turf push. Therefore:

**Phase A (fork) → user repoints Vercel to the new repo + verifies → only
then Phase B (strip turf).**

## Phase A — create the PressurePro repo

- A1. `git clone` turf → `C:\Users\Jason\Desktop\pressurepro`; drop the turf
  remote; create GitHub repo `Brewerjg/pressurepro` (match turf visibility);
  set as origin.
- A2. De-lawn on `main` (single commit series):
  - Delete `src/verticals/lawn/` entirely.
  - `src/verticals/registry.ts`: only `pressure: pressureVertical`.
  - `src/vertical.ts`: default slug → `"pressure"`.
  - `vite.config.ts`: default vertical → `"pressure"`.
  - `src/verticals/html-meta.ts`: drop the lawn entry.
  - Delete lawn-only pages/components now unreachable (lawn shell was their
    only importer) + anything that imports deleted modules — found by grep +
    tsc: `src/pages/Routes.tsx`, `RouteMode.tsx`, `ApplicationCalc.tsx`,
    `ChemicalLog.tsx`, `src/components/gdd/`, `src/components/season/`,
    lawn-only weather pieces (`WorkConditionDots`, `SprayConditionsCard`,
    DayDetailSheet work-conditions section usage stays flag-gated — flags are
    false for pressure; delete only what tsc/grep proves lawn-only).
  - Delete lawn tests; keep pressure + shared tests green.
  - `.env`: `VITE_VERTICAL=pressure` (uncommitted, local).
  - `capacitor.config.ts`: appId `com.pressurepro.app`, appName PressurePro,
    navy background. Delete the turf-branded `android/` + `ios/` dirs (they
    are com.turfpro identities; regenerate later with `cap add`).
  - README note: forked from turf @805e3f4; DB + edge functions shared with
    TurfPro (repo Brewerjg/turf owns `supabase/`); keep `supabase/` copy for
    reference or delete? KEEP (functions are shared infra; either repo can
    deploy them, coordinate manually).
- A3. Gates: `npx tsc --noEmit -p tsconfig.app.json` (6-file baseline
  expected to hold — baseline files are all shared), `npx vitest run`,
  `npm run build` (defaults to pressure), local boot smoke.
- A4. Push. USER GATE: repoint the `pressure-pro-quoter` Vercel project's Git
  connection turf → `Brewerjg/pressurepro` (env vars stay; VITE_VERTICAL
  becomes harmless/redundant). Verify live site still serves PressurePro
  (title + brand token) after its first deploy from the new repo.

## Phase B — strip pressure from turf (AFTER A4 verified)

- B1. Branch `feature/strip-pressure-vertical`: delete
  `src/verticals/pressure/`; registry drops `pressure:`; html-meta drops
  pressure entry; adjust tests that assert pressure (season-flags,
  campaigns-settings-copy, html-meta, pressure/* test files deleted);
  runbook/docs stay (history).
- B2. Gates (tsc baseline, vitest, lawn build), merge to main, push (turf
  Vercel redeploys lawn — unaffected; pressure Vercel no longer watches turf).

## Phase C — bookkeeping

Update memory (strategic direction reversed; fork locations; shared-DB/fns
coordination note). Note double-maintenance protocol: fixes to shared code
(auth, quotes, plans, edge fns, supabase schema) must be applied/cherry-picked
to BOTH repos from now on.

## Out of scope

Native project generation for pressurepro; old pressure-pro-quoter repo
retirement; deleting orphaned pp-*/old-app edge functions; Stripe/Sentry
production items (unchanged, now apply per-repo).
