import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Leaf,
  Loader2,
  SkipForward,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { seedDefaultLawnCatalog } from "@/components/onboarding/seedCatalog";
import {
  refreshConnectStatus,
  startConnectOnboarding,
} from "@/lib/connect-onboarding";

// First-run wizard. Five steps; stepper at top; "Skip for now" anywhere bails
// out but still stamps profiles.onboarded_at so the gate doesn't re-fire (we'd
// rather let an operator escape than trap them on a screen they don't want).
// Note: skipping at Step 5 still stamps onboarded_at — the operator just
// isn't Connect-ready yet, which they can finish from Settings later.
//
// Why zip is the only required field in Step 1: it unblocks the live weather
// strip on Home, which is the highest-perceived-value surface for a fresh
// account. Business name is required so the eventual proposal/portal pages
// have something to render; everything else is optional and editable later in
// Settings.
//
// State is held locally in this single component to keep the wizard cohesive.
// Each step submits to Supabase and advances; on the final step we stamp
// onboarded_at and navigate to Home.

// Five steps: business → crews → catalog → first customer → Stripe Connect.
// Step 5 lives between "first customer" and the actual finish/navigate so
// operators can immediately accept Connect-routed payments. Skipping Step 5
// is fine — they can connect later from Settings. The wizard's final
// onboarded_at stamp happens AFTER Step 5 regardless of whether they
// connected or skipped, so the post-signup gate doesn't re-fire either way.
const TOTAL_STEPS = 5;
const MAX_CREWS = 3;

const CREW_COLORS = [
  "#1f7a44", // green-800
  "#b08236", // bronze-600
  "#3b6fb0", // blue
  "#a23c5b", // wine
  "#5b6b3a", // olive
  "#7a4b1f", // brown
  "#3a6b6b", // teal
  "#6b3a6b", // purple
];

const SEED_PREVIEW: ReadonlyArray<{ name: string; price: string }> = [
  { name: "Weekly mow", price: "$45" },
  { name: "Biweekly mow", price: "$55" },
  { name: "Spring cleanup", price: "$175" },
  { name: "Aeration", price: "$125" },
  { name: "Fert step 1 (pre-emergent)", price: "$85" },
  { name: "+ 17 more (cleanups, fert, snow…)", price: "" },
];

type Step = 1 | 2 | 3 | 4 | 5;

// Step 5 sub-state. When the wizard mounts at /onboarding?connect=return
// we kick off a refresh_status call; the result determines what the
// operator sees on Step 5 rather than restarting them at Step 1.
type ConnectStatus = "idle" | "checking" | "ready" | "incomplete" | "error";

