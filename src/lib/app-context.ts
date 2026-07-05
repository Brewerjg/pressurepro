// App identity constant + helpers.
//
// TurfPro and PressurePro share the same Supabase project — same customers
// and properties — but operator-side records (quotes, plans, catalog items,
// photo pairs, campaigns) need to be siloed per app. Migration 0022 added
// an `app` discriminator column to each cross-leaking table; this constant
// is the single source of truth for "we are TurfPro" in client code.
//
// Usage:
//   import { APP_ID } from "@/lib/app-context";
//
//   // Operator-side SELECT — filter to TurfPro rows only:
//   supabase.from("quotes").select("*").eq("app", APP_ID)
//
//   // INSERT — tag the row to this app:
//   supabase.from("quotes").insert({ ..., app: APP_ID })
//
// Public-facing pages (Accept, QuotePrint, Review, PlanPortal, Gallery,
// ShortLink) do NOT filter by app — they look up by UUID, which is
// inherently disambiguating, and customers shouldn't care which app a
// quote was authored in.

import { vertical } from "@/vertical";
export type { AppId } from "@/verticals/types";

// APP_ID is the single source of truth for "which trade is this build?" — now
// derived from the active vertical (VITE_VERTICAL) rather than a hard-coded
// constant. Equals the DB `app` discriminator. Behaviour is unchanged for the
// default (lawn) build: APP_ID === "turfpro".
export const APP_ID = vertical.id;

/**
 * Tables that carry the `app` column. Useful for code-review checks
 * and (eventually) a lint rule that flags unfiltered queries.
 */
export const APP_DISCRIMINATED_TABLES = [
  "quotes",
  "maintenance_plans",
  "catalog_items",
  "photo_pairs",
  "campaigns",
] as const;
