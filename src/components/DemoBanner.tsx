import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function DemoBanner() {
  const { user } = useAuth();
  const [isDemo, setIsDemo] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Check if user is a demo account
    const checkDemo = async () => {
      try {
        // Try with id column first (TurfPro style)
        let { data, error } = await supabase
          .from("profiles")
          .select("is_demo")
          .eq("id", user.id)
          .maybeSingle();

        // If no data found, try with user_id column (PressurePro style)
        if (!data && !error) {
          const result = await supabase
            .from("profiles")
            .select("is_demo")
            .eq("user_id", user.id)
            .maybeSingle();
          data = result.data;
          error = result.error;
        }

        console.log("Demo check for user:", user.email);
        console.log("Profile query result:", { data, error });

        // CRITICAL: Only show demo banner if:
        // 1. Query succeeded (no error)
        // 2. Profile exists (data is not null)
        // 3. is_demo is explicitly true
        if (data && data.is_demo === true) {
          console.log("✅ User IS a demo user");
          setIsDemo(true);
        } else {
          // Default to NOT demo in all other cases:
          // - Profile doesn't exist
          // - is_demo is false
          // - is_demo is null/undefined
          // - Query failed
          console.log("✅ User is NOT a demo user");
          setIsDemo(false);
        }
      } catch (err) {
        // On any error, assume NOT demo
        console.error("Demo check failed:", err);
        setIsDemo(false);
      }
    };

    checkDemo();
  }, [user]);

  if (!isDemo || dismissed) return null;

  return (
    <div className="bg-accent-100 border-b border-accent-400 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-accent-700">
          <AlertCircle className="h-4 w-4" />
          <span>
            <strong>Demo Mode:</strong> You're exploring TurfPro with a demo account. Data won't be saved.
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-accent-600 hover:text-accent-700"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}