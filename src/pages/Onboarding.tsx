import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
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

// First-run wizard. Four steps; stepper at top; "Skip for now" anywhere bails
// out but still stamps profiles.onboarded_at so the gate doesn't re-fire (we'd
// rather let an operator escape than trap them on a screen they don't want).
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

const TOTAL_STEPS = 4;
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

type Step = 1 | 2 | 3 | 4;

type CrewDraft = { name: string; color: string };

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
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

  // Errors per step (we surface a single inline message instead of toasting).
  const [error, setError] = useState<string | null>(null);

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

    // Ensure is_demo is always false for regular users
    const profileData = { ...patch, is_demo: false };

    // Try to update with id column (PressurePro style)
    const { data: updated1, error: updateErr1 } = await supabase
      .from("profiles")
      .update(profileData)
      .eq("id", user.id)
      .select()
      .maybeSingle();

    if (updated1) {
      console.log("Updated profile with id column");
      return; // Success
    }

    // If no row was updated, try inserting a new profile with id
    if (!updated1 && !updateErr1) {
      const { data: inserted1, error: insertErr1 } = await supabase
        .from("profiles")
        .insert({ id: user.id, ...profileData })
        .select()
        .maybeSingle();

      if (inserted1) {
        console.log("Inserted new profile with id column");
        return; // Success
      }

      // If insert failed due to duplicate, it exists but update didn't work
      if (insertErr1?.code === '23505') {
        console.error("Profile exists but couldn't update:", insertErr1);
        throw new Error("Profile exists but couldn't update. Please check database permissions.");
      }
    }

    // If id column doesn't work, try with user_id column (alternative structure)
    const { data: updated2, error: updateErr2 } = await supabase
      .from("profiles")
      .update(profileData)
      .eq("user_id", user.id)
      .select()
      .maybeSingle();

    if (updated2) {
      console.log("Updated profile with user_id column");
      return; // Success
    }

    // Try inserting with user_id
    if (!updated2 && !updateErr2) {
      const { data: inserted2, error: insertErr2 } = await supabase
        .from("profiles")
        .insert({ user_id: user.id, ...profileData })
        .select()
        .maybeSingle();

      if (inserted2) {
        console.log("Inserted new profile with user_id column");
        return; // Success
      }

      if (insertErr2) {
        console.error("Final insert error:", insertErr2);
        throw insertErr2;
      }
    }

    // If we get here, something went wrong
    console.error("Update errors:", { updateErr1, updateErr2 });
    throw new Error("Could not save profile. Please check database structure.");
  };

  const step1Mutation = useMutation({
    mutationFn: async () => {
      const name = businessName.trim();
      const z = zip.trim();
      if (!name) throw new Error("Business name is required");
      if (!z) throw new Error("ZIP is required to enable the forecast");
      await upsertProfile({
        business_name: name,
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

  // Step 4 — optional customer + property insert, then finish.
  const finishMutation = useMutation({
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
      await upsertProfile({ onboarded_at: new Date().toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers", user?.id] });
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
      await upsertProfile({ onboarded_at: new Date().toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-onboarded", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      navigate("/", { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't skip"),
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
              submitting={finishMutation.isPending}
              onFinish={(insertCustomer) =>
                finishMutation.mutate({ insertCustomer })
              }
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
  return (
    <div
      className="flex items-center justify-center gap-2 mb-4"
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={TOTAL_STEPS}
    >
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => {
        const isDone = n < current;
        const isCurrent = n === current;
        return (
          <div key={n} className="flex items-center gap-2">
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
                  "h-px w-6 transition-colors",
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
  onFinish: (insertCustomer: boolean) => void;
  onBack: () => void;
}) {
  const hasData =
    props.custName.trim().length > 0 && props.custAddress.trim().length > 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    props.onFinish(true);
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
          onClick={() => props.onFinish(false)}
          disabled={props.submitting}
          className="flex-1 h-11 rounded-2xl border border-ink-200 bg-card text-ink-700 text-[13px] font-semibold hover:bg-ink-50 disabled:opacity-60"
        >
          Skip
        </button>
      </div>

      <PrimaryButton submitting={props.submitting} type="submit" disabled={!hasData}>
        <Check className="h-4 w-4" strokeWidth={2.4} />
        Finish setup
      </PrimaryButton>
    </form>
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
