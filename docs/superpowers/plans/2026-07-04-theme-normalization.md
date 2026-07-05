# Theme-token Normalization (Phase 0b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename TurfPro's named color scales (`green`/`bronze`/`ink`) to color-agnostic semantic scales (`brand`/`accent`/`neutral`) and move the palette into a per-vertical `theme.css` selected at build — pixel-identical for TurfPro, so a second vertical's palette can swap.

**Architecture:** A scripted, shade-anchored rename across `src/**` + `index.css` + a hand-edited `tailwind.config.ts`; then the palette `:root` block moves from `index.css` to `src/verticals/lawn/theme.css`, injected via a `@active-theme` vite alias computed from `VITE_VERTICAL`.

**Tech Stack:** React + Vite + Tailwind CSS + vitest.

## Global Constraints

- **Pixel-identical:** NO color VALUE changes. Every HSL value stays the same; only token NAMES change and the palette relocates. The TurfPro (`lawn`) build must render identically.
- **Rename map:** `green-*`→`brand-*`, `bronze-*`→`accent-*` (folds under the existing `accent` token — `accent.DEFAULT` already equals `bronze-500`), `ink-*`→`neutral-*`, `shadow-bronze`→`shadow-accent`, `--shadow-bronze`→`--shadow-accent`.
- **Safe sweep pattern:** replace only `-<color>-<2-or-3-digit shade>` (regex `-(green|bronze|ink)-([0-9]{2,3})`). The shade anchor is what makes this safe: `shrink-0` has a 1-digit `0` (not a shade) so it can't match; `link`/`think`/`blink` have no hyphen before `ink`. This single pattern also fixes `var(--green-800)` refs (they contain `-green-800`). `shadow-bronze` (no shade) is a separate literal replacement.
- **Injection:** `src/verticals/lawn/theme.css` holds the palette `:root{}`; `vite.config.ts` aliases `@active-theme` → `src/verticals/<VITE_VERTICAL||lawn>/theme.css`; `src/main.tsx` imports `@active-theme` before `./index.css`.
- **Keep** `tp-*` component class names; **defer** the lawn-domain `--rain`/`--drought` vars (they ride along inside the moved palette but are NOT renamed — Phase 0c handles them).
- Base branch: `feature/theme-normalization` (spec already committed there). Commit trailers: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br`.

---

### Task 1: Rename the scales (source-of-truth + full sweep)

**Files:**
- Modify: `tailwind.config.ts` (color keys + boxShadow)
- Modify (scripted): `src/index.css` and every `src/**/*.{ts,tsx,css}` referencing the old tokens (~76 files)

**Interfaces:**
- Produces (used by Task 2): the renamed palette `:root` block in `src/index.css` (to be moved), and the Tailwind tokens `brand.*`, `accent.*` (incl. shades), `neutral.*`, `shadow-accent`.

- [ ] **Step 1: Record the pre-sweep `shrink-` count (corruption guard)**

Run: `grep -roE "shrink-[0-9]" src | wc -l`
Note the number N (e.g. some non-zero count). It MUST be identical after the sweep — proof `ink→neutral` didn't corrupt `shrink-`.

- [ ] **Step 2: Run the scripted rename across src (incl. index.css)**

Run (Git Bash):
```bash
find src \( -name '*.tsx' -o -name '*.ts' -o -name '*.css' \) -print0 \
  | xargs -0 sed -i -E \
      -e 's/-green-([0-9]{2,3})/-brand-\1/g' \
      -e 's/-bronze-([0-9]{2,3})/-accent-\1/g' \
      -e 's/-ink-([0-9]{2,3})/-neutral-\1/g' \
      -e 's/shadow-bronze/shadow-accent/g'
```
This renames className usages (`text-ink-500`→`text-neutral-500`, `bg-bronze-100`→`bg-accent-100`, `ring-green-500`→`ring-brand-500`, `shadow-bronze`→`shadow-accent`), the `index.css` `:root` var NAMES (`--green-900:`→`--brand-900:`, `--shadow-bronze`→`--shadow-accent`), and the `.tp-card` ref (`var(--ink-100)`→`var(--neutral-100)`).

- [ ] **Step 3: Hand-edit `tailwind.config.ts` — rename color keys + merge bronze into accent + boxShadow**

Replace the `colors: { … }` block's `green`/`bronze`/`ink`/`accent` entries and the `boxShadow` block so they read:

```ts
        brand: {
          900: "hsl(var(--brand-900))",
          800: "hsl(var(--brand-800))",
          700: "hsl(var(--brand-700))",
          600: "hsl(var(--brand-600))",
          500: "hsl(var(--brand-500))",
          100: "hsl(var(--brand-100))",
          50:  "hsl(var(--brand-50))",
        },
        neutral: {
          900: "hsl(var(--neutral-900))",
          800: "hsl(var(--neutral-800))",
          700: "hsl(var(--neutral-700))",
          500: "hsl(var(--neutral-500))",
          400: "hsl(var(--neutral-400))",
          300: "hsl(var(--neutral-300))",
          200: "hsl(var(--neutral-200))",
          100: "hsl(var(--neutral-100))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          700: "hsl(var(--accent-700))",
          600: "hsl(var(--accent-600))",
          500: "hsl(var(--accent-500))",
          400: "hsl(var(--accent-400))",
          100: "hsl(var(--accent-100))",
        },
