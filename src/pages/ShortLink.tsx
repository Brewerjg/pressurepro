import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle, Leaf } from "lucide-react";

// /s/:code — looks up a short link in short_links and redirects.
// Same-origin paths are routed within the SPA; everything else is a
// full-page navigation. Public reads are policy-allowed in the shared
// schema (PressurePro's short_links public SELECT policy).

const ShortLink = () => {
  const { code } = useParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError("Missing link code");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("short_links")
        .select("target_url")
        .eq("code", code)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setError("This link is invalid or expired.");
        return;
      }
      const target = data.target_url;
      try {
        const url = new URL(target, window.location.origin);
        if (url.origin === window.location.origin) {
          window.location.replace(url.pathname + url.search + url.hash);
        } else {
          window.location.replace(target);
        }
      } catch {
        window.location.replace(target);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-6">
      <div className="text-center max-w-sm">
        {error ? (
          <>
            <div className="h-12 w-12 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl mt-4">Link not found</h1>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <Link
              to="/"
              className="inline-block mt-4 text-sm font-semibold text-brand-800 hover:underline"
            >
              Go home →
            </Link>
          </>
        ) : (
          <>
            <div className="h-12 w-12 mx-auto rounded-full bg-brand-50 text-brand-800 flex items-center justify-center">
              <Leaf className="h-6 w-6" />
            </div>
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-brand-800 mt-4" />
            <p className="text-sm text-muted-foreground mt-3">Opening link…</p>
          </>
        )}
      </div>
    </div>
  );
};

export default ShortLink;
