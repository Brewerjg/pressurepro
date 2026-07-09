# Phase 1 slice 1f (pressure web cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the pressure vertical live on the web: new Vercel project on the turf repo, migration 0032 applied to the live DB, auth allowlisted, live verification recorded. **Zero app-code changes.**

**Architecture:** One new repo artifact (a cutover runbook). Everything else is sequenced external config with explicit gates: DB enum fix → Vercel project (user drives) → Supabase auth allowlist (user drives) → Playwright verification against the live URL. Old pressure deploy is the rollback.

**Tech Stack:** Supabase CLI (linked project `dkksryutecjbyuscpxdb` "Pressure"), Vercel dashboard, Playwright MCP browser tools.

## Global Constraints

- **Zero app-code changes.** If verification exposes a code bug, STOP and report — fixing it is a new slice decision, not a 1f drive-by.
- **DB convention:** untracked migrations apply via `supabase db query -f <file>`, NEVER `supabase db push`. `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block.
- **Rollback stance:** old pressure Vercel deploy stays untouched; migration 0032 is additive and needs no rollback; lawn (turf-jade.vercel.app) must be unaffected throughout.
- **tsc gate** (branch hygiene only, no code expected): `npx tsc --noEmit -p tsconfig.app.json` stays at the 6-file baseline; `npx vitest run` stays 93 green.
- **Commit trailer on every commit:**
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- **User-driven steps are BLOCKING gates:** Tasks 3 and 4 need dashboard actions only the user can perform. Ask, wait for confirmation + the production URL, then continue. Do not fake or skip verification.

---

### Task 1: Cutover runbook

**Files:**
- Create: `docs/runbooks/pressure-web-cutover.md`

**Interfaces:**
- Produces: the checklist executed by Tasks 2–5; Task 5 appends its verification results to this file.

- [ ] **Step 1: Create the runbook** with exactly this content:

````markdown
# Runbook — Pressure web cutover (Phase 1 slice 1f)

Cut the pressure vertical over to the unified turf codebase on the web.
Spec: `docs/superpowers/specs/2026-07-09-pressure-1f-web-cutover-design.md`.
Old deploy (from `Brewerjg/pressure-pro-quoter`) is the rollback — do not touch it.

## 1. DB gate — quote_status 'expired' (agent)

```powershell
supabase db query -f supabase/migrations/0032_pressure_quote_status_expired.sql
supabase db query "SELECT unnest(enum_range(NULL::public.quote_status)) AS status;"
```

Expected: second command lists `draft, sent, accepted, scheduled, complete, paid, expired`.
Additive + idempotent (`IF NOT EXISTS`); no rollback needed; lawn never writes 'expired'.

## 2. Vercel project (user, dashboard)

1. vercel.com → Add New → Project → Import `Brewerjg/turf`.
2. Project name: `pressurepro` (any name; the domain follows it).
3. Framework preset: Vite (auto-detected; `vercel.json` in the repo already
   sets buildCommand/outputDirectory/SPA rewrites — no overrides needed).
4. Environment variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `VITE_VERTICAL` | `pressure` |
   | `VITE_SUPABASE_URL` | copy from the turf Vercel project |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | copy from the turf Vercel project |
   | `VITE_PAYMENTS_CLIENT_TOKEN` | copy from the turf Vercel project |

   (`VITE_PUBLIC_APP_ORIGIN` / `VITE_REVENUECAT_*` are native-only — omit.)
5. Deploy `main`. Record the production URL: `____________________`

## 3. Supabase auth allowlist (user, dashboard)

supabase.com → project `dkksryutecjbyuscpxdb` ("Pressure") → Authentication →
URL Configuration → Additional Redirect URLs → add:

- `https://<pressure-production-url>/**`

Site URL stays turf's. If Google OAuth is enabled, also add the new origin to
the Google Cloud OAuth client's authorized JavaScript origins.

## 4. Live verification (agent, browser)

Against `https://<pressure-production-url>`:

- [ ] Boot + brand: navy theme, "PressurePro", 5 tabs (Home/Customers/Quotes/
      Schedule/Settings), Mix Calc home tile
- [ ] Auth: demo login works (`demo-*@pressurepro.demo`); session survives reload
- [ ] Onboarding: fresh demo account completes; surface-pricing seed (7 surfaces)
- [ ] Quotes: create with surface lines (sqft × rate, soft/power mode); detail
      renders; accept link opens
- [ ] /mix: 50 gal, 12.5% stock, house (1%) → 4 gal SH, 46 gal water, 50 oz surfactant
- [ ] Settings: SurfacePricingEditor matrix loads and saves a rate
- [ ] Plans: flat-billing plan create (no lawn cadence sections)
- [ ] Campaigns: 6 pressure templates render
- [ ] Live data: pre-existing `app='pressurepro'` rows render (1 legacy quote,
      surface_pricing rows)
- [ ] Lawn regression: turf-jade.vercel.app still lawn-branded and boots

Known gaps (flagged, NOT 1f blockers): pp_* Stripe price IDs unverified against
the live Stripe account; paid-tier checkout verified only to the Stripe boundary.

## 5. Rollback

Delete (or ignore) the new Vercel project. Old pressure deploy untouched.
DB change stays (additive, harmless).

## Results

(appended by the verification pass)
````

