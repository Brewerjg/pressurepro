# Phase 1 slice 1b (pressure quote-line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `src/verticals/pressure/quote-line.tsx` (`pressureQuoteLine: QuoteLineModule`) — PressurePro's `SurfaceLine` model + surface-grid editor — expressed through the existing contract, mirroring `src/verticals/lawn/quote-line.tsx`.

**Architecture:** One new module file + its test. No contract change; nothing is registered (register-last, 1e). The shared `QuoteForm` already renders `vertical.quoteLine.LineEditor` (`QuoteForm.tsx:225`), so pressure's editor plugs in automatically once `pressureVertical` is registered in 1e. The editor uses the shared `tp-*` theme classes + `Section`/`Field`, so it themes under the active vertical.

**Tech Stack:** React + TypeScript, vitest.

## Global Constraints

- **tsc gate:** `npx tsc --noEmit -p tsconfig.app.json` (NOT root `tsc --noEmit`). Baseline = exactly 6 files: `AudienceStep.tsx`, `campaigns/templates.ts`, `BusinessProfile.tsx`, `iap.ts`, `Campaigns.tsx`, `Onboarding.tsx`. Gate = no NEW file in the error set.
- **Mirror the lawn module** `src/verticals/lawn/quote-line.tsx` for structure/idiom (private line interface + boundary casts, `Section`/`Field`, `crypto.randomUUID()`).
- **Behavior-identical for lawn:** touch only the two new pressure files. Do NOT modify `QuoteForm.tsx`, the contract, lawn files, or anything shared.
- **Use shared classes only** (`tp-input`, `bg-neutral-100`, `bg-card`, `text-brand-700`, `text-neutral-500`, `border-neutral-200`, etc.) — NO PressurePro `pp-*` classes and NO `shadow-soft`.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QrF17kQNQsTPBTHee6C3br
  ```
- Full vitest suite green; `npm run build` succeeds.

---

### Task 1: pressure quote-line module + tests

**Files:**
- Create: `src/verticals/pressure/quote-line.tsx`
- Test: `src/verticals/pressure/quote-line.test.ts`

**Interfaces:**
- Consumes: `QuoteLine`, `CatalogItem`, `LineDescription`, `LineEditorProps`, `QuoteLineModule` from `@/verticals/quote-line`; `Section`, `Field` from `@/components/quotes/FormSection`.
- Produces: `export const pressureQuoteLine: QuoteLineModule` (consumed by 1e when assembling `pressureVertical`).

- [ ] **Step 1: Write the failing test**

Create `src/verticals/pressure/quote-line.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pressureQuoteLine } from "./quote-line";
import type { CatalogItem } from "@/verticals/quote-line";

const { blankLine, catalogToLine, lineTotal, parseLines, describe: describeLine } =
  pressureQuoteLine;

