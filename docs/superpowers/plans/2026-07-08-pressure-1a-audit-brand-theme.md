# Phase 1 slice 1a (audit + brand + theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the pressure vertical's theme (`src/verticals/pressure/theme.css`) with a var-name parity test, and author the `quote_status 'expired'` migration file — the first concrete artifacts of Phase 1. (The audit itself is already committed as the slice spec.)

**Architecture:** `pressure/theme.css` mirrors `lawn/theme.css` — the SAME 50 CSS custom-property names, with PressurePro's navy + safety-yellow palette. It is loaded only by a `VITE_VERTICAL=pressure` build via the existing `@active-theme` vite alias; nothing imports it yet, so this slice cannot change lawn behavior. The migration is authored as a file only (applied in slice 1f).

**Tech Stack:** CSS custom properties, vitest (node fs to read the CSS files), Supabase SQL migration.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root `tsc --noEmit`). Pre-existing baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = that error set stays EXACTLY these 6; no NEW file appears.
- **Behavior-identical for lawn:** nothing in this slice is imported by the lawn build. Do not touch `lawn/theme.css`, the vite config, `main.tsx`, or any shared file.
- **Theme values are authoritative in the spec** `docs/superpowers/specs/2026-07-08-pressure-1a-audit-brand-theme-design.md` (section B) — transcribe them verbatim.
- **Migration convention:** untracked-migration repo — the file is authored but NOT applied here (`supabase db query`, never `db push`, and only in 1f).
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite stays green; `npm run build` succeeds.

---

### Task 1: pressure theme + var-name parity test

**Files:**
- Create: `src/verticals/pressure/theme.css`
- Test: `src/verticals/pressure/theme.test.ts`