```
(Delete the old `green`, `bronze`, and `ink` keys; keep `hairline`, `secondary`, `destructive`, `success`, `warning`, `muted`, `popover`, `card`, `primary`, `border`, `input`, `ring`, `background`, `foreground` exactly as they are.)

And the boxShadow block:
```ts
      boxShadow: {
        accent: "var(--shadow-accent)",
        card: "var(--shadow-card)",
        "card-lg": "var(--shadow-card-lg)",
      },
```

- [ ] **Step 4: Verify — no leftover old tokens, no corruption**

Run each; the first three MUST print nothing (exit 1 is fine), the fourth MUST equal N from Step 1:
```bash
grep -rnE "-(green|bronze|ink)-[0-9]{2,3}" src ; echo "leftover-scale-exit=$?"
grep -rnE "shadow-bronze|--shadow-bronze" src tailwind.config.ts ; echo "leftover-shadow-exit=$?"
grep -rnE "(^|[^a-z])(green|bronze|ink):" tailwind.config.ts ; echo "leftover-key-exit=$?"
grep -roE "shrink-[0-9]" src | wc -l   # must equal N (no shrink corruption)
grep -rnE "shr(brand|accent|neutral)|l(brand|accent|neutral)-[0-9]|thin(brand|accent|neutral)" src ; echo "corruption-exit=$?"
```
Expected: the three `grep` searches print nothing (`exit=1`); the `shrink-` count equals N; the corruption search prints nothing.

- [ ] **Step 5: Typecheck, build, test (pixel-identical guard)**

Run: `npx tsc --noEmit` (clean), then `npm run build` (succeeds), then `npm test` (full suite green).
Spot-check the emitted palette is unchanged in value:
```bash
grep -o "\-\-brand-800:[^;]*" src/index.css   # expect: --brand-800: 148 65% 20%  (same HSL as old --green-800)
```

- [ ] **Step 6: Commit**

```bash
git add src tailwind.config.ts
git commit -m "refactor(theme): rename green/bronze/ink scales to brand/accent/neutral (values unchanged)"
```

---

### Task 2: Extract the palette to a per-vertical theme + wire injection

**Files:**
- Create: `src/verticals/lawn/theme.css`
- Modify: `src/index.css` (remove the palette `:root` block)
- Modify: `vite.config.ts` (loadEnv + `@active-theme` alias)
- Modify: `src/main.tsx` (import `@active-theme`)
- Modify: `src/vite-env.d.ts` (declare the `@active-theme` module)

**Interfaces:**
- Consumes: the renamed palette from Task 1.
- Produces: `@active-theme` (build-resolved CSS import) — the mechanism a later vertical's `theme.css` plugs into.

- [ ] **Step 1: Create the lawn theme file**

Create `src/verticals/lawn/theme.css` containing the palette `:root` block that currently sits in `src/index.css` (post-Task-1, i.e. already renamed). Copy the exact `:root { … }` contents (the block spanning `--background` through `--shadow-card-lg`), as a plain `:root {}` (no `@layer`):

```css
/* Lawn (TurfPro) theme — fairway green + bronze accent. Palette only.
   Selected at build via the @active-theme alias (VITE_VERTICAL=lawn). */
