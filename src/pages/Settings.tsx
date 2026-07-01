import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Check, ChevronRight, CreditCard, Loader2, Lock, LogOut, Mail, Megaphone, Plug, Settings as SettingsIcon, Snowflake, Users, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import BusinessProfile from "@/components/settings/BusinessProfile";
import CatalogEditor from "@/components/settings/CatalogEditor";
import CrewEditor from "@/components/settings/CrewEditor";
import MessagingPreferences from "@/components/settings/MessagingPreferences";
import SubscriptionCard from "@/components/settings/SubscriptionCard";
import ChangePasswordCard from "@/components/settings/ChangePasswordCard";
import QuickBooksCard from "@/components/settings/QuickBooksCard";
import SeasonToggle from "@/components/season/SeasonToggle";
import {
  isConnectComplete,
  startConnectOnboarding,
  type ConnectableProfile,
} from "@/lib/connect-onboarding";

// Settings — full mobile-first surface. Composed of three editor components
// (Profile / Catalog / Crews) plus a read-only Billing card and an Account
// section that preserves the existing sign-out affordance from the stub.
//
// Stripe-managed billing wires in a later release; for now this page only
// reads the user's subscription row (if any) for transparency. PressurePro's
// surface_pricing / SH cost / gallons-per-sqft controls are intentionally
// skipped — lawn care prices per visit, not per square foot of a surface.

export default function Settings() {
  const { user, signOut } = useAuth();

  // Connect status — pulled straight off the profile row so the section
  // reflects whatever the last `refresh_status` call wrote. We only need
  // two columns; the rest is loaded by BusinessProfile separately.
  const { data: connectProfile } = useQuery({
    queryKey: ["profile-connect", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("stripe_account_id, connect_ready")
        .or(`id.eq.${user!.id},user_id.eq.${user!.id}`)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ConnectableProfile | null;
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

      {/* Stripe payouts — Connect Express onboarding state. Three states:
          1) ready (connect_ready=true) → green "Connected ✓"
          2) incomplete (stripe_account_id set but connect_ready=false) →
             bronze "finish setup" CTA, same edge fn re-mints an
             AccountLink that picks up where Stripe left off
          3) never started (no stripe_account_id) → bronze "set up
             payouts" CTA, mints a brand-new Express account */}
      <Section icon={<Banknote className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Stripe payouts">
        <StripePayoutsCard profile={connectProfile ?? null} />
      </Section>

      {/* Season — winter mode pauses recurring mow plans and pivots the
          Home + Routes screens to a storm-driven snow workflow. */}
      <Section icon={<Snowflake className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Season">
        <SeasonToggle />
      </Section>

      {/* Service catalog */}
      <Section icon={<Wrench className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Service catalog">
        <CatalogEditor />
      </Section>

      {/* Crews */}
      <Section icon={<Users className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Crews">
        <CrewEditor />
      </Section>

      {/* Customer messaging */}
      <Section icon={<Mail className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Customer messaging">
        <MessagingPreferences />
      </Section>

      {/* Campaigns — seasonal email/SMS blasts (aeration, leaf cleanup,
          spring restart). Lives on its own page since the wizard is
          longer than the toggle-and-save Settings idiom. */}
      <Section icon={<Megaphone className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Campaigns">
        <Link
          to="/campaigns"
          className="tp-card p-4 flex items-center gap-3 hover:bg-ink-100/30 transition-colors"
        >
          <span className="h-9 w-9 rounded-lg bg-bronze-100 text-bronze-700 grid place-items-center shrink-0">
            <Megaphone className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-ink-900">
              Seasonal campaigns
            </div>
            <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5">
              Blast aeration, leaf cleanup, spring restart, and snow signup pitches to your filtered customer list.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-ink-400 shrink-0" strokeWidth={2.2} />
        </Link>
      </Section>

      {/* Integrations — accounting/CRM sync. QuickBooks Online is the first:
          the operator connects their QB company here (OAuth2). Invoice/payment
          sync into QuickBooks is a documented Phase 2 (docs/QUICKBOOKS_SETUP.md). */}
      <Section icon={<Plug className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Integrations">
        <QuickBooksCard />
      </Section>

      {/* Billing — subscription management. On native the operator can change
          tier, manage/cancel via the store, and restore purchases; on web the
          card is read-only and points at the mobile app (subscriptions ship
          through the app stores via RevenueCat). */}
      <Section icon={<CreditCard className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Billing">
        <SubscriptionCard />
      </Section>

      {/* Security — change password for the signed-in operator. */}
      <Section icon={<Lock className="h-3.5 w-3.5" strokeWidth={2.2} />} label="Security">
        <ChangePasswordCard />
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

// Stripe Connect Express status card. Three rendering branches based on
// the two profile columns; the bronze button calls the same edge fn in
// every case (the edge fn knows whether to mint vs reuse the account).
function StripePayoutsCard({ profile }: { profile: ConnectableProfile | null }) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = isConnectComplete(profile);
  const startedButIncomplete =
    !ready && !!profile?.stripe_account_id && !profile?.connect_ready;

  const onClick = async () => {
    setErr(null);
    setStarting(true);
    try {
      await startConnectOnboarding();
    } catch (e) {
      setStarting(false);
      setErr(e instanceof Error ? e.message : "Could not start Stripe Connect");
    }
  };

  if (ready) {
    return (
      <div className="tp-card p-4 flex items-center gap-3">
        <span className="h-9 w-9 rounded-lg bg-green-100 text-green-800 grid place-items-center shrink-0">
          <Check className="h-4 w-4" strokeWidth={2.6} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-green-800">
            Connected ✓
          </div>
          <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5">
            Customer payments deposit into your Stripe account.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tp-card p-4 space-y-2.5">
      <div className="flex items-start gap-3">
        <span className="h-9 w-9 rounded-lg bg-bronze-100 text-bronze-700 grid place-items-center shrink-0">
          <CreditCard className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink-900">
            {startedButIncomplete
              ? "Onboarding incomplete"
              : "Not connected"}
          </div>
          <div className="text-[11.5px] text-ink-500 leading-snug mt-0.5">
            {startedButIncomplete
              ? "Stripe still needs a few details before payouts can start."
              : "Connect Stripe to accept customer payments and have them deposited in your bank account."}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={starting}
        className="w-full h-10 rounded-xl bg-bronze-500 hover:bg-bronze-600 text-white font-semibold text-sm shadow-bronze disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {starting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <CreditCard className="h-4 w-4" strokeWidth={2.2} />
            {startedButIncomplete
              ? "Finish setup"
              : "Set up payouts"}
          </>
        )}
      </button>
      {err && (
        <p className="text-[11px] font-semibold text-destructive">{err}</p>
      )}
    </div>
  );
}
