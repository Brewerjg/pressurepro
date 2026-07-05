# Phase 0b — theme-token normalization (design)

Status: approved design, ready for implementation planning.
Date: 2026-07-04.

## Context

Part of the multi-vertical platform (spec:
`2026-07-04-multi-vertical-platform-design.md`; Phase 0a seam already merged).
TurfPro's UI references **named color scales** — `green` (primary brand),
`bronze` (accent), `ink` (neutral/foreground) — in ~2,173 className spots across
76 files (green 517, bronze 367, ink 1289). Because the class names encode the
lawn palette, a second vertical (pressure washing, navy/yellow) can't swap the
look. Phase 0b makes the palette swappable by renaming the scales to
color-agnostic **semantic** names and moving the palette values into a
per-vertical theme file selected at build time. **No value changes** — TurfPro
must render pixel-identical.

### Current theme structure (turf repo)
- Palette scales (rename targets): `--green-{900,800,700,600,500,100,50}`,
  `--bronze-{700,600,500,400,100}`, `--ink-{900,800,700,500,400,300,200,100}`,
  exposed in `tailwind.config.ts` as `green.*` / `bronze.*` / `ink.*`.
- Already-semantic, vertical-neutral tokens (KEEP as-is): `--primary`/-foreground,
  `--accent`/-foreground, `--secondary`, `--muted`/-foreground, `--card`,
  `--background`, `--foreground`, `--border`, `--input`, `--ring`, `--hairline`,
  `--destructive(+bg)`, `--success(+bg)`, `--warning(+bg)`, `--info(+bg)`.
  (`--accent` already equals the `bronze-500` value; `--primary`/`--ring` are
  literal HSLs equal to `green-800` — independent literals, unaffected by the rename.)
- Gradients/shadows: `--gradient-hero-deep`, `--shadow-bronze`, `--shadow-card(-lg)`
  (Tailwind: `bg-gradient-hero-deep`, `shadow-bronze`, `shadow-card`).
- Component classes: `.tp-card`, `.tp-num`, `.tp-display`, `.tp-mono` — reference
  semantic/renamed tokens; their NAMES are kept (renaming them doesn't aid theming).
- Lawn-domain vars: `--rain(+bg)`, `--drought(+bg)` — weather semantics; DEFERRED
  to Phase 0c, not touched here.

## Decisions

1. **Rename map** (values unchanged):
   - `green-*` → `brand-*`
   - `bronze-*` → `accent-*` (folds under the existing `accent` token —
     `accent.DEFAULT` already equals `bronze-500`, so `accent-500` === `accent`)
   - `ink-*` → `neutral-*`
   - `shadow-bronze` → `shadow-accent`; `--shadow-bronze` → `--shadow-accent`
   Applied in `index.css` (var names + gradient refs), `tailwind.config.ts`
   (color keys `green→brand`, `bronze` merged into `accent`, `ink→neutral`;
   `boxShadow.bronze→accent`), and every className across the ~76 files.
2. **Palette lives in a per-vertical `theme.css`, selected at build.** Split
   `src/index.css`: the base layer (`@layer base` element resets) and the
   `@layer components` (`.tp-*` classes) stay; the palette `:root { … }` block
   (all `--brand-*`/`--accent-*`/`--neutral-*` + the semantic tokens + gradients
   + shadows) moves to `src/verticals/lawn/theme.css`.
3. **Injection = a `vite.config` alias `@active-theme`** resolved from
   `VITE_VERTICAL` (default `lawn`) to `src/verticals/<slug>/theme.css`;
   `src/main.tsx` imports `@active-theme` before `index.css`. Build-time,
   FOUC-free; the palette ships with the vertical, so Phase 1's pressure vertical
   just adds its own `theme.css`.
4. **`tp-*` class names kept**; `--rain`/`--drought` deferred to 0c (YAGNI).

## Architecture / mechanics

- `src/verticals/lawn/theme.css` — a `:root { … }` block with the full palette
  (renamed vars), gradients, shadows. This is the lawn theme.
- `src/index.css` — keeps `@tailwind` directives, `@layer base` (element resets,
  `border-border`, `bg-background text-foreground`), and `@layer components`
  (`.tp-*`). No palette `:root` block (it moved).
- `vite.config.ts` — read the active vertical with Vite's `loadEnv` so it matches
  what `import.meta.env.VITE_VERTICAL` resolves in `src/vertical.ts`:
  ```ts
  const vertical = loadEnv(mode, process.cwd(), "").VITE_VERTICAL || "lawn";
  // resolve.alias:
  "@active-theme": path.resolve(__dirname, `./src/verticals/${vertical}/theme.css`),
  ```
- `src/main.tsx` — `import "@active-theme";` immediately before `import "./index.css";`
  (theme defines the `:root` vars that index.css's base layer consumes).

## The one real hazard: the `ink-` sweep

`ink-` is a substring of `shrink-`, `link-`, `think-`, `blink-`, `drink-`,
`sink-`, `pink-`, `wink-` — several present in this codebase (`shrink-0` is
common). A blind `s/ink-/neutral-/` would corrupt them. The rename MUST be
**boundary-anchored to the Tailwind utility grammar** — only replace `ink-`
(and `green-`/`bronze-`) when it is a color token: immediately preceded by a
utility prefix (`text-|bg-|border-|ring-|from-|via-|to-|divide-|placeholder-|
outline-|decoration-|fill-|stroke-|shadow-|ring-offset-|caret-|accent-`) OR a
class-list boundary (start, whitespace, `"`, `'`, `` ` ``, `:`, `[`, `(`).
After the sweep, VERIFY: (a) `grep -rE "shr(ink|neutral)|thin(k|neutral)|l(ink|neutral)"`
shows only legitimate words (no corruption), and (b) zero remaining
`green-`/`bronze-`/`ink-` color tokens in `src`. `green`/`bronze` have no
substring collisions but use the same anchored patterns for consistency.

## Testing

- **Build parity:** `npm run build` (default `lawn`) succeeds; the emitted CSS
  contains the same computed color values as before (spot-check a few, e.g. the
  old `--green-800: 148 65% 20%` now appears as `--brand-800: 148 65% 20%`).
- **No corruption:** the two verification greps above are clean; `npx tsc --noEmit`
  passes (className strings are opaque to TS, but the build catches broken CSS).
- **Vitest** unchanged (no color logic under test); full suite stays green.
- Manual spot check: the app looks identical (same greens/bronzes/grays).

## Out of scope

- Any color VALUE change (pixel-identical is the guard).
- Renaming `tp-*` component classes.
- The lawn-domain `--rain`/`--drought` vars (Phase 0c).
- Adding the pressure `theme.css` / any second vertical (Phase 1).
- Widening the TS `Vertical.theme` contract — the palette is the CSS file;
  `brand.themeColor` (already in the contract) remains the native status-bar hex.
