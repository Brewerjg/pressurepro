import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
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
  const [creatingDemo, setCreatingDemo] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const createDemoAccount = async () => {
    setCreatingDemo(true);
    setError(null);
    setInfo(null);
    try {
      // Generate random demo credentials
      const demoId = Math.random().toString(36).substring(7);
      const demoEmail = `demo-${demoId}@turfpro.demo`;
      const demoPassword = `demo-${demoId}-password`;

      // Create demo account
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: demoEmail,
        password: demoPassword,
        options: {
          data: {
            is_demo: true,
          },
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) throw signUpError;

      // Auto sign in the demo account
      if (authData.user) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: demoEmail,
          password: demoPassword
        });
        if (signInError) throw signInError;

        // Mark as demo in profiles
        await supabase
          .from("profiles")
          .update({ is_demo: true })
          .eq("id", authData.user.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't create demo account");
    } finally {
      setCreatingDemo(false);
    }
  };

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
        // On native, redirect through our custom URL scheme so the
        // confirm-email link reopens the app instead of landing on
        // `capacitor://localhost` (which is meaningless outside the
        // WebView). See src/lib/auth-deep-link.ts for the listener
        // that handles the incoming `turfpro://auth-callback` URL.
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              is_demo: false, // Explicitly mark as NOT demo for regular signups
            },
            emailRedirectTo: Capacitor.isNativePlatform()
              ? "turfpro://auth-callback"
              : window.location.origin,
          },
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
    <div className="relative min-h-screen grid place-items-center px-6 overflow-hidden">
      {/* Background video */}
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
      {/* Dark gradient overlay for text legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/70" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="tp-display text-[34px] font-bold text-white tracking-tight drop-shadow">
            TurfPro
          </div>
          <p className="text-sm text-white/80 mt-1">
            Routes, plans, and recurring lawn-care ops.
          </p>
        </div>

        <form onSubmit={onSubmit} className="tp-card p-5 space-y-4 bg-card/95 backdrop-blur-sm shadow-xl">
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

        <div className="mt-4 pt-4 border-t border-ink-100">
          <button
            onClick={createDemoAccount}
            disabled={creatingDemo}
            className="w-full h-12 rounded-2xl bg-green-700 hover:bg-green-800 text-white font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {creatingDemo && <Loader2 className="h-4 w-4 animate-spin" />}
            Try Demo (No signup required)
          </button>
        </div>

        <p className="text-[11px] text-white/70 text-center mt-4">
          One login works across TurfPro and PressurePro.
        </p>
      </div>
    </div>
  );
}
