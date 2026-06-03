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
    supabase
      .from("profiles")
      .select("is_demo")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        // Only show demo banner if explicitly marked as demo (true)
        // If field doesn't exist or is false/null, don't show banner
        if (!error && data?.is_demo === true) {
          setIsDemo(true);
        } else {
          setIsDemo(false);
        }
      });
  }, [user]);

  if (!isDemo || dismissed) return null;

  return (
    <div className="bg-bronze-100 border-b border-bronze-400 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-bronze-700">
          <AlertCircle className="h-4 w-4" />
          <span>
            <strong>Demo Mode:</strong> You're exploring TurfPro with a demo account. Data won't be saved.
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-bronze-600 hover:text-bronze-700"
          aria-label="Dismiss banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}