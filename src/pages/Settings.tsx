import { useQuery } from "@tanstack/react-query";
import { CreditCard, LogOut, Settings as SettingsIcon, Users, Wrench } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import BusinessProfile from "@/components/settings/BusinessProfile";
import CatalogEditor from "@/components/settings/CatalogEditor";
import CrewEditor from "@/components/settings/CrewEditor";

// Settings — full mobile-first surface. Composed of three editor components
// (Profile / Catalog / Crews) plus a read-only Billing card and an Account
// section that preserves the existing sign-out affordance from the stub.
//
// Stripe-managed billing wires in a later release; for now this page only
// reads the user's subscription row (if any) for transparency. PressurePro's
// surface_pricing / SH cost / gallons-per-sqft controls are intentionally
// skipped — lawn care prices per visit, not per square foot of a surface.

type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];

export default function Settings() {
  const { user, signOut } = useAuth();

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ["subscription", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Subscription | null;
    },
  });

  return (
    <div className="pt-3 pb-8">
      {/* Header — matches Home.tsx px-[22px] */}
      <header className="px-[22px] pb-[18px]">
        <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
          Account
        </div>
        <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
          Settings
        </h1>
        {user?.email && (
          <div className="text-[12px] text-ink-500 mt-1 truncate">
            {user.email}
          </div>
        )}
      </header>

      {/* Profile */}
      <Section icon={<SettingsIcon className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Profile">
        <BusinessProfile />
      </Section>

      {/* Service catalog */}
      <Section icon={<Wrench className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Service catalog">
        <CatalogEditor />
      </Section>

      {/* Crews */}
      <Section icon={<Users className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Crews">
        <CrewEditor />
      </Section>

      {/* Billing */}
      <Section icon={<CreditCard className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Billing">
        <div className="tp-card p-4 space-y-3">
          <p className="text-[12.5px] text-ink-700 leading-relaxed">
            Stripe-managed subscription billing is coming with the next release.
            Plans you create today track in your database, but they won't
            auto-charge until billing wiring lands.
          </p>
          <div className="rounded-xl border border-ink-100 p-3 bg-ink-100/40">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
              Your subscription
            </div>
            {subLoading ? (
              <div className="text-sm text-ink-500 mt-1">Loading…</div>
            ) : subscription ? (
              <div className="mt-1">
                <div className="text-sm font-semibold text-ink-900 capitalize">
                  Status: {subscription.status}
                  {subscription.cancel_at_period_end &&
                    " · cancels at period end"}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5 tp-num">
                  {subscription.current_period_end
                    ? `Renews ${new Date(
                        subscription.current_period_end,
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}`
                    : "No active period"}
                </div>
                {subscription.price_id && (
                  <div className="text-[10px] text-ink-400 mt-0.5 tp-mono">
                    {subscription.price_id}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-ink-700 mt-1">
                No subscription on file yet.
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Account */}
      <Section icon={<LogOut className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Account">
        <div className="tp-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Signed in as
          </div>
          <div className="text-sm font-semibold text-ink-900 break-all mt-0.5">
            {user?.email ?? "Unknown"}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-4 h-10 px-4 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-100 inline-flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" strokeWidth={2} />
            Sign out
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-4 mb-3.5">
      <h2 className="text-[13px] font-semibold text-ink-700 tracking-[0.2px] px-1 pb-2 flex items-center gap-1.5">
        <span className="text-ink-500">{icon}</span>
        {label}
      </h2>
      {children}
    </section>
  );
}
