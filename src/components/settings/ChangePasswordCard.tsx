import { FormEvent, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Change-password card for Settings → Security. The operator is already
// authenticated, so supabase.auth.updateUser({ password }) updates the
// password on the active session — no current-password round-trip needed.
// We still require a confirm field + an 8-char minimum to avoid typos.
export default function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="tp-card p-4 space-y-3">
      <div>
        <label
          htmlFor="new-password"
          className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
        >
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setDone(false);
          }}
          className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
        />
      </div>
      <div>
        <label
          htmlFor="confirm-password"
          className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500"
        >
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setDone(false);
          }}
          className="mt-1 w-full h-11 rounded-xl border border-neutral-200 px-3 bg-card text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && (
        <p className="text-sm text-brand-700 inline-flex items-center gap-1.5">
          <Check className="h-4 w-4" strokeWidth={2.5} />
          Password updated.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full h-11 rounded-xl bg-brand-700 hover:bg-brand-800 text-white font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Update password
      </button>
    </form>
  );
}
