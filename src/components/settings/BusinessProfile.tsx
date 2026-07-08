import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { vertical } from "@/vertical";

// Business profile editor — writes to public.profiles for the current user.
// Profile row is upsert-style: select-where-user_id, insert if missing.
// We save on Save button click and on blur. Fields are kept local and only
// flushed on blur to avoid a network round-trip per keystroke.

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type Draft = {
  business_name: string;
  phone: string;
  zip: string;
  route_start_address: string;
};

const emptyDraft: Draft = { business_name: "", phone: "", zip: "", route_start_address: "" };

export default function BusinessProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [savedFlash, setSavedFlash] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProfileRow | null;
    },
  });

  useEffect(() => {
    if (!profile) return;
    setDraft({
      business_name: profile.business_name ?? "",
      phone: profile.phone ?? "",
      zip: profile.zip ?? "",
      route_start_address: (profile as { route_start_address?: string | null }).route_start_address ?? "",
    });
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async (next: Draft) => {
      if (!user) throw new Error("Not signed in");
      const payload = {
        business_name: next.business_name.trim() || null,
        phone: next.phone.trim() || null,
        zip: next.zip.trim() || null,
        route_start_address: next.route_start_address.trim() || null,
      };
      if (profile) {
        const { error } = await supabase
          .from("profiles")
          .update(payload)
          .eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("profiles")
          .insert({ user_id: user.id, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    },
  });

  const handleBlur = () => {
    // Only save if something actually changed.
    if (!profile) {
      if (draft.business_name || draft.phone || draft.zip || draft.route_start_address) {
        saveMutation.mutate(draft);
      }
      return;
    }
    const changed =
      (profile.business_name ?? "") !== draft.business_name ||
      (profile.phone ?? "") !== draft.phone ||
      (profile.zip ?? "") !== draft.zip ||
      ((profile as { route_start_address?: string | null }).route_start_address ?? "") !== draft.route_start_address;
    if (changed) saveMutation.mutate(draft);
  };

  return (
    <div className="tp-card p-4 space-y-3">
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading profile…
        </div>
      ) : (
        <>
          <Field label="Business name">
            <input
              value={draft.business_name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, business_name: e.target.value }))
              }
              onBlur={handleBlur}
              placeholder={vertical.copy.businessNamePlaceholder}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                value={draft.phone}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, phone: e.target.value }))
                }
                onBlur={handleBlur}
                placeholder="555-123-4567"
                inputMode="tel"
                className={inputCls}
              />
            </Field>
            <Field label="ZIP">
              <input
                value={draft.zip}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, zip: e.target.value }))
                }
                onBlur={handleBlur}
                placeholder="12345"
                inputMode="numeric"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Route start address (shop/home)">
            <input
              value={draft.route_start_address}
              onChange={(e) =>
                setDraft((d) => ({ ...d, route_start_address: e.target.value }))
              }
              onBlur={handleBlur}
              placeholder="123 Main St, Roland, AR 72135"
              className={inputCls}
            />
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending}
              className={cn(
                "h-9 px-3.5 rounded-xl bg-brand-800 text-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-brand-900 transition-colors disabled:opacity-60",
              )}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              Save profile
            </button>
            {savedFlash && (
              <span className="text-[11px] font-semibold text-brand-700">
                Saved
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-[11px] font-semibold text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {saveMutation.error instanceof Error
                  ? saveMutation.error.message
                  : "Couldn't save"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const inputCls =
  "w-full h-10 rounded-xl border border-neutral-200 bg-card px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-700/30 focus:border-brand-700";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
