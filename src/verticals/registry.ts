import type { Vertical } from "@/verticals/types";
import { lawnVertical } from "@/verticals/lawn";

// Slug (VITE_VERTICAL value) → Vertical. New trades register here.
export const VERTICALS: Record<string, Vertical> = {
  lawn: lawnVertical,
};
