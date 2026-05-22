import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// First-run gate. Reads profiles.onboarded_at for the current user; if it's
// null — OR if the profile row doesn't exist yet (brand-new account before the
// signup trigger has fired) — redirect to the wizard. The wizard's Step 1
// upserts the profile, so the no-row case is the canonical "fresh signup"
// state and must be treated as not-onboarded.
//
// We do NOT preserve the intended destination; new operators land on Home
// after finishing the wizard regardless of where they were trying to go,
// because none of the gated surfaces are useful before onboarding completes.

export default function RequireOnboarded({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["profile-onboarded", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarded_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      // null (no row) is a meaningful state — return it as-is so the gate can
      // distinguish "no row" (redirect) from "row with null onboarded_at"
      // (also redirect) from "row with onboarded_at set" (pass through).
      return data as { onboarded_at: string | null } | null;
    },
  });

  if (authLoading || (!!user && isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // If the profile fetch errored, fall through rather than trap the user on a
  // spinner — they can still navigate; the next page render will retry.
  if (user && !isError) {
    const onboarded = data?.onboarded_at != null;
    if (!onboarded) {
      return <Navigate to="/onboarding" replace />;
    }
  }

  return <>{children}</>;
}
