import { VERTICALS } from "@/verticals/registry";
import type { Vertical } from "@/verticals/types";

// Resolve the active vertical from the build-time VITE_VERTICAL env (default
// "pressure" — this repo IS the PressurePro app). Fails fast on an unknown
// slug so a misconfigured build never ships silently against the wrong trade.
const slug = import.meta.env.VITE_VERTICAL ?? "pressure";
const active: Vertical | undefined = VERTICALS[slug];
if (!active) {
  throw new Error(
    `Unknown VITE_VERTICAL "${slug}". Known verticals: ${Object.keys(VERTICALS).join(", ")}`,
  );
}

export const vertical: Vertical = active;
