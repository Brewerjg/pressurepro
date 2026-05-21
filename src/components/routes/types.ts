// Local TypeScript shapes for routes / route_stops.
// These tables exist in supabase/migrations/0001_turfpro_lawn_care.sql but are
// not yet in the generated Database type, so we cast at the query site and
// hand-roll the shape here.

export type RouteStatus = "planned" | "in_progress" | "complete" | "skipped";
export type StopStatus = "pending" | "in_progress" | "done" | "skipped";
export type SkipReason =
  | "rain"
  | "drought"
  | "customer_travel"
  | "gate_locked"
  | "no_show"
  | "other";

export interface RouteStop {
  id: string;
  user_id: string;
  route_id: string;
  plan_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  address_snapshot: string | null;
  customer_name_snapshot: string | null;
  services: string[];
  fee_cents: number | null;
  sort_order: number;
  status: StopStatus;
  skip_reason: SkipReason | null;
  arrived_at: string | null;
  completed_at: string | null;
  drive_minutes_from_prev: number | null;
  drive_miles_from_prev: number | null;
  notes: string | null;
}

export interface Route {
  id: string;
  user_id: string;
  crew_id: string | null;
  date: string; // YYYY-MM-DD
  status: RouteStatus;
  started_at: string | null;
  completed_at: string | null;
  total_stops: number | null;
  completed_stops: number | null;
  total_miles: number | null;
  total_minutes: number | null;
  total_collected_cents: number | null;
  notes: string | null;
  route_stops?: RouteStop[];
}
