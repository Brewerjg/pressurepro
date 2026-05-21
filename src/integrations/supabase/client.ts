import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Wired against PressurePro's Supabase project so an operator running both
// apps has one login. See TURFPRO_SPEC.md "Concrete near-term moves".
// Database type is generated from the PressurePro schema + TurfPro additions
// (supabase/migrations/0001_turfpro_lawn_care.sql). Regenerate via
// `supabase gen types typescript --project-id <id>` after schema changes.
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