**Interfaces:**
- Produces: `src/verticals/pressure/theme.css` — a `:root { … }` block defining the same 50 custom-property names as `src/verticals/lawn/theme.css`, consumed later (slice 1e) via the `@active-theme` alias. No JS/TS exports.

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Extract the set of declared CSS custom-property names (e.g. "--brand-900"). */
function customProps(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

const lawnCss = readFileSync(resolve(here, "../lawn/theme.css"), "utf8");
const pressureCss = readFileSync(resolve(here, "theme.css"), "utf8");

describe("pressure theme", () => {
  it("defines exactly the same custom-property names as the lawn theme", () => {
    const lawn = customProps(lawnCss);
    const pressure = customProps(pressureCss);
    const missing = [...lawn].filter((v) => !pressure.has(v));
    const extra = [...pressure].filter((v) => !lawn.has(v));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("defines the lawn-status vars so shared status pills never render undefined", () => {
    const pressure = customProps(pressureCss);
    for (const v of ["--rain", "--rain-bg", "--drought", "--drought-bg"]) {
      expect(pressure.has(v)).toBe(true);
    }
  });

  it("uses the pressure palette, not lawn values (navy brand + yellow accent)", () => {
    expect(pressureCss).toContain("--brand-900: 220 65% 12%;");
    expect(pressureCss).toContain("--accent-500: 48 100% 55%;");
    expect(pressureCss).toContain("--ring: 220 65% 18%;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/verticals/pressure/theme.test.ts`
Expected: FAIL — `theme.css` does not exist (readFileSync throws / suite errors).

- [ ] **Step 3: Create `src/verticals/pressure/theme.css`**

Transcribe verbatim from the slice spec, section B (the complete `:root { … }` block). The exact file content:

```css
/* Pressure (PressurePro) theme — navy + safety-yellow. Palette only.
   Selected at build via the @active-theme alias (VITE_VERTICAL=pressure). */
:root {
  --background: 218 35% 97%;
  --foreground: 220 45% 12%;
  --card: 0 0% 100%;
  --card-foreground: 220 45% 12%;
  --popover: 0 0% 100%;
  --popover-foreground: 220 45% 12%;

  --brand-900: 220 65% 12%;
  --brand-800: 220 65% 18%;
  --brand-700: 218 55% 24%;
  --brand-600: 215 55% 32%;
  --brand-500: 213 45% 44%;
  --brand-100: 220 30% 88%;
  --brand-50:  220 33% 96%;

  --primary: 220 65% 18%;
  --primary-foreground: 48 100% 55%;

  --accent-700: 40 100% 38%;
  --accent-600: 42 100% 48%;
  --accent-500: 48 100% 55%;
  --accent-400: 50 100% 65%;
  --accent-100: 48 100% 92%;

  --accent: 48 100% 55%;
  --accent-foreground: 220 65% 12%;

  --neutral-900: 220 45% 12%;
  --neutral-800: 220 30% 20%;
  --neutral-700: 220 20% 30%;
  --neutral-500: 220 15% 46%;
  --neutral-400: 220 14% 60%;
  --neutral-300: 220 16% 78%;
  --neutral-200: 220 20% 88%;
  --neutral-100: 220 24% 94%;

  --secondary: 220 24% 94%;
  --secondary-foreground: 220 30% 20%;
  --muted: 220 20% 94%;
  --muted-foreground: 220 15% 42%;
  --hairline: 220 20% 92%;

  --destructive: 0 78% 52%;
  --destructive-foreground: 0 0% 100%;
  --destructive-bg: 0 78% 95%;
  --success: 152 60% 38%;
  --success-foreground: 0 0% 100%;
  --success-bg: 152 55% 92%;
  --warning: 32 95% 52%;
  --warning-foreground: 0 0% 100%;
  --warning-bg: 32 95% 93%;
  --info: 210 80% 48%;
  --info-bg: 210 80% 95%;

  /* Status semantics — defined so shared status pills never render undefined.
     Repurposed for pressure (wet/surface) but kept at generic values. */
  --rain: 210 80% 50%;
  --rain-bg: 210 80% 95%;
  --drought: 36 80% 50%;
  --drought-bg: 36 85% 95%;

  --border: 220 20% 88%;
  --input: 220 20% 88%;
  --ring: 220 65% 18%;
  --radius: 1rem;

  --gradient-hero-deep: linear-gradient(160deg,
    hsl(220 70% 10%) 0%,
    hsl(215 60% 22%) 60%,
    hsl(213 50% 30%) 100%);

  --shadow-accent: 0 8px 24px -8px hsl(48 100% 50% / 0.55);
  --shadow-card: 0 1px 2px hsl(220 45% 12% / 0.04), 0 1px 3px hsl(220 45% 12% / 0.06);
  --shadow-card-lg: 0 4px 12px hsl(220 45% 12% / 0.06), 0 1px 3px hsl(220 45% 12% / 0.05);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/verticals/pressure/theme.test.ts`
Expected: PASS (all 3 cases). If the parity test reports `missing`/`extra`, fix `theme.css` to match lawn's var-name set EXACTLY (same names; values differ).

- [ ] **Step 5: Verify tsc gate + full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (the known 6 baseline files only; no new file).

Run: `npx vitest run`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/verticals/pressure/theme.css src/verticals/pressure/theme.test.ts
git commit
```
(Message like `feat(platform): pressure theme.css (navy + yellow, 50-var parity)` + trailers.)

---

### Task 2: quote_status 'expired' migration file

**Files:**
- Create: `supabase/migrations/0032_pressure_quote_status_expired.sql`

**Interfaces:**
- Produces: a tracked migration file (NOT applied in this slice). Consumed by slice 1f, which applies it to the live DB before the deploy flip.

- [ ] **Step 1: Confirm the next migration number**

Run: `ls supabase/migrations/ | grep -E "^[0-9]{4}_" | sort | tail -1`
Expected: `0031_quotes_qbo_sync.sql`. If the highest is not `0031`, use the next integer after whatever it is (adjust the filename accordingly). Otherwise proceed with `0032`.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/0032_pressure_quote_status_expired.sql`:

```sql
-- Phase 1 (pressure vertical cutover): add 'expired' to quote_status.
--
-- The live quote_status enum on the shared DB is
--   {draft, sent, accepted, scheduled, complete, paid}
-- but the pressure app writes quotes.status = 'expired' when auto-expiring stale
-- quotes (Quotes.tsx / QuoteDetail.tsx). Those writes currently fail on the live
-- enum. Adding the value is additive and backward-compatible (no existing row or
-- query changes). Lawn does not write 'expired'; it is harmless there.
--
-- UNTRACKED-MIGRATION CONVENTION: apply with `supabase db query -f`, never
-- `db push`. Applied in slice 1f (pre-cutover gate), not when this file lands.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so run it as a
-- standalone statement.

ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'expired';
```

- [ ] **Step 3: Sanity-check the SQL (no application)**

Run: `cat supabase/migrations/0032_pressure_quote_status_expired.sql`
Expected: the file contains exactly the header comment + the single `ALTER TYPE … ADD VALUE IF NOT EXISTS 'expired';` statement. Do NOT run it against any database in this slice.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0032_pressure_quote_status_expired.sql
git commit
```
(Message like `feat(db): migration to add quote_status 'expired' (pressure, applied in 1f)` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** deliverable B (theme.css + parity test) → Task 1; deliverable C (expired migration) → Task 2. Deliverable A (audit report) already committed as the spec; deliverable D (brand values) is recorded in the spec for 1e, no code in 1a — correctly out of scope here.
- **No placeholders:** theme.css content is complete and verbatim from the spec; the test is complete; the migration is a single exact statement.
- **Type consistency:** the test reads files at runtime (no imports of the theme), so it adds no app type surface; tsc baseline holds. The `customProps` regex matches `--name:` declarations in both files identically.
- **Lawn safety:** no lawn/shared file is touched; the pressure theme is unreferenced until 1e.
