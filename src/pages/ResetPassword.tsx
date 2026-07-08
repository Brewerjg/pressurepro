import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { vertical } from "@/vertical";

// Public page reached from a password-reset email link.
//
// When the user taps the link, supabase-js (with detectSessionInUrl on by
// default) parses the recovery token out of the URL on load, establishes a
// temporary session, and emits a `PASSWORD_RECOVERY` auth event. We listen
// for that event AND check for an already-present session on mount (the
// event may fire before this component subscribes), then show a
// new-password form that calls `supabase.auth.updateUser({ password })`.

type Status = "checking" | "ready" | "no-token" | "done";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 1. The recovery event may fire as supabase-js parses the URL.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setStatus("ready");
      }
    });

    // 2. Fallback: the event may have fired before we subscribed, or the
    //    session may already be set. Give supabase-js a moment to parse the
    //    URL, then check for an active session.
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setStatus((prev) => {
        if (prev === "ready") return prev;
        return data.session ? "ready" : "no-token";
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      // Brief confirmation, then send them into the app.
      window.setTimeout(() => navigate("/", { replace: true }), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't update your password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen grid place-items-center px-6 overflow-hidden">
      {/* Background video — matches the Auth screen. */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        poster="/videos/login-bg-poster.jpg"
      >
        <source src="/videos/login-bg.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/70" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="tp-display text-[34px] font-bold text-white tracking-tight drop-shadow">
            {vertical.brand.name}
          </div>
          <p className="text-sm text-white/80 mt-1">Reset your password</p>
        </div>

        <div className="tp-card p-5 space-y-4 bg-card/95 backdrop-blur-sm shadow-xl">
          {status === "checking" && (
            <div className="py-6 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
            </div>
          )}

          {status === "no-token" && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-destructive">
                This reset link is invalid or has expired.
              </p>
              <Link
                to="/auth"
                className="inline-block text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                Back to sign in
              </Link>
            </div>
          )}

          {status === "done" && (
            <div className="space-y-3 text-center py-2">
              <p className="text-sm text-brand-700 font-semibold">
                Password updated. Signing you in…
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-brand-700 mx-auto" />
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="text-xs font-semibold uppercase tracking-wide text-neutral-500"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="text-xs font-semibold uppercase tracking-wide text-neutral-500"
                >
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-2xl bg-accent-500 hover:bg-accent-600 text-white font-bold text-sm shadow-accent disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
