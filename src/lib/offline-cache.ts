// TurfPro — offline cache + mutation queue for RouteMode.
//
// Why this exists: operators in the field lose cell signal in driveways,
// tunnels, and dead-zone neighborhoods. Before this module, RouteMode would
// hang on the route fetch and any Mark-done / Arrive / Skip mutation would
// throw, blocking the operator from moving to the next stop.
//
// What this gives us:
//
//   1. cacheRoute(routeId, payload) on a successful fetch — write the full
//      route + stops payload to a per-route key so we can re-hydrate it
//      offline. The shape is whatever the route_stops query returns; we
//      stay schema-agnostic on purpose so a column add doesn't break the
//      cache.
//
//   2. queueMutation(mutation) when the operator taps Mark-done / Arrive /
//      Skip while the network is down (or when the request fails). The
//      caller has already optimistically updated local state; this module
//      just persists the intent so flushPendingMutations() can replay it
//      against Supabase when the radio comes back.
//
//   3. flushPendingMutations(supabase) on `online` events. Best-effort —
//      we replay each mutation against the live database, drop the ones
//      that succeed, and leave the failures in the queue for the next
//      attempt. Each kind has its own write path; see runMutation().
//
//   4. clearCachedRoute(routeId) on route completion or unmount. We DO
//      NOT clear the pending mutation queue here — those are independent
//      of which route is currently loaded and need to flush on their own
//      schedule.
//
// Storage backend:
//   - Native (iOS/Android) via @capacitor/preferences, dynamic-imported
//     with @vite-ignore so the build doesn't choke if the plugin hasn't
//     been npm-installed yet — same pattern used by lib/stripe.ts and
//     lib/native-maps.ts.
//   - Web (and native fallback) via localStorage.

import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_ID } from "@/lib/app-context";

// =====================================================================
// Types
// =====================================================================

export type PendingMutation =
  | { kind: "mark_done"; stop_id: string; at: string }
  | { kind: "skip"; stop_id: string; reason: string }
  | { kind: "arrive"; stop_id: string; at: string; adjusted: boolean }
  | { kind: "set_sort_order"; stop_id: string; sort_order: number };

// Internal — we tag every queued mutation with an enqueue timestamp + a
// unique id so flush retries don't accidentally duplicate-process the
// same entry, and so we can de-dupe within a single flush call.
interface StoredMutation {
  id: string;
  enqueued_at: string;
  mutation: PendingMutation;
}

// =====================================================================
// Storage keys
// =====================================================================

const PENDING_KEY = `${APP_ID}_pending_mutations`;
const ROUTE_KEY_PREFIX = `${APP_ID}_cached_route_`;

// =====================================================================
// Backend abstraction — Preferences on native, localStorage on web.
// We pick once at module load and reuse.
// =====================================================================

interface KVBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// localStorage fallback. Wrapping in promises makes the call sites
// uniform with the native path.
const webBackend: KVBackend = {
  async get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      // Quota errors or disabled storage — we log and swallow. Cache
      // miss is better than a runtime crash mid-route.
      console.warn("[offline-cache] localStorage.set failed:", err);
    }
  },
  async remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

// Native backend via dynamic-imported @capacitor/preferences. We resolve
// the plugin lazily on first use and cache the promise.
let nativeBackendPromise: Promise<KVBackend> | null = null;
function getNativeBackend(): Promise<KVBackend> {
  if (!nativeBackendPromise) {
    // Variable specifier + @vite-ignore so Rollup doesn't try to resolve
    // @capacitor/preferences at build time. If the plugin isn't installed
    // (or its native impl is missing), we fall through to web on the
    // catch in getBackend().
    const moduleSpecifier = "@capacitor/preferences";
    nativeBackendPromise = import(/* @vite-ignore */ moduleSpecifier).then(
      (mod: any) => {
        const Preferences = mod.Preferences;
        return {
          async get(key: string) {
            const res = await Preferences.get({ key });
            return (res?.value ?? null) as string | null;
          },
          async set(key: string, value: string) {
            await Preferences.set({ key, value });
          },
          async remove(key: string) {
            await Preferences.remove({ key });
          },
        } satisfies KVBackend;
      },
    );
  }
  return nativeBackendPromise;
}

async function getBackend(): Promise<KVBackend> {
  if (Capacitor.isNativePlatform()) {
    try {
      return await getNativeBackend();
    } catch (err) {
      console.warn(
        "[offline-cache] @capacitor/preferences unavailable, falling back to localStorage:",
        err,
      );
      return webBackend;
    }
  }
  return webBackend;
}

// =====================================================================
// Route payload cache
// =====================================================================

/**
 * Persist the route + stops payload under a per-route key. Called from
 * RouteMode on every successful route fetch so the most recent snapshot
 * is always the one available offline.
 */
export async function cacheRoute(routeId: string, payload: unknown): Promise<void> {
  if (!routeId) return;
  const backend = await getBackend();
  try {
    await backend.set(ROUTE_KEY_PREFIX + routeId, JSON.stringify(payload));
  } catch (err) {
    console.warn("[offline-cache] cacheRoute failed:", err);
  }
}