describe("pressureQuoteLine", () => {
  it("satisfies the module contract", () => {
    for (const k of ["blankLine", "catalogToLine", "lineTotal", "parseLines", "describe", "LineEditor"] as const) {
      expect(pressureQuoteLine[k]).toBeDefined();
    }
  });

  it("lineTotal = sqft * rate, rounded to 2 dp", () => {
    expect(lineTotal({ id: "l", surface: "concrete", sqft: 333, rate: 0.187, mode: "power", total: 0 })).toBe(62.27);
    expect(lineTotal({ id: "c", surface: "concrete", sqft: 1, rate: 150, mode: "power", custom: true, total: 0 })).toBe(150);
  });

  it("blankLine is a custom flat line", () => {
    const l = blankLine();
    expect(l).toMatchObject({ sqft: 1, rate: 0, custom: true });
    expect(typeof l.id).toBe("string");
  });

  it("catalogToLine builds a surface line from a surface catalog item", () => {
    const item: CatalogItem = { id: "cat1", name: "Roof", default_rate: 0.4, surface_type: "roof", mode: "soft" };
    const l = catalogToLine(item) as Record<string, unknown>;
    expect(l).toMatchObject({ surface: "roof", mode: "soft", rate: 0.4, sqft: 1500, custom: false });
    expect(l.total).toBe(600);
  });

  it("catalogToLine builds a custom flat line when the item has no surface_type", () => {
    const item: CatalogItem = { id: "cat2", name: "Gutter cleaning", default_rate: 120 };
    const l = catalogToLine(item) as Record<string, unknown>;
    expect(l).toMatchObject({ custom: true, rate: 120, sqft: 1, label: "Gutter cleaning" });
    expect(l.total).toBe(120);
  });

  it("parseLines round-trips surface + custom rows and drops junk", () => {
    const raw = [
      { id: "a", surface: "house", sqft: 1500, rate: 0.25, mode: "soft" },
      { id: "b", custom: true, sqft: 1, rate: 200, label: "Deck seal", surface: "deck" },
      null,
      "nope",
      { id: "c", surface: "bogus", sqft: 10, rate: 2 }, // invalid surface -> custom
    ];
    const out = parseLines(raw) as Record<string, unknown>[];
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "a", surface: "house", sqft: 1500, rate: 0.25, mode: "soft", total: 375 });
    expect(out[1]).toMatchObject({ id: "b", custom: true, rate: 200, label: "Deck seal" });
    expect(out[2]).toMatchObject({ custom: true });
  });

  it("parseLines synthesizes id/total and coerces string numbers", () => {
    const out = parseLines([{ surface: "concrete", sqft: "600", rate: "0.2", mode: "power" }]) as Record<string, unknown>[];
    expect(typeof out[0].id).toBe("string");
    expect(out[0].total).toBe(120);
  });

  it("describe formats a surface line for the shared display", () => {
    const d = describeLine({ id: "a", surface: "roof", sqft: 1500, rate: 0.4, mode: "soft", total: 600 });
    expect(d).toEqual({
      label: "Roof",
      detail: "1,500 sqft × $0.40 · soft",
      qty: "1,500 sqft",
      rate: "$0.40",
      amount: 600,
    });
  });

  it("describe formats a custom line", () => {
    const d = describeLine({ id: "c", surface: "concrete", sqft: 1, rate: 175, mode: "power", custom: true, label: "Gutter cleaning", total: 175 });
    expect(d).toEqual({ label: "Gutter cleaning", detail: null, qty: "1", rate: "—", amount: 175 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/verticals/pressure/quote-line.test.ts`
Expected: FAIL — `./quote-line` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/verticals/pressure/quote-line.tsx`:

```tsx
import { Plus, Trash2, Droplets, Zap } from "lucide-react";
import type {
  QuoteLine,
  CatalogItem,
  LineDescription,
  LineEditorProps,
  QuoteLineModule,
} from "@/verticals/quote-line";
import { Section, Field } from "@/components/quotes/FormSection";

// The concrete pressure line. The shared QuoteLine is opaque; this module is the
// one place that knows the pressure shape, so it casts at its boundary.
type SurfaceKey = "concrete" | "siding" | "roof" | "deck" | "fence" | "driveway" | "house";
type JobMode = "soft" | "power";

interface PressureSurfaceLine extends QuoteLine {
  surface: SurfaceKey;
  sqft: number;
  rate: number; // $/sqft, or flat $ when custom (sqft = 1)
  mode: JobMode;
  label?: string;
  custom?: boolean;
}

// Surface metadata — relocated verbatim from PressurePro store.ts SURFACE_META.
const SURFACE_META: Record<SurfaceKey, { label: string; emoji: string; recommended: JobMode }> = {
  house: { label: "House Wash", emoji: "🏠", recommended: "soft" },
  siding: { label: "Siding", emoji: "🧱", recommended: "soft" },
  roof: { label: "Roof", emoji: "🛖", recommended: "soft" },
  driveway: { label: "Driveway", emoji: "🛣️", recommended: "power" },
  concrete: { label: "Concrete", emoji: "🧊", recommended: "power" },
  deck: { label: "Deck", emoji: "🪵", recommended: "soft" },
  fence: { label: "Fence", emoji: "🚧", recommended: "soft" },
};

// Add-time default area by surface (from PressurePro NewQuote.addSurface).
const DEFAULT_SQFT: Record<SurfaceKey, number> = {
  house: 1500, siding: 1500, roof: 1500, driveway: 600, concrete: 600, deck: 300, fence: 300,
};

function isSurfaceKey(s: unknown): s is SurfaceKey {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(SURFACE_META, s);
}

function pressureLineTotal(l: { sqft: number; rate: number }): number {
  return Math.round((l.sqft ?? 0) * (l.rate ?? 0) * 100) / 100;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pressureBlankLine(): QuoteLine {
  return {
    id: crypto.randomUUID(),
    surface: "concrete",
    sqft: 1,
    rate: 0,
    mode: "power",
    label: "Custom item",
    custom: true,
    total: 0,
  } as PressureSurfaceLine;
}

function pressureCatalogToLine(item: CatalogItem): QuoteLine {
  const rate = Number(item.default_rate ?? 0);
  if (isSurfaceKey(item.surface_type)) {
    const surface = item.surface_type;
    const mode: JobMode =
      item.mode === "soft" || item.mode === "power" ? item.mode : SURFACE_META[surface].recommended;
    const sqft = DEFAULT_SQFT[surface];
    return {
      id: crypto.randomUUID(),
      surface,
      sqft,
      rate,
      mode,
      custom: false,
      total: pressureLineTotal({ sqft, rate }),
    } as PressureSurfaceLine;
  }
  return {
    id: crypto.randomUUID(),
    surface: "concrete",
    sqft: 1,
    rate,
    mode: "power",
    label: item.name,
    custom: true,
    total: rate,
  } as PressureSurfaceLine;
}

function pressureParseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any): QuoteLine | null => {
      if (!r || typeof r !== "object") return null;
      const validSurface = isSurfaceKey(r.surface);
      const custom = r.custom === true || !validSurface;
      const surface: SurfaceKey = validSurface ? r.surface : "concrete";
      const sqft = Number(r.sqft) || (custom ? 1 : 0);
      const rate = Number(r.rate) || 0;
      const mode: JobMode = r.mode === "power" ? "power" : "soft";
      const line: PressureSurfaceLine = {
        id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
        surface,
        sqft,
        rate,
        mode,
        custom,
        total: typeof r.total === "number" ? r.total : pressureLineTotal({ sqft, rate }),
      };
      if (typeof r.label === "string" && r.label) line.label = r.label;
      return line;
    })
    .filter((l): l is QuoteLine => l !== null);
}

function pressureDescribe(line: QuoteLine): LineDescription {
  const l = line as PressureSurfaceLine;
  if (l.custom) {
    return { label: l.label || "Custom item", detail: null, qty: "1", rate: "—", amount: l.total };
  }
  const meta = SURFACE_META[l.surface];
  const sqftStr = l.sqft.toLocaleString();
  return {
    label: meta ? meta.label : "Service",
    detail: `${sqftStr} sqft × ${fmtMoney(l.rate)} · ${l.mode}`,
    qty: `${sqftStr} sqft`,
    rate: fmtMoney(l.rate),
    amount: l.total,
  };
}

// Soft/power segmented control — ported from PressurePro's ModeToggle, using
// shared theme classes only.
function ModeToggle({ value, onChange }: { value: JobMode; onChange: (m: JobMode) => void }) {
  const isSoft = value === "soft";
  const btn = (active: boolean) =>
    `relative z-10 flex items-center justify-center gap-1 flex-1 px-2 py-1.5 font-semibold rounded-full text-[12px] ${
      active ? "text-brand-800" : "text-neutral-500"
    }`;
  return (
    <div className="relative inline-flex items-center rounded-full bg-neutral-100 p-1 w-full select-none">
      <span
        aria-hidden
        className={`absolute top-1 bottom-1 w-1/2 rounded-full bg-card shadow-card transition-transform duration-200 ${
          isSoft ? "translate-x-0" : "translate-x-full"
        }`}
      />
      <button type="button" onClick={() => onChange("soft")} className={btn(isSoft)}>
        <Droplets className="h-3.5 w-3.5" /> Soft
      </button>
      <button type="button" onClick={() => onChange("power")} className={btn(!isSoft)}>
        <Zap className="h-3.5 w-3.5" /> Power
      </button>
    </div>
  );
}

function PressureLineEditor({ lines, catalog, onChange }: LineEditorProps) {
  const rows = lines as PressureSurfaceLine[];

  const rateFor = (surface: SurfaceKey, mode: JobMode): number => {
    const hit = catalog.find((c) => c.surface_type === surface && c.mode === mode);
    return hit ? Number(hit.default_rate ?? 0) : 0;
  };
  const addSurface = (surface: SurfaceKey) => {
    const mode = SURFACE_META[surface].recommended;
    const rate = rateFor(surface, mode);
    const sqft = DEFAULT_SQFT[surface];
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        surface,
        sqft,
        rate,
        mode,
        custom: false,
        total: pressureLineTotal({ sqft, rate }),
      } as PressureSurfaceLine,
    ]);
  };
  const addCustomLine = () => onChange([...rows, pressureBlankLine() as PressureSurfaceLine]);
  const updateLine = (id: string, patch: Partial<PressureSurfaceLine>) =>
    onChange(
      rows.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        next.total = pressureLineTotal(next);
        return next;
      }),
    );
  const removeLine = (id: string) => onChange(rows.filter((l) => l.id !== id));

  return (
    <Section
      title="Line items"
      subtitle="Tap a surface to add it, or add a custom line. Edit sqft, rate, and wash mode per line."
    >
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(SURFACE_META) as SurfaceKey[]).map((s) => {
          const m = SURFACE_META[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => addSurface(s)}
              className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-card p-2 hover:border-brand-700 transition-colors"
            >
              <span className="text-2xl">{m.emoji}</span>
              <span className="text-[10px] font-bold leading-tight text-center">{m.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addCustomLine}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-200 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
        Add custom line item
      </button>

      {rows.length > 0 && (
        <ul className="space-y-2 pt-1">
          {rows.map((l) => (
            <li key={l.id} className="rounded-xl border border-neutral-200 bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {l.custom ? (
                  <>
                    <span className="text-xl">✏️</span>
                    <input
                      value={l.label ?? ""}
                      onChange={(e) => updateLine(l.id, { label: e.target.value })}
                      placeholder="Line item name"
                      className="tp-input flex-1 font-semibold"
                    />
                  </>
                ) : (
                  <>
                    <span className="text-xl">{SURFACE_META[l.surface].emoji}</span>
                    <span className="font-semibold flex-1">{SURFACE_META[l.surface].label}</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => removeLine(l.id)}
                  className="h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 flex items-center justify-center"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {l.custom ? (
                <Field label="Amount ($)">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={l.rate}
                    onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0, sqft: 1 })}
                    className="tp-input"
                  />
                </Field>
              ) : (
                <div className="grid grid-cols-3 gap-2 items-end">
                  <Field label="Sqft">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={l.sqft}
                      onChange={(e) => updateLine(l.id, { sqft: Number(e.target.value) || 0 })}
                      className="tp-input"
                    />
                  </Field>
                  <Field label="$ / sqft">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={l.rate}
                      onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })}
                      className="tp-input"
                    />
                  </Field>
                  <Field label="Mode">
                    <ModeToggle value={l.mode} onChange={(m) => updateLine(l.id, { mode: m })} />
                  </Field>
                </div>
              )}

              <div className="flex justify-between items-center pt-1">
                <span className="text-[12px] text-neutral-500">Line total</span>
                <span className="font-semibold tp-num">{fmtMoney(l.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export const pressureQuoteLine: QuoteLineModule = {
  blankLine: pressureBlankLine,
  catalogToLine: pressureCatalogToLine,
  lineTotal: (l) => pressureLineTotal(l as PressureSurfaceLine),
  parseLines: pressureParseLines,
  describe: pressureDescribe,
  LineEditor: PressureLineEditor,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/verticals/pressure/quote-line.test.ts`
Expected: PASS (all cases). If a case fails, fix the module to match the spec's stated behavior (do not weaken the test).

- [ ] **Step 5: Verify tsc gate + build + full suite**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error set unchanged (the known 6 baseline files only; `quote-line.tsx`/`.test.ts` do NOT appear).

Run: `npx vitest run`
Expected: full suite green.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/verticals/pressure/quote-line.tsx src/verticals/pressure/quote-line.test.ts
git commit
```
(Message like `feat(platform): pressure quote-line seam (SurfaceLine parse/math/describe + surface-grid editor)` + trailers.)

---

## Self-Review notes (author)

- **Spec coverage:** every `QuoteLineModule` member implemented per spec; `describe` formats match the spec's LineDescription mapping; `catalogToLine` surface-vs-custom branch matches; `parseLines` defensive rules match; editor uses shared `tp-*`/`Section`/`Field` (no `pp-*`/`shadow-soft`); `seasonalRate` correctly absent (deferred).
- **No placeholders:** full module + full test code present.
- **Type consistency:** `PressureSurfaceLine extends QuoteLine`; boundary casts (`as PressureSurfaceLine`) exactly as lawn does; `lineTotal` accepts the structural `{sqft,rate}`. `item.mode`/`item.surface_type` are `string|null|undefined` on the shared `CatalogItem`, narrowed via `isSurfaceKey` and an explicit `"soft"|"power"` check.
- **Lawn safety:** only the two new pressure files are touched; nothing shared or lawn changes; module is unreferenced until 1e.
