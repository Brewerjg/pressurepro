// Capture a before/after photo pair, attach it to a property, push to Supabase.
//
// Flow:
//   1. Operator picks a property (or it's prefilled via ?property_id=).
//   2. Tap "Before" → capturePhoto() (native camera or web file input).
//   3. Tap "After" → same.
//   4. Save → compress + EXIF-strip both, generate thumbnails, upload to the
//      `job-photos` bucket, insert a row in `photo_pairs`.
//
// The `photo_pairs` schema is shared with PressurePro (see types.ts).
// Route-stop linkage lets stops display attached pairs.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save, ShieldCheck, MapPin, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { capturePhoto } from "@/lib/devicePhoto";
import { compressImage, makeThumb, stripExif } from "@/lib/photo";
import { PhotoSlot } from "@/components/photos/PhotoSlot";
import { APP_ID } from "@/lib/app-context";

interface PropertyOption {
  id: string;
  address: string;
  customer_id: string;
  customer_name?: string;
}

interface CapturedFile {
  file: File;
  previewUrl: string;
}

export default function NewPhotoPair() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();

  const initialPropertyId = params.get("property_id") || "";
  // route_stop_id arrives when the operator captures from RouteMode and lets
  // the stop link back to its attached pairs.
  const routeStopId = params.get("route_stop_id") || null;

  const [propertyId, setPropertyId] = useState<string>(initialPropertyId);
  const [before, setBefore] = useState<CapturedFile | null>(null);
  const [after, setAfter] = useState<CapturedFile | null>(null);
  const [active, setActive] = useState<"before" | "after">("before");
  const [processing, setProcessing] = useState<"before" | "after" | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Recent properties for the picker. We pull a generous chunk and order by
  // most-recent — most operators will see their pick at the top.
  const { data: properties } = useQuery({
    queryKey: ["photo-pair-properties"],
    queryFn: async (): Promise<PropertyOption[]> => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address, customer_id, customers(name)")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        address: p.address,
        customer_id: p.customer_id,
        customer_name:
          ((p as { customers?: { name: string } | null }).customers?.name) ?? undefined,
      }));
    },
  });

  const selectedProperty = useMemo(
    () => properties?.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );

  // Clean up object URLs when a capture is replaced or the component unmounts.
  useEffect(() => {
    return () => {
      if (before) URL.revokeObjectURL(before.previewUrl);
      if (after) URL.revokeObjectURL(after.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCapture = async (which: "before" | "after") => {
    setError(null);
    setProcessing(which);
    try {
      const file = await capturePhoto();
      if (!file) {
        setProcessing(null);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      const captured: CapturedFile = { file, previewUrl };
      if (which === "before") {
        if (before) URL.revokeObjectURL(before.previewUrl);
        setBefore(captured);
        if (!after) setActive("after");
      } else {
        if (after) URL.revokeObjectURL(after.previewUrl);
        setAfter(captured);
      }
    } catch (err) {
      const msg = (err as Error).message ?? "Couldn't capture photo";
      if (msg.toLowerCase().includes("denied")) {
        setError("Camera access denied. Enable it in your device settings.");
      } else {
        setError("Couldn't capture photo. Try again.");
      }
    } finally {
      setProcessing(null);
    }
  };

  const savePair = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!propertyId) throw new Error("Pick a property first");
      if (!before && !after) throw new Error("Capture at least one photo");

      // Generate the row id up-front so storage paths can include it before
      // the row exists. crypto.randomUUID is broadly supported in modern
      // browsers + iOS/Android WebViews.
      const pairId = crypto.randomUUID();
      const folder = `${user.id}/${pairId}`;

      let before_path: string | null = null;
      let after_path: string | null = null;
      let thumb_before_path: string | null = null;
      let thumb_after_path: string | null = null;

      if (before) {
        const compressed = await stripExif(await compressImage(before.file));
        const thumb = await makeThumb(compressed);
        const fullPath = `${folder}/before.jpg`;
        const thumbPath = `${folder}/before-thumb.jpg`;
        const u1 = await supabase.storage
          .from("job-photos")
          .upload(fullPath, compressed, { contentType: "image/jpeg", upsert: true });
        if (u1.error) throw u1.error;
        const u2 = await supabase.storage
          .from("job-photos")
          .upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
        if (u2.error) throw u2.error;
        before_path = fullPath;
        thumb_before_path = thumbPath;
      }
      if (after) {
        const compressed = await stripExif(await compressImage(after.file));
        const thumb = await makeThumb(compressed);
        const fullPath = `${folder}/after.jpg`;
        const thumbPath = `${folder}/after-thumb.jpg`;
        const u1 = await supabase.storage
          .from("job-photos")
          .upload(fullPath, compressed, { contentType: "image/jpeg", upsert: true });
        if (u1.error) throw u1.error;
        const u2 = await supabase.storage
          .from("job-photos")
          .upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
        if (u2.error) throw u2.error;
        after_path = fullPath;
        thumb_after_path = thumbPath;
      }

      const prop = properties?.find((p) => p.id === propertyId);

      // route_stop_id / notes / public_gallery added in 0010_photo_pairs_lawn.sql
      const { data, error } = await (supabase as any)
        .from("photo_pairs")
        .insert({
          id: pairId,
          user_id: user.id,
          customer_id: prop?.customer_id ?? null,
          property_id: propertyId,
          address: prop?.address ?? null,
          before_path,
          after_path,
          thumb_before_path,
          thumb_after_path,
          route_stop_id: routeStopId,
          notes: notes.trim() || null,
          app: APP_ID,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      navigate(`/photos/${id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const canSave = !!propertyId && (!!before || !!after) && !savePair.isPending;

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-ink-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-bronze-600">
          Capture
        </div>
        <h1 className="tp-display text-[24px] font-bold text-ink-900 mt-0.5 leading-tight">
          Photo pair
        </h1>
        <p className="text-xs text-ink-500 mt-1">
          Before / after — damage docs, baselines, social proof.
        </p>
      </header>

      <section className="mx-4 space-y-3">
        {/* Property picker */}
        <div className="tp-card p-4 space-y-2.5">
          <SectionLabel>Property</SectionLabel>
          {selectedProperty ? (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-green-800 shrink-0" strokeWidth={2.2} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-ink-900 truncate">
                  {selectedProperty.address}
                </div>
                {selectedProperty.customer_name && (
                  <div className="text-[11px] text-ink-500 truncate">
                    For {selectedProperty.customer_name}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <MapPin className="h-4 w-4 text-ink-400" />
              No property selected
            </div>
          )}
          <div className="relative">
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="w-full h-11 pl-3 pr-9 rounded-xl border-[1.5px] border-ink-200 bg-card text-sm font-medium outline-none focus:border-green-800 transition-colors appearance-none"
            >
              <option value="">— Pick a property —</option>
              {(properties ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                  {p.customer_name ? ` · ${p.customer_name}` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
          </div>
        </div>

        {/* Before · after */}
        <div className="tp-card p-4">
          <SectionLabel accent="green">Before · after</SectionLabel>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <PhotoSlot
              label="Before"
              previewUrl={before?.previewUrl ?? null}
              active={active === "before"}
              processing={processing === "before"}
              onCapture={() => handleCapture("before")}
            />
            <PhotoSlot
              label="After"
              previewUrl={after?.previewUrl ?? null}
              active={active === "after"}
              processing={processing === "after"}
              onCapture={() => handleCapture("after")}
            />
          </div>
        </div>

        {/* Notes */}
        <div className="tp-card p-4 space-y-2">
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Dog hole noted on west fence prior to first visit"
            rows={3}
            className="w-full px-3 py-2 rounded-xl border-[1.5px] border-ink-200 bg-card text-sm font-medium outline-none focus:border-green-800 transition-colors resize-none"
          />
          <div className="text-[11px] text-ink-500 inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            EXIF stripped automatically — no GPS leaks
          </div>
        </div>

        {error && (
          <div className="tp-card p-3 text-xs font-semibold text-destructive">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Link
            to="/photos"
            className="flex-1 h-12 rounded-[14px] bg-ink-100 text-ink-700 font-bold text-sm flex items-center justify-center"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => savePair.mutate()}
            disabled={!canSave}
            className="flex-[2] h-12 rounded-[14px] bg-bronze-500 text-white font-bold text-sm shadow-bronze hover:bg-bronze-600 disabled:opacity-50 disabled:shadow-none inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Save className="h-4 w-4" />
            {savePair.isPending ? "Saving…" : "Save pair"}
          </button>
        </div>
      </section>

      <div className="h-6" />
    </div>
  );
}

function SectionLabel({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: "green" | "bronze";
}) {
  const tone =
    accent === "green"
      ? "text-green-800"
      : accent === "bronze"
      ? "text-bronze-600"
      : "text-ink-500";
  return (
    <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${tone}`}>
      {children}
    </div>
  );
}