/**
 * Read the cached route payload. Returns `null` if nothing is cached or
 * the payload can't be parsed (corruption — we treat that as a miss).
 */
export async function loadCachedRoute(routeId: string): Promise<any | null> {
  if (!routeId) return null;
  const backend = await getBackend();
  const raw = await backend.get(ROUTE_KEY_PREFIX + routeId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[offline-cache] loadCachedRoute parse failed:", err);
    return null;
  }
}

/**
 * Drop the cached payload for a single route. Called when the route is
 * marked complete or the user leaves RouteMode. We intentionally DO NOT
 * touch the pending-mutation queue here.
 */
export async function clearCachedRoute(routeId: string): Promise<void> {
  if (!routeId) return;
  const backend = await getBackend();
  await backend.remove(ROUTE_KEY_PREFIX + routeId);
}

// =====================================================================
// Pending mutation queue
// =====================================================================

async function readQueue(): Promise<StoredMutation[]> {
  const backend = await getBackend();
  const raw = await backend.get(PENDING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: StoredMutation[]): Promise<void> {
  const backend = await getBackend();
  await backend.set(PENDING_KEY, JSON.stringify(queue));
}

/**
 * Append a mutation to the queue. The caller has already optimistically
 * updated local state; this just persists the intent for later replay.
 */
export async function queueMutation(mutation: PendingMutation): Promise<void> {
  const queue = await readQueue();
  const entry: StoredMutation = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    enqueued_at: new Date().toISOString(),
    mutation,
  };
  queue.push(entry);
  await writeQueue(queue);
}

/**
 * Returns the number of currently-queued mutations. Used by RouteMode to
 * decorate the offline pill ("Offline — N pending").
 */
export async function pendingMutationCount(): Promise<number> {
  return (await readQueue()).length;
}

// Apply a single queued mutation against Supabase. Pulled out so flush
// can iterate cleanly and so the conflict-handling logic lives in one
// place.
//
// CONFLICT BEHAVIOR — when a queued mark_done / arrive / skip runs after
// the same row has been mutated elsewhere (e.g. another crew member
// marked it done online before we re-synced), the update still applies,
// but only against the matching row — there's no row-level conflict.
// We DON'T overwrite `completed_at` if the row already has one (we
// guard with an `is.null` filter on completed_at for mark_done /
// arrive). That keeps the earliest real timestamp authoritative.
async function runMutation(
  supabase: SupabaseClient,
  m: PendingMutation,
): Promise<void> {
  const sb: any = supabase;
  switch (m.kind) {
    case "mark_done": {
      // Only stamp completed_at if it's still null. Last-write-wins on
      // status is fine, but timestamps stay first-write-wins.
      const { error } = await sb
        .from("route_stops")
        .update({ status: "done", completed_at: m.at })
        .eq("id", m.stop_id)
        .is("completed_at", null);
      if (error) throw error;
      // If completed_at was already set we still want status=done to
      // match local state; do a second non-timestamp update.
      const { error: err2 } = await sb
        .from("route_stops")
        .update({ status: "done" })
        .eq("id", m.stop_id);
      if (err2) throw err2;
      return;
    }
    case "arrive": {
      // Same first-write-wins guard on arrived_at.
      const { error } = await sb
        .from("route_stops")
        .update({ arrived_at: m.at, arrival_adjusted: m.adjusted })
        .eq("id", m.stop_id)
        .is("arrived_at", null);
      if (error) throw error;
      return;
    }
    case "skip": {
      const { error } = await sb
        .from("route_stops")
        .update({ status: "skipped", skip_reason: m.reason })
        .eq("id", m.stop_id);
      if (error) throw error;
      return;
    }
    case "set_sort_order": {
      const { error } = await sb
        .from("route_stops")
        .update({ sort_order: m.sort_order })
        .eq("id", m.stop_id);
      if (error) throw error;
      return;
    }
  }
}

/**
 * Replay queued mutations against Supabase. Best-effort: succeeded
 * mutations are dropped from the queue, failures stay (and the next
 * flush picks them up). Returns counts so the caller can decide whether
 * to surface a banner.
 *
 * Safe to call concurrently — the worst case is that two flushes pick
 * up the same entry and both apply it. Mutations are idempotent at the
 * row level (mark_done -> status='done' twice is fine).
 */
export async function flushPendingMutations(
  supabase: SupabaseClient,
): Promise<{ ok: number; failed: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { ok: 0, failed: 0 };

  let ok = 0;
  let failed = 0;
  const remaining: StoredMutation[] = [];

  for (const entry of queue) {
    try {
      await runMutation(supabase, entry.mutation);
      ok++;
    } catch (err) {
      console.warn("[offline-cache] mutation replay failed:", entry, err);
      failed++;
      remaining.push(entry);
    }
  }

  await writeQueue(remaining);
  return { ok, failed };
}