:root {
  --background: 40 25% 98%;
  --foreground: 150 10% 10%;
  --card: 0 0% 100%;
  --card-foreground: 150 10% 10%;
  --popover: 0 0% 100%;
  --popover-foreground: 150 10% 10%;

  --brand-900: 148 75% 12%;
  --brand-800: 148 65% 20%;
  --brand-700: 145 55% 28%;
  --brand-600: 142 50% 38%;
  --brand-500: 138 45% 48%;
  --brand-100: 138 40% 92%;
  --brand-50:  138 35% 96%;

  --primary: 148 65% 20%;
  --primary-foreground: 32 75% 58%;

  --accent-700: 26 60% 28%;
  --accent-600: 28 65% 38%;
  --accent-500: 30 70% 48%;
  --accent-400: 32 75% 58%;
  --accent-100: 32 60% 92%;

  --accent: 30 70% 48%;
  --accent-foreground: 148 75% 12%;

  --neutral-900: 150 10% 10%;
  --neutral-800: 150 8% 18%;
  --neutral-700: 150 6% 28%;
  --neutral-500: 150 5% 46%;
  --neutral-400: 150 5% 60%;
  --neutral-300: 150 6% 78%;
  --neutral-200: 150 8% 88%;
  --neutral-100: 150 12% 94%;

  --secondary: 150 12% 94%;
  --secondary-foreground: 150 8% 18%;
  --muted: 150 12% 94%;
  --muted-foreground: 150 6% 40%;
  --hairline: 150 8% 88%;

  --destructive: 0 78% 52%;
  --destructive-foreground: 0 0% 100%;
  --destructive-bg: 0 78% 95%;
  --success: 142 55% 42%;
  --success-foreground: 0 0% 100%;
  --success-bg: 142 50% 92%;
  --warning: 32 95% 52%;
  --warning-foreground: 0 0% 100%;
  --warning-bg: 32 95% 93%;
  --info: 212 60% 50%;
  --info-bg: 212 60% 95%;

  /* Lawn-care status semantics (renamed later, Phase 0c) */
  --rain: 212 60% 50%;
  --rain-bg: 212 60% 95%;
  --drought: 36 80% 50%;
  --drought-bg: 36 85% 95%;

  --border: 150 8% 88%;
  --input: 150 8% 88%;
  --ring: 148 65% 20%;
  --radius: 1rem;

  --gradient-hero-deep: linear-gradient(160deg,
    hsl(148 75% 10%) 0%,
    hsl(145 60% 22%) 60%,
    hsl(142 50% 30%) 100%);

  --shadow-accent: 0 8px 24px -8px hsl(30 70% 45% / 0.55);
  --shadow-card: 0 1px 2px hsl(150 10% 10% / 0.04), 0 1px 3px hsl(150 10% 10% / 0.06);
  --shadow-card-lg: 0 4px 12px hsl(150 10% 10% / 0.06), 0 1px 3px hsl(150 10% 10% / 0.05);
}
```
(Confirm each value matches the post-Task-1 `src/index.css` exactly — these are copied verbatim, unchanged.)

- [ ] **Step 2: Remove the palette block from `index.css`**

Delete the FIRST `@layer base { :root { … } }` block from `src/index.css` (the palette). Keep the `@import` fonts line, the three `@tailwind` directives, the SECOND `@layer base { * { @apply border-border } … body … h1..h4 }` block, and the `@layer components { .tp-* }` block. Result: `src/index.css` no longer defines any `--*` palette vars; it only resets/uses them.

- [ ] **Step 3: Wire the `@active-theme` alias in `vite.config.ts`**

Replace `vite.config.ts` with the function form so it can read `VITE_VERTICAL`:

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  // Match src/vertical.ts: default "lawn". loadEnv reads the same VITE_VERTICAL
  // that import.meta.env exposes, so the theme CSS and the JS vertical agree.
  const vertical = loadEnv(mode, process.cwd(), "").VITE_VERTICAL || "lawn";
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@active-theme": path.resolve(__dirname, `./src/verticals/${vertical}/theme.css`),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
```

- [ ] **Step 4: Declare the module + import it in `main.tsx`**

In `src/vite-env.d.ts`, add:
```ts
declare module "@active-theme";
```

In `src/main.tsx`, add the theme import BEFORE the `index.css` import:
```ts
import { createRoot } from "react-dom/client";
import App from "./App";
import "@active-theme";
import "./index.css";
// Side-effecting native-plugin bootstrap. Configures @capacitor/keyboard
// resize behavior and registers the auth deep-link listener when the
// app is running inside a Capacitor WebView. No-ops on the web.
import "./lib/native-init";

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 5: Verify build (default lawn) is unchanged**

Run: `npx tsc --noEmit` (clean — the `@active-theme` module decl resolves the import), then `npm run build` (succeeds), then `npm test` (green).
Confirm the palette is present in the built output via the theme file, and index.css no longer defines it:
```bash
grep -c "\-\-brand-800" src/verticals/lawn/theme.css   # 1
grep -c "\-\-brand-800" src/index.css                  # 0
```
The default build (`VITE_VERTICAL` unset → "lawn") resolves `@active-theme` to the lawn theme — visually identical to before.

- [ ] **Step 6: Commit**

```bash
git add src vite.config.ts
git commit -m "refactor(theme): move palette to per-vertical theme.css via @active-theme alias"
```

---

## Notes for the implementer

- The whole point is **zero visual change** for the lawn build. If any color looks different, stop and report — you almost certainly changed a value or missed a rename.
- Do NOT rename `tp-*` class names or touch `--rain`/`--drought` values — out of scope (Phase 0c).
- The sweep's safety rests entirely on the `-<color>-<2-3 digit shade>` anchor. Do not "simplify" it to `s/ink-/neutral-/` — that corrupts `shrink-0`, `link-`, etc. The Step-4 verification (leftover greps + the `shrink-` count equality) is the proof; do not skip it.
- vitest doesn't process CSS, so tests are unaffected by the theme move; they must stay green as a regression guard on the non-CSS code the sweep touched (className strings inside `.ts`/`.tsx`).
