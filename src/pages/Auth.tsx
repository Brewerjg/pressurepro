import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Mode = "sign-in" | "sign-up";

export default function Auth() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setInfo("Check your email to confirm your account.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="tp-display text-[34px] font-bold text-green-800 tracking-tight">
            TurfPro
          </div>
          <p className="text-sm text-ink-500 mt-1">
            Routes, plans, and recurring lawn-care ops.
          </p>
        </div>

        <form onSubmit={onSubmit} className="tp-card p-5 space-y-4">
          <div>
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full h-11 rounded-xl border border-ink-200 px-3 bg-card text-ink-900 focus:outline-none focus:ring-2 focus:ring-green-700"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full h-11 rounded-xl border border-ink-200 px-3 bg-card text-ink-900 focus:outline-none focus:ring-2 focus:ring-green-700"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-green-700">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-2xl bg-bronze-500 hover:bg-bronze-600 text-white font-bold text-sm shadow-bronze disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setError(null);
              setInfo(null);
            }}
            className="w-full text-xs text-ink-500 hover:text-ink-700"
          >
            {mode === "sign-in" ? "No account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>

        <p className="text-[11px] text-ink-400 text-center mt-4">
          One login works across TurfPro and PressurePro.
        </p>
      </div>
    </div>
  );
}
