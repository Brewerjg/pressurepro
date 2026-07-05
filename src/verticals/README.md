# Verticals

Each trade app is one `Vertical` config (see `types.ts`) selected at build time
via `VITE_VERTICAL` (default `lawn`). The shared core reads the active vertical
from `@/vertical` and delegates trade-specific behaviour to it.

## Adding a vertical (later phases)
1. Create `src/verticals/<slug>/index.ts` exporting a `Vertical`.
2. Register it in `registry.ts` under its `<slug>`.
3. Build with `VITE_VERTICAL=<slug> npm run build`; ship with its own Capacitor
   `appId` (`brand.bundleId`) and icons.

## Status
- Phase 0a (this): identity + brand only.
- Phase 0b: theme-token normalization (semantic tokens) so palettes swap per vertical.
- Phase 0c: extract the lawn domain (quote-line, catalog, calculators, GDD/season/weather, campaign copy, property fields) behind the contract.
- Phase 1+: add the pressure-washing vertical; then new trades are config-only.
