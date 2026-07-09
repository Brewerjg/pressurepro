import type { Vertical } from "@/verticals/types";
import { lawnVertical } from "@/verticals/lawn";
import { pressureVertical } from "@/verticals/pressure";

// Slug (VITE_VERTICAL value) → Vertical. New trades register here.
export const VERTICALS: Record<string, Vertical> = {
  lawn: lawnVertical,
  pressure: pressureVertical,
};