type CrewDraft = { name: string; color: string };

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [yourName, setYourName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState("");

  // Step 2 state — pre-fill the first crew name from the user's email handle.
  const defaultCrewName = useMemo(() => {
    const handle = user?.email?.split("@")[0] ?? "";
    if (!handle) return "";
    return handle.charAt(0).toUpperCase() + handle.slice(1);
  }, [user?.email]);

  const [crews, setCrews] = useState<CrewDraft[]>(() => [
    { name: "", color: CREW_COLORS[0] },
  ]);
  // Lazy-initialise the first crew name when the user resolves. Email may not
  // be ready on first render if the auth session is rehydrating, so we patch
  // it in via effect once and only if the operator hasn't typed anything.
  useEffect(() => {
    if (!defaultCrewName) return;
    setCrews((prev) => {
      if (prev.length !== 1 || prev[0].name !== "") return prev;
      return [{ name: defaultCrewName, color: prev[0].color }];
    });
  }, [defaultCrewName]);

  // Step 4 state
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");

  // Step 5 state — Stripe Connect onboarding status. Drives whether we
  // render the "Connect Stripe" CTA, a "checking…" spinner, or a
  // "Connected ✓" success card.
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("idle");
  const [connectStarting, setConnectStarting] = useState(false);

  // Errors per step (we surface a single inline message instead of toasting).
  const [error, setError] = useState<string | null>(null);

  // Detect ?connect=return on mount. Stripe bounces the operator back here
  // with that query param after the hosted form completes (success OR
  // user-abandoned-with-back-button). We jump straight to Step 5 and call
  // refresh_status — DON'T restart the wizard from Step 1, that would be
  // infuriating after the operator just spent 2 minutes in Stripe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const connectParam = search.get("connect");
    if (connectParam !== "return") return;
    setStep(5);
    setConnectStatus("checking");
    refreshConnectStatus()
      .then((res) => {
        setConnectStatus(res.ready ? "ready" : "incomplete");
        queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      })
      .catch((err) => {
        console.error("refreshConnectStatus failed", err);
        setConnectStatus("error");
        setError(
          err instanceof Error ? err.message : "Could not verify Stripe status",
        );
      });
    // Strip the query so a refresh of the page doesn't re-trigger the check
    // (and so the next "Connect Stripe" click mints a fresh AccountLink).
    const url = new URL(window.location.href);
    url.searchParams.delete("connect");
    window.history.replaceState({}, "", url.toString());
    // We only run this once on mount — react-query handles its own keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Mutations -----------------------------------------------------------

  // Profile upsert — used by Step 1 (real data) AND by "Skip for now" (so we
  // can stamp onboarded_at even if no profile row exists yet).
  const upsertProfile = async (
    patch: Partial<{
      business_name: string | null;
      phone: string | null;
      zip: string | null;
      onboarded_at: string | null;
      is_demo?: boolean;
    }>,
  ) => {
    if (!user) throw new Error("Not signed in");

    // CRITICAL: Always ensure is_demo is false for regular onboarding
    const profileData = {
      ...patch,
      is_demo: false  // Force false - never trust input for this field
    };

    console.log("Saving profile for user:", user.id);
    console.log("Profile data:", profileData);

    // Strategy: Try updating BOTH column types first (PressurePro uses user_id, TurfPro uses id)
    // Only try insert if neither update finds a row

    // Try update with id column first (TurfPro style)
    const { data: updatedById, error: updateByIdErr } = await supabase
      .from("profiles")
      .update(profileData)
      .eq("id", user.id)
      .select()
      .maybeSingle();

    if (updatedById) {
      console.log("✅ Updated existing profile using id column");
      return;
    }

    // Try update with user_id column (PressurePro style)
    const { data: updatedByUserId, error: updateByUserIdErr } = await supabase
      .from("profiles")
      .update(profileData)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

    if (updatedByUserId) {
      console.log("✅ Updated existing profile using user_id column (PressurePro)");
      return;
    }

    // If both updates found no rows (PGRST116 = no rows returned), try insert
    const noRowsById = !updateByIdErr || updateByIdErr.code === 'PGRST116';
    const noRowsByUserId = !updateByUserIdErr || updateByUserIdErr.code === 'PGRST116';

    if (noRowsById && noRowsByUserId) {
      // No profile exists, create new one with both columns
      const { data: inserted, error: insertErr } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          user_id: user.id,  // Include both columns for compatibility
          ...profileData
        })
        .select()
        .maybeSingle();

      if (inserted) {
        console.log("✅ Created new profile");
        return;
      }

      // If insert failed with duplicate, there's an RLS issue
      if (insertErr?.code === '23505') {
        console.error("❌ Profile exists but cannot be updated - RLS policy issue");
        console.error("Please run the SQL fix in your Supabase dashboard");
        throw new Error("Profile exists but cannot be updated. Please run the database fix SQL in your Supabase dashboard.");
      }

      if (insertErr) {
        console.error("Insert error:", insertErr);
        throw insertErr;
      }
    }

    // One of the updates had a real error (not just "no rows")
    const realError = updateByIdErr?.code !== 'PGRST116' ? updateByIdErr : updateByUserIdErr;
    console.error("Profile update error:", realError);
    throw new Error(`Profile update failed: ${realError?.message || 'Unknown error'}`);
  };

  const step1Mutation = useMutation({
    mutationFn: async () => {
      const userName = yourName.trim();
      const bizName = businessName.trim();
      const z = zip.trim();
      if (!userName) throw new Error("Your name is required");
      if (!bizName) throw new Error("Business name is required");
      if (!z) throw new Error("ZIP is required to enable the forecast");
      await upsertProfile({
        name: userName,
        business_name: bizName,
        phone: phone.trim() || null,
        zip: z,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      setError(null);
      setStep(2);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save"),
  });

  const step2Mutation = useMutation({
    mutationFn: async (rows: CrewDraft[]) => {
      if (!user) throw new Error("Not signed in");
      const cleaned = rows
        .map((c) => ({ name: c.name.trim(), color: c.color }))
        .filter((c) => c.name.length > 0);
      if (cleaned.length === 0) throw new Error("Add at least one crew, or use “I work solo”");
      const payload = cleaned.map((c) => ({
        user_id: user.id,
        name: c.name,
        color: c.color,
      }));
      const { error } = await supabase.from("crews").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crews", user?.id] });
      setError(null);
      setStep(3);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save"),
  });

  const soloMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("crews").insert({
        user_id: user.id,
        name: "Solo",
        color: CREW_COLORS[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crews", user?.id] });
      setError(null);
      setStep(3);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save"),
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await seedDefaultLawnCatalog(user.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog_items", user?.id] });
      setError(null);
      setStep(4);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't seed catalog"),
  });

  // Step 4 — optional customer + property insert, then ADVANCE to Step 5
  // (Stripe Connect). We do NOT stamp onboarded_at here; that happens in
  // completeMutation once the operator either connects or skips Step 5.
  // This keeps the gate logic simple: onboarded_at is the single signal,
  // set exactly once per wizard run.
  const step4Mutation = useMutation({
    mutationFn: async (opts: { insertCustomer: boolean }) => {
      if (!user) throw new Error("Not signed in");
      if (opts.insertCustomer) {
        const name = custName.trim();
        const address = custAddress.trim();
        if (!name || !address) {
          throw new Error("Name and address are both required to add a customer");
        }
        const { data: cust, error: custErr } = await supabase
          .from("customers")
          .insert({
            user_id: user.id,
            name,
            phone: custPhone.trim() || null,
            primary_address: address,
          })
          .select("id")
          .single();
        if (custErr) throw custErr;
        if (cust) {
          const { error: propErr } = await supabase.from("properties").insert({
            user_id: user.id,
            customer_id: cust.id,
            address,
          });
          if (propErr) throw propErr;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", user?.id] });
      setError(null);
      setStep(5);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save customer"),
  });

  // Final stamp at the end of Step 5. Whether the operator connected
  // Stripe or skipped, we set onboarded_at so the post-signup gate
  // doesn't re-fire. is_demo stays false (same invariant as Step 4).
  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await upsertProfile({
        onboarded_at: new Date().toISOString(),
        is_demo: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-onboarded", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      setError(null);
      navigate("/", { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't finish"),
  });

  // "Skip for now" — stamps onboarded_at no matter the step. We accept that
  // the operator will land on Home with empty data; the soft-prompt UX on
  // Home (Set ZIP in Settings) covers them, and Settings is reachable.
  const skipMutation = useMutation({
    mutationFn: async () => {
      console.log("🔵 Skip button clicked - marking onboarding as complete");
      // CRITICAL: Ensure is_demo is false when skipping onboarding
      await upsertProfile({
        onboarded_at: new Date().toISOString(),
        is_demo: false
      });
      console.log("🔵 Profile updated with onboarded_at timestamp");
    },
    onSuccess: () => {
      console.log("🔵 Skip successful - clearing cache and navigating to home");
      queryClient.invalidateQueries({ queryKey: ["profile-onboarded", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      navigate("/", { replace: true });
    },
    onError: (err) => {
      console.error("🔴 Skip failed:", err);
      setError(err instanceof Error ? err.message : "Couldn't skip");
    },
  });

  const goBack = () => {
    setError(null);
    if (step > 1) setStep((s) => (s - 1) as Step);
  };

  // ---- Render --------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background grid place-items-start sm:place-items-center px-6 py-8">
      <div className="w-full max-w-md">
        {/* Brand header — mirrors Auth.tsx */}
        <div className="text-center mb-6">
          <div className="tp-display text-[34px] font-bold text-green-800 tracking-tight">
            TurfPro
          </div>
          <p className="text-sm text-ink-500 mt-1">Let's get you set up.</p>
        </div>

        {/* Stepper */}
        <Stepper current={step} />

        {/* Step body */}
        <div className="tp-card p-5 space-y-4">
          {step === 1 && (
            <Step1
              icon={<Leaf className="h-5 w-5 text-green-700" strokeWidth={2} />}
              title="Your business"
              subtitle="Takes about 2 minutes. We'll show your local 7-day forecast next."
              yourName={yourName}
              setYourName={setYourName}
              businessName={businessName}
              setBusinessName={setBusinessName}
              phone={phone}
              setPhone={setPhone}
              zip={zip}
              setZip={setZip}
              submitting={step1Mutation.isPending}
              onSubmit={() => step1Mutation.mutate()}
            />
          )}

          {step === 2 && (
            <Step2
              icon={<Users className="h-5 w-5 text-green-700" strokeWidth={2} />}
              title="Who's running routes?"
              subtitle="Color-code your crews so the schedule shows who's where."
              crews={crews}
              setCrews={setCrews}
              submitting={step2Mutation.isPending || soloMutation.isPending}
              onSubmit={() => step2Mutation.mutate(crews)}
              onSolo={() => soloMutation.mutate()}
              onBack={goBack}
            />
          )}

          {step === 3 && (
            <Step3
              icon={<Wrench className="h-5 w-5 text-green-700" strokeWidth={2} />}
              title="Lawn services catalog"
              subtitle="Want us to drop in the standard lawn-care services? You can edit them anytime."
              submitting={seedMutation.isPending}
              onSeed={() => seedMutation.mutate()}
              onSkip={() => {
                setError(null);
                setStep(4);
              }}
              onBack={goBack}
            />
          )}

          {step === 4 && (
            <Step4
              icon={<Sparkles className="h-5 w-5 text-green-700" strokeWidth={2} />}
              title="Add your first customer"
              subtitle="Optional — you can do this from the Customers tab later."
              custName={custName}
              setCustName={setCustName}
              custPhone={custPhone}
              setCustPhone={setCustPhone}
              custAddress={custAddress}
              setCustAddress={setCustAddress}
              submitting={step4Mutation.isPending}
              onContinue={(insertCustomer) =>
                step4Mutation.mutate({ insertCustomer })
              }
              onBack={goBack}
            />
          )}

          {step === 5 && (
            <Step5
              icon={<CreditCard className="h-5 w-5 text-green-700" strokeWidth={2} />}
              status={connectStatus}
              starting={connectStarting}
              finishing={completeMutation.isPending}
              onConnect={async () => {
                setError(null);
                setConnectStarting(true);
                try {
                  // Redirects the browser to Stripe. On success Stripe
                  // bounces back to /onboarding?connect=return which the
                  // mount effect picks up and re-runs refresh_status.
                  await startConnectOnboarding();
                } catch (err) {
                  console.error(err);
                  setConnectStarting(false);
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Could not start Stripe Connect",
                  );
                }
              }}
              onFinish={() => completeMutation.mutate()}
              onBack={goBack}
            />
          )}

          {error && (
            <p className="text-[12px] font-semibold text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
        </div>

        {/* Footer: skip-for-now bail-out */}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => skipMutation.mutate()}
            disabled={skipMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-700 disabled:opacity-60"
          >
            {skipMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <SkipForward className="h-3 w-3" />
            )}
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Stepper --------------------------------------------------------------

function Stepper({ current }: { current: Step }) {
  // Connector width tightens at 5 steps so the row still centers cleanly
  // inside the max-w-md card on a 360px-wide phone (5 × 28px dots + 4
  // connectors). The gap shrinks in lockstep so the visual rhythm stays
  // consistent with the original 4-step layout.
  const connectorWidth = TOTAL_STEPS >= 5 ? "w-4" : "w-6";
  const rowGap = TOTAL_STEPS >= 5 ? "gap-1.5" : "gap-2";
  return (
    <div
      className={cn("flex items-center justify-center mb-4", rowGap)}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
    >
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => {
        const isDone = n < current;
        const isCurrent = n === current;
        return (
          <div key={n} className={cn("flex items-center", rowGap)}>
            <div
              className={cn(
                "h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold transition-colors",
                isDone && "bg-green-700 text-white",
                isCurrent && "bg-green-800 text-white shadow-bronze",
                !isDone && !isCurrent && "bg-ink-100 text-ink-500",
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : n}
            </div>
            {n < TOTAL_STEPS && (
              <div
                className={cn(
                  "h-px transition-colors",
                  connectorWidth,
                  isDone ? "bg-green-700" : "bg-ink-200",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- Step 1: Business profile ---------------------------------------------

function Step1(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  yourName: string;
  setYourName: (v: string) => void;
  businessName: string;
  setBusinessName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  zip: string;
  setZip: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit();
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <StepHeader icon={props.icon} title={props.title} subtitle={props.subtitle} />

      <FieldLabel htmlFor="ob-name">Your name</FieldLabel>
      <input
        id="ob-name"
        required
        value={props.yourName}
        onChange={(e) => props.setYourName(e.target.value)}
        placeholder="John Smith"
        className={inputCls}
      />

      <FieldLabel htmlFor="ob-business">Business name</FieldLabel>
      <input
        id="ob-business"
        required
        value={props.businessName}
        onChange={(e) => props.setBusinessName(e.target.value)}
        placeholder="Acme Lawn Care"
        className={inputCls}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="ob-phone">Phone</FieldLabel>
          <input
            id="ob-phone"
            value={props.phone}
            onChange={(e) => props.setPhone(e.target.value)}
            placeholder="555-123-4567"
            inputMode="tel"
            className={inputCls}
          />
        </div>
        <div>
          <FieldLabel htmlFor="ob-zip">ZIP *</FieldLabel>
          <input
            id="ob-zip"
            required
            value={props.zip}
            onChange={(e) => props.setZip(e.target.value)}
            placeholder="12345"
            inputMode="numeric"
            className={inputCls}
          />
        </div>
      </div>

      <PrimaryButton submitting={props.submitting} type="submit">
        Continue
        <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
      </PrimaryButton>
    </form>
  );
}

// ---- Step 2: Crews --------------------------------------------------------

function Step2(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  crews: CrewDraft[];
  setCrews: (next: CrewDraft[]) => void;
  submitting: boolean;
  onSubmit: () => void;
  onSolo: () => void;
  onBack: () => void;
}) {
  const { crews, setCrews } = props;

  const patchCrew = (idx: number, patch: Partial<CrewDraft>) => {
    setCrews(crews.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const addCrew = () => {
    if (crews.length >= MAX_CREWS) return;
    // Cycle the next color from the palette so adjacent crews look distinct.
    const used = new Set(crews.map((c) => c.color));
    const next = CREW_COLORS.find((c) => !used.has(c)) ?? CREW_COLORS[crews.length % CREW_COLORS.length];
    setCrews([...crews, { name: "", color: next }]);
  };

  const removeCrew = (idx: number) => {
    if (crews.length === 1) return;
    setCrews(crews.filter((_, i) => i !== idx));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <StepHeader icon={props.icon} title={props.title} subtitle={props.subtitle} />

      <div className="space-y-2">
        {crews.map((crew, idx) => (
          <CrewRow
            key={idx}
            crew={crew}
            canRemove={crews.length > 1}
            onPatch={(patch) => patchCrew(idx, patch)}
            onRemove={() => removeCrew(idx)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addCrew}
          disabled={crews.length >= MAX_CREWS}
          className="text-[12px] font-semibold text-green-800 hover:text-green-900 disabled:opacity-40"
        >
          + Add another crew
        </button>
        <span className="text-[11px] text-ink-400">
          ({crews.length}/{MAX_CREWS})
        </span>
      </div>

      <button
        type="button"
        onClick={props.onSolo}
        disabled={props.submitting}
        className="w-full h-10 rounded-xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60"
      >
        I work solo
      </button>

      <div className="flex gap-2 pt-1">
        <BackButton onClick={props.onBack} />
        <PrimaryButton submitting={props.submitting} type="submit">
          Continue
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </PrimaryButton>
      </div>
    </form>
  );
}

function CrewRow({
  crew,
  canRemove,
  onPatch,
  onRemove,
}: {
  crew: CrewDraft;
  canRemove: boolean;
  onPatch: (patch: Partial<CrewDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1 shrink-0">
        {CREW_COLORS.slice(0, 4).map((c) => (
          <ColorSwatch
            key={c}
            color={c}
            selected={crew.color === c}
            onClick={() => onPatch({ color: c })}
          />
        ))}
      </div>
      <input
        value={crew.name}
        onChange={(e) => onPatch({ name: e.target.value })}
        placeholder="Crew name"
        className={cn(inputCls, "h-9 flex-1")}
      />
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-ink-500 hover:text-destructive shrink-0"
          aria-label="Remove crew"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function ColorSwatch({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Color ${color}`}
      aria-pressed={selected}
      className={cn(
        "h-7 w-7 rounded-full transition-transform",
        selected && "ring-2 ring-offset-1 ring-green-700 scale-110",
      )}
      style={{ backgroundColor: color }}
    />
  );
}

// ---- Step 3: Seed catalog --------------------------------------------------

function Step3(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  submitting: boolean;
  onSeed: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3.5">
      <StepHeader icon={props.icon} title={props.title} subtitle={props.subtitle} />

      <ul className="rounded-xl bg-green-50/60 border border-green-700/20 p-3 space-y-1.5">
        {SEED_PREVIEW.map((row) => (
          <li
            key={row.name}
            className="flex items-center justify-between text-[12.5px] text-ink-700"
          >
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-green-700" />
              {row.name}
            </span>
            {row.price && (
              <span className="tp-num font-semibold text-ink-900">{row.price}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2 pt-1">
        <BackButton onClick={props.onBack} />
        <button
          type="button"
          onClick={props.onSkip}
          disabled={props.submitting}
          className="flex-1 h-11 rounded-2xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60"
        >
          I'll add my own
        </button>
      </div>

      <PrimaryButton submitting={props.submitting} type="button" onClick={props.onSeed}>
        <Sparkles className="h-4 w-4" strokeWidth={2.2} />
        Yes, seed it
      </PrimaryButton>
    </div>
  );
}

// ---- Step 4: First customer ------------------------------------------------

function Step4(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  custName: string;
  setCustName: (v: string) => void;
  custPhone: string;
  setCustPhone: (v: string) => void;
  custAddress: string;
  setCustAddress: (v: string) => void;
  submitting: boolean;
  onContinue: (insertCustomer: boolean) => void;
  onBack: () => void;
}) {
  const hasData =
    props.custName.trim().length > 0 && props.custAddress.trim().length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    props.onContinue(true);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <StepHeader icon={props.icon} title={props.title} subtitle={props.subtitle} />

      <FieldLabel htmlFor="ob-cname">Customer name</FieldLabel>
      <input
        id="ob-cname"
        value={props.custName}
        onChange={(e) => props.setCustName(e.target.value)}
        placeholder="Jane Smith"
        className={inputCls}
      />

      <FieldLabel htmlFor="ob-cphone">Phone</FieldLabel>
      <input
        id="ob-cphone"
        value={props.custPhone}
        onChange={(e) => props.setCustPhone(e.target.value)}
        placeholder="555-123-4567"
        inputMode="tel"
        className={inputCls}
      />

      <FieldLabel htmlFor="ob-caddr">Address</FieldLabel>
      <input
        id="ob-caddr"
        value={props.custAddress}
        onChange={(e) => props.setCustAddress(e.target.value)}
        placeholder="411 Lantana Ave"
        className={inputCls}
      />

      <div className="flex gap-2 pt-1">
        <BackButton onClick={props.onBack} />
        <button
          type="button"
          onClick={() => props.onContinue(false)}
          disabled={props.submitting}
          className="flex-1 h-11 rounded-2xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60"
        >
          Skip
        </button>
      </div>

      <PrimaryButton submitting={props.submitting} type="submit" disabled={!hasData}>
        <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        Continue
      </PrimaryButton>
    </form>
  );
}

// ---- Step 5: Stripe Connect payouts ----------------------------------------

function Step5(props: {
  icon: React.ReactNode;
  status: ConnectStatus;
  starting: boolean;
  finishing: boolean;
  onConnect: () => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const { status } = props;
  const isReady = status === "ready";
  const isChecking = status === "checking";
  const isIncomplete = status === "incomplete";

  return (
    <div className="space-y-3.5">
      <StepHeader
        icon={props.icon}
        title="Connect your payouts"
        subtitle="TurfPro charges your customers and deposits the money in your bank account. Connect Stripe once — takes about 2 minutes."
      />

      {isChecking && (
        <div className="rounded-xl border border-ink-200 bg-ink-100/40 p-3 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-ink-500" />
          <span className="text-[12.5px] text-ink-700">
            Checking your Stripe account…
          </span>
        </div>
      )}

      {isReady && (
        <div className="rounded-xl border border-green-700/30 bg-green-50/60 p-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-green-700" strokeWidth={2.6} />
          <span className="text-[12.5px] font-semibold text-green-800">
            Connected ✓ — payouts will flow to your Stripe account.
          </span>
        </div>
      )}

      {isIncomplete && (
        <div className="rounded-xl border border-bronze-500/30 bg-bronze-100/40 p-3">
          <div className="text-[12.5px] font-semibold text-bronze-700">
            Almost there — Stripe needs more info.
          </div>
          <div className="text-[11.5px] text-ink-600 mt-0.5 leading-snug">
            Tap "Connect Stripe" to finish the remaining fields.
          </div>
        </div>
      )}

      {!isReady && (
        <div className="rounded-xl bg-green-50/60 border border-green-700/20 p-3 space-y-1.5">
          <div className="text-[12.5px] text-ink-700 leading-snug">
            On the <span className="font-semibold">Base</span> plan,
            we take 2% per payment. On Solo / Crew, you keep
            <span className="font-semibold"> 100%</span> of payments.
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <BackButton onClick={props.onBack} />
        {!isReady && (
          <button
            type="button"
            onClick={props.onFinish}
            disabled={props.finishing || props.starting}
            className="flex-1 h-11 rounded-2xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60"
          >
            {props.finishing ? (
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            ) : (
              "Skip — I'll do this later"
            )}
          </button>
        )}
      </div>

      {isReady ? (
        <PrimaryButton
          submitting={props.finishing}
          type="button"
          onClick={props.onFinish}
        >
          <Check className="h-4 w-4" strokeWidth={2.4} />
          Finish setup
        </PrimaryButton>
      ) : (
        <PrimaryButton
          submitting={props.starting || isChecking}
          type="button"
          onClick={props.onConnect}
        >
          <CreditCard className="h-4 w-4" strokeWidth={2.2} />
          {isIncomplete ? "Finish Stripe setup" : "Connect Stripe"}
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </PrimaryButton>
      )}
    </div>
  );
}

// ---- Shared bits -----------------------------------------------------------

function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-9 w-9 rounded-xl bg-green-50 grid place-items-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="tp-display text-[18px] font-bold text-ink-900 leading-tight">
          {title}
        </h2>
        <p className="text-[12.5px] text-ink-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] font-bold uppercase tracking-wider text-ink-500"
    >
      {children}
    </label>
  );
}

function PrimaryButton({
  submitting,
  disabled,
  type,
  onClick,
  children,
}: {
  submitting: boolean;
  disabled?: boolean;
  type: "button" | "submit";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={submitting || disabled}
      className="w-full h-12 rounded-2xl bg-bronze-500 hover:bg-bronze-600 text-white font-bold text-sm shadow-bronze disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-11 px-4 rounded-2xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold flex items-center gap-1.5 hover:bg-ink-50"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
      Back
    </button>
  );
}

const inputCls =
  "mt-1 w-full h-11 rounded-xl border border-ink-200 px-3 bg-card text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-green-700/30 focus:border-green-700";
