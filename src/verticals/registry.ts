import type { Vertical } from "@/verticals/types";
import { pressureVertical } from "@/verticals/pressure";

// Slug (VITE_VERTICAL value) → Vertical. This repo is the standalone
// PressurePro app (forked from turf 2026-07-13); pressure is the only —
// and default — vertical.
export const VERTICALS: Record<string, Vertical> = {
  pressure: pressureVertical,
};
