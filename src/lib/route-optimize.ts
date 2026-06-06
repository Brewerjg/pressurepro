// Route ordering — pure, dependency-free nearest-neighbor heuristic.
//
// Given a set of stops with lat/lng, return an ordering of stop ids that
// approximates the shortest tour by greedily picking the nearest unvisited
// stop each step. Stops missing coords are appended at the end of the
// returned ordering in their original input order (we can't optimize what
// we can't measure).
//
// This is intentionally NOT a real TSP solver — nearest-neighbor is
// O(n^2), runs in microseconds for 10-15 stop lawn routes, and yields
// a tour within ~25% of optimal on typical clustered customer bases.
// Good enough to save the operator real drive time without sending the
// route through an external solver.

export interface OptimizeStop {
  id: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Nearest-neighbor stop ordering.
 *
 * @param stops    Input stops. Order is meaningful only for entries
 *                 missing lat/lng (those get appended in input order).
 * @param startLat Optional starting latitude (e.g. operator's home / shop).
 * @param startLng Optional starting longitude.
 * @returns        Array of stop ids in optimized visit order.
 */
export function nearestNeighborOrder(
  stops: OptimizeStop[],
  startLat?: number,
  startLng?: number,
): string[] {
  const withCoords: Array<OptimizeStop & { lat: number; lng: number }> = [];
  const withoutCoords: OptimizeStop[] = [];
  for (const s of stops) {
    if (s.lat != null && s.lng != null) {
      withCoords.push({ ...s, lat: Number(s.lat), lng: Number(s.lng) });
    } else {
      withoutCoords.push(s);
    }
  }

  if (withCoords.length === 0) {
    return withoutCoords.map((s) => s.id);
  }

  // Pick a seed. If the caller supplied a start point, use the stop
  // closest to it. Otherwise, fall back to the stop closest to the
  // centroid — a reasonable middle-of-the-cluster opener that keeps
  // the tour from starting on a far-flung outlier.
  let seedLat: number;
  let seedLng: number;
  if (startLat != null && startLng != null) {
    seedLat = startLat;
    seedLng = startLng;
  } else {
    let sumLat = 0;
    let sumLng = 0;
    for (const s of withCoords) {
      sumLat += s.lat;
      sumLng += s.lng;
    }
    seedLat = sumLat / withCoords.length;
    seedLng = sumLng / withCoords.length;
  }

  const remaining = [...withCoords];
  const ordered: string[] = [];

  // First pick: closest to seed.
  let bestIdx = 0;
  let bestDist = haversineMiles(seedLat, seedLng, remaining[0].lat, remaining[0].lng);
  for (let i = 1; i < remaining.length; i++) {
    const d = haversineMiles(seedLat, seedLng, remaining[i].lat, remaining[i].lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  let current = remaining.splice(bestIdx, 1)[0];
  ordered.push(current.id);

  // Walk: greedy nearest from the current stop until exhausted.
  while (remaining.length > 0) {
    let nextIdx = 0;
    let nextDist = haversineMiles(current.lat, current.lng, remaining[0].lat, remaining[0].lng);
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineMiles(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
      if (d < nextDist) {
        nextDist = d;
        nextIdx = i;
      }
    }
    current = remaining.splice(nextIdx, 1)[0];
    ordered.push(current.id);
  }

  // Append coord-less stops in their original input order.
  for (const s of withoutCoords) ordered.push(s.id);
  return ordered;
}

// Haversine distance in miles. Earth radius 3958.8 mi (mean).
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
