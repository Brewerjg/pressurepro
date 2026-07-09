export type SurfaceKey = "house" | "siding" | "roof" | "driveway" | "concrete" | "deck" | "fence";

export const SURFACES: SurfaceKey[] = ["house", "roof", "siding", "driveway", "concrete", "deck", "fence"];

export const SURFACE_LABEL: Record<SurfaceKey, { label: string; emoji: string }> = {
  house: { label: "House Wash", emoji: "🏠" },
  siding: { label: "Siding", emoji: "🧱" },
  roof: { label: "Roof", emoji: "🛖" },
  driveway: { label: "Driveway", emoji: "🛣️" },
  concrete: { label: "Concrete", emoji: "🧊" },
  deck: { label: "Deck", emoji: "🪵" },
  fence: { label: "Fence", emoji: "🚧" },
};

// Per-surface soft-wash targets (SH % + surfactant oz/gal), verbatim from PressurePro.
export const SH_TARGETS: Record<SurfaceKey, { targetPct: number; surfactantOzPerGal: number }> = {
  house: { targetPct: 1.0, surfactantOzPerGal: 1.0 },
  siding: { targetPct: 1.0, surfactantOzPerGal: 1.0 },
  roof: { targetPct: 4.0, surfactantOzPerGal: 2.0 },
  fence: { targetPct: 1.5, surfactantOzPerGal: 1.0 },
  deck: { targetPct: 1.5, surfactantOzPerGal: 1.0 },
  concrete: { targetPct: 2.0, surfactantOzPerGal: 1.5 },
  driveway: { targetPct: 2.0, surfactantOzPerGal: 1.5 },
};

// Default chem costs for the estimate (turf has no per-user chem-cost settings;
// operator tuning is a deferred parity gap).
export const SH_COST_PER_GAL = 3.5;
export const SURFACTANT_COST_PER_OZ = 0.25;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function computeMix(input: {
  totalGallons: number;
  targetPct: number;
  stockPct: number;
  surfactantOzPerGal: number;
}): { stockGal: number; waterGal: number; surfactantOz: number } {
  const { totalGallons, targetPct, stockPct, surfactantOzPerGal } = input;
  const stockGal = stockPct > 0 ? round((totalGallons * targetPct) / stockPct) : 0;
  const waterGal = round(Math.max(0, totalGallons - stockGal));
  const surfactantOz = round(surfactantOzPerGal * totalGallons, 1);
  return { stockGal, waterGal, surfactantOz };
}

export function estimateCost(stockGal: number, surfactantOz: number): number {
  return round(stockGal * SH_COST_PER_GAL + surfactantOz * SURFACTANT_COST_PER_OZ);
}