- [ ] **Step 2: Branch hygiene gates**

Run: `npx tsc --noEmit -p tsconfig.app.json` → same 6-file baseline (AudienceStep, campaigns/templates, BusinessProfile, iap, Campaigns, Onboarding; no NEW file).
Run: `npx vitest run` → 93 tests green.

- [ ] **Step 3: Commit**

```powershell
git add docs/runbooks/pressure-web-cutover.md
git commit -m "docs(platform): pressure web cutover runbook (1f)"
```
(with the global trailer)

---

### Task 2: Apply migration 0032 to the live DB

**Files:** none (live DB change; migration file `supabase/migrations/0032_pressure_quote_status_expired.sql` already exists from 1a).

**Interfaces:**
- Consumes: runbook §1 commands.
- Produces: live `public.quote_status` enum containing `expired` — required before any pressure user triggers quote auto-expiry.

- [ ] **Step 1: Confirm CLI is linked to the right project**

Run: `supabase projects list` (or check `supabase/.temp/project-ref`).
Expected: linked ref `dkksryutecjbyuscpxdb`. If not linked, STOP and ask the user (needs an access token; do not guess).

- [ ] **Step 2: Preview the enum before**

Run: `supabase db query "SELECT unnest(enum_range(NULL::public.quote_status)) AS status;"`
Expected: `draft, sent, accepted, scheduled, complete, paid` (no `expired`).

- [ ] **Step 3: Apply**

Run: `supabase db query -f supabase/migrations/0032_pressure_quote_status_expired.sql`
Expected: success, no error. (Statement is standalone — `ALTER TYPE ... ADD VALUE` refuses transaction blocks; if the CLI wraps it in one and errors, run the single statement inline instead: `supabase db query "ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';"`.)

- [ ] **Step 4: Verify**

Run: `supabase db query "SELECT unnest(enum_range(NULL::public.quote_status)) AS status;"`
Expected: list now ends with `expired`.

- [ ] **Step 5: No commit** (no repo change). Record before/after output for the report.

---

### Task 3: Vercel project creation (USER GATE)

**Files:** none.

**Interfaces:**
- Consumes: runbook §2 (env-var table).
- Produces: the pressure production URL consumed by Tasks 4–5.

- [ ] **Step 1: Present runbook §2 to the user** and ask them to create the project and paste back the production URL. BLOCK until answered.

- [ ] **Step 2: Smoke the URL**

Fetch `https://<url>` → expect HTTP 200 HTML with `<div id="root">` (Vite SPA shell). If the build failed on Vercel, get the build log from the user and diagnose (likely a missing env var; `VITE_VERTICAL` typo'd would boot LAWN, not fail — check brand in Task 5 step 1 catches this).

---

### Task 4: Supabase auth allowlist (USER GATE)

**Files:** none.

**Interfaces:**
- Consumes: production URL from Task 3; runbook §3.
- Produces: working magic-link/OAuth/password-reset redirects on the new domain (demo login in Task 5 does not need it, but real auth does).

- [ ] **Step 1: Present runbook §3 to the user** (with the actual URL substituted) and ask for confirmation it's added. BLOCK until answered.

---

### Task 5: Live verification + record results

**Files:**
- Modify: `docs/runbooks/pressure-web-cutover.md` (append Results section)

**Interfaces:**
- Consumes: production URL (Task 3); runbook §4 checklist.
- Produces: recorded verification transcript; the 1f completion evidence.

- [ ] **Step 1: Run the runbook §4 checklist via Playwright** (browser_navigate + snapshots), in order. For each item record PASS/FAIL + one-line evidence (e.g. computed `--brand-800` value, created quote id). Use a THROWAWAY demo account for auth/onboarding/quote/plan items. Do not touch the 1 legacy live quote beyond viewing it.

- [ ] **Step 2: Lawn regression check**

Navigate `https://turf-jade.vercel.app` → lawn branding (TurfPro, cream theme) still renders; login page boots.

- [ ] **Step 3: On any FAIL:** stop, report the failure with evidence, and do NOT record a green cutover. (Global constraint: no drive-by code fixes.)

- [ ] **Step 4: Append results to the runbook** under `## Results` — date, URL, checklist with PASS/FAIL + evidence lines, and the two flagged known gaps.

- [ ] **Step 5: Gates + commit**

Run: `npx vitest run` → 93 green (unchanged).

```powershell
git add docs/runbooks/pressure-web-cutover.md
git commit -m "docs(platform): record 1f pressure cutover verification results"
```
(with the global trailer)

---

## Self-Review notes (author)

- **Spec coverage:** runbook (Task A→1), DB gate (B→2), Vercel (C→3), auth allowlist (D→4), verification+results (E→5), rollback stated in runbook §5. Out-of-scope list honored (no native, no repo retirement, no Stripe reconciliation).
- **No placeholders:** runbook content is verbatim in Task 1; commands exact; the only blanks are the production URL (unknowable until Task 3) — explicitly a user gate.
- **Type consistency:** n/a (no code). Command consistency checked: `db query -f` everywhere, never `db push`.
- **Failure paths:** unlinked CLI (2.1 STOP), Vercel build fail (3.2 diagnose), wrong-vertical boot (caught by brand check 5.1), any verification FAIL (5.3 stop-and-report).
