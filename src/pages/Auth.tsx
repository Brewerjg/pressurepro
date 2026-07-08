import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { vertical } from "@/vertical";

type Mode = "sign-in" | "sign-up" | "forgot";

// Google sign-in is built but disabled until the Google OAuth client +
// Supabase provider are configured (see docs/AUTH_GOOGLE_RESET_SETUP.md).
// Flip to true to re-enable the "Continue with Google" button.
const GOOGLE_SIGNIN_ENABLED = false;

// Inline Google "G" mark so we don't add an icon dependency.
function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default function Auth() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const clearMessages = () => {
    setError(null);
    setInfo(null);
  };

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

  // Continue with Google.
  //
  // WEB: redirect back to the app origin. Supabase completes the OAuth
  // dance and AuthContext's onAuthStateChange picks up the session.
  //
  // NATIVE (Capacitor): Google refuses OAuth inside an embedded WebView,
  // so we must open the consent screen in the SYSTEM browser. We ask
  // supabase-js to build the authorize URL but skip its own redirect
  // (`skipBrowserRedirect`), then open `data.url` via @capacitor/browser.
  // We point `redirectTo` at our custom scheme so the browser hands the
  // session back to the app — see src/lib/auth-deep-link.ts for the
  // listener that finishes the PKCE code exchange.
  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    setInfo(null);
    try {
      const isNative = Capacitor.isNativePlatform();
      const redirectTo = isNative
        ? "turfpro://auth-callback"
        : window.location.origin;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: isNative,
        },
      });
      if (error) throw error;

      if (isNative && data?.url) {
        // Open the Google consent screen in the system browser. Dynamic
        // variable-specifier import so the web bundle never requires the
        // plugin (matches src/lib/native-browser.ts).
        const browserSpecifier = "@capacitor/browser";
        try {
          const mod: any = await import(/* @vite-ignore */ browserSpecifier);
          await mod.Browser.open({ url: data.url });
        } catch (err) {
          console.warn("[auth] Browser.open failed for Google OAuth:", err);
          // Last-ditch fallback so the button is never dead.
          window.open(data.url, "_blank", "noopener");
        }
      }
      // WEB: supabase-js has already issued the full-page redirect.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't start Google sign-in.");
      setGoogleLoading(false);
    }
    // On web the page navigates away, so we intentionally leave the
    // loading state set; on native, errors above reset it.
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "forgot") {
        // Password reset. On native, route the email link back through our
        // custom scheme; on web, send the user to the /reset-password page
        // where supabase-js parses the recovery token from the URL.
        const redirectTo = Capacitor.isNativePlatform()
          ? "turfpro://auth-callback?type=recovery"
          : `${window.location.origin}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) throw error;
        setInfo("Check your email for a reset link.");
      } else if (mode === "sign-in") {
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
            {vertical.brand.name}
          </div>
          <p className="text-sm text-white/80 mt-1">
            Routes, plans, and recurring lawn-care ops.
          </p>
        </div>

        <form onSubmit={onSubmit} className="tp-card p-5 space-y-4 bg-card/95 backdrop-blur-sm shadow-xl">
          <div>
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
            />
          </div>

          {mode !== "forgot" && (
            <div>
              <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
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
                className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
              />
              {mode === "sign-in" && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    clearMessages();
                  }}
                  className="mt-2 text-xs text-neutral-500 hover:text-neutral-700"
                >
                  Forgot password?
                </button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-brand-700">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-2xl bg-accent-500 hover:bg-accent-600 text-white font-bold text-sm shadow-accent disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "sign-in"
              ? "Sign in"
              : mode === "sign-up"
                ? "Create account"
                : "Send reset link"}
          </button>

          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => {
                setMode("sign-in");
                clearMessages();
              }}
              className="w-full text-xs text-neutral-500 hover:text-neutral-700"
            >
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                clearMessages();
              }}
              className="w-full text-xs text-neutral-500 hover:text-neutral-700"
            >
              {mode === "sign-in" ? "No account? Sign up" : "Already have an account? Sign in"}
            </button>
          )}

          {/* Google sign-in — shown on sign-in and sign-up, not on the
              forgot-password view. Disabled via GOOGLE_SIGNIN_ENABLED until
              the OAuth client is configured. */}
          {GOOGLE_SIGNIN_ENABLED && mode !== "forgot" && (
            <>
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-neutral-100" />
                <span className="text-[11px] uppercase tracking-wide text-neutral-400">or</span>
                <div className="h-px flex-1 bg-neutral-100" />
              </div>

              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={googleLoading}
                className="w-full h-12 rounded-2xl border border-neutral-200 bg-card hover:bg-neutral-50 text-neutral-900 font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {googleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GoogleIcon />
                )}
                Continue with Google
              </button>
            </>
          )}
        </form>

        {mode !== "forgot" && (
          <div className="mt-4 pt-4 border-t border-neutral-100">
            <button
              onClick={createDemoAccount}
              disabled={creatingDemo}
              className="w-full h-12 rounded-2xl bg-brand-700 hover:bg-brand-800 text-white font-bold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {creatingDemo && <Loader2 className="h-4 w-4 animate-spin" />}
              Try Demo (No signup required)
            </button>
          </div>
        )}

        <p className="text-[11px] text-white/70 text-center mt-4">
          One login works across TurfPro and PressurePro.
        </p>
      </div>
    </div>
  );
}
