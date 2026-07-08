// Public-facing photo gallery for a property — no auth, customer-shareable.
// Shows the before/after photo pairs that the operator has captured. In
// PressurePro this was the "look how clean we got it" surface; in TurfPro
// it's "look how green we got it". The lightbox compares the two photos
// side-by-side rather than the dramatic before/after slider PP used —
// lawn-care before/afters are typically less dramatic but the comparison
// still tells the story.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Share2, X, Leaf } from "lucide-react";
import { BrandHeader } from "@/components/public/BrandHeader";
import { vertical } from "@/vertical";

interface PhotoRow {
  id: string;
  before_path: string | null;
  after_path: string | null;
  thumb_before_path: string | null;
  thumb_after_path: string | null;
  created_at: string;
}

interface Pair {
  id: string;
  before: string;
  after?: string;
  createdAt: string;
}

const Gallery = () => {
  const { propertyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState<{ address: string } | null>(null);
  const [business, setBusiness] = useState<string>("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [lightbox, setLightbox] = useState<Pair | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const [{ data: prop }, { data: photos }] = await Promise.all([
        supabase
          .from("properties")
          .select("address, user_id")
          .eq("id", propertyId)
          .maybeSingle(),
        // route_stop_id / notes / public_gallery added in 0010_photo_pairs_lawn.sql
        // Public lookup by property_id + public_gallery flag — app discriminator intentionally not filtered (see app-context.ts)
        (supabase as any)
          .from("photo_pairs")
          .select(
            "id, before_path, after_path, thumb_before_path, thumb_after_path, created_at",
          )
          .eq("property_id", propertyId)
          .eq("public_gallery", true)
          .order("created_at", { ascending: false }),
      ]);
      if (prop) {
        setProperty({ address: prop.address });
        const { data: prof } = await supabase.rpc("public_business_info", {
          p_user_id: (prop as { user_id: string }).user_id,
        });
        if (prof?.[0]?.business_name) setBusiness(prof[0].business_name);
      }
      const out: Pair[] = [];
      for (const p of (photos ?? []) as PhotoRow[]) {
        // Always serve thumbnails — fall back to the original only for legacy
        // rows that pre-date the thumbnail field.
        const beforeSrc = p.thumb_before_path ?? p.before_path;
        const afterSrc = p.thumb_after_path ?? p.after_path;
        const before = beforeSrc ? await sign(beforeSrc) : "";
        const after = afterSrc ? await sign(afterSrc) : undefined;
        if (before) out.push({ id: p.id, before, after, createdAt: p.created_at });
      }
      setPairs(out);
      setLoading(false);
    })();
  }, [propertyId]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Before / After", url });
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link copied");
      } catch {
        /* noop */
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="text-center max-w-sm">
          <div className="h-12 w-12 mx-auto rounded-full bg-neutral-100 text-neutral-500 flex items-center justify-center">
            <Leaf className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl mt-4">Gallery not found</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This gallery may be private or no longer available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-10">
      <BrandHeader business={business || vertical.brand.fallbackBusinessName}>
        <h1 className="font-display text-[28px] text-white">{property.address}</h1>
        <p className="text-white/75 text-[13px] mt-1.5">
          {pairs.length} before / after pair{pairs.length === 1 ? "" : "s"}
        </p>
        <button
          onClick={share}
          className="mt-4 h-12 px-4 rounded-[14px] bg-accent-500 text-brand-900 font-bold text-sm flex items-center gap-2 shadow-accent"
        >
          <Share2 className="h-4 w-4" /> Share my results
        </button>
      </BrandHeader>

      <main className="max-w-md mx-auto px-4 pt-4 space-y-3 sm:max-w-2xl sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
        {pairs.length === 0 && (
          <div className="tp-card p-8 text-center text-sm text-muted-foreground sm:col-span-2">
            No photos shared yet — check back after your next visit.
          </div>
        )}
        {pairs.map((p) => (
          <article
            key={p.id}
            className="tp-card p-0 overflow-hidden cursor-pointer"
            onClick={() => setLightbox(p)}
          >
            <div className="grid grid-cols-2 gap-px bg-hairline">
              <figure className="relative bg-card">
                <img
                  src={p.before}
                  alt="Before"
                  className="w-full aspect-[4/5] object-cover"
                />
                <figcaption className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-neutral-900/80 text-white text-[10px] font-bold uppercase tracking-wider">
                  Before
                </figcaption>
              </figure>
              <figure className="relative bg-muted">
                {p.after ? (
                  <img
                    src={p.after}
                    alt="After"
                    className="w-full aspect-[4/5] object-cover"
                  />
                ) : (
                  <div className="aspect-[4/5] flex items-center justify-center text-xs font-bold text-muted-foreground">
                    Pending
                  </div>
                )}
                <figcaption className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-brand-800 text-white text-[10px] font-bold uppercase tracking-wider">
                  After
                </figcaption>
              </figure>
            </div>
            <div className="px-3.5 py-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-[13px] text-neutral-900">{vertical.copy.photoPairLabel}</div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
              <Share2 className="h-4 w-4 text-muted-foreground" />
            </div>
          </article>
        ))}
      </main>

      {/* Footer CTA */}
      <footer className="max-w-md mx-auto px-4 pt-8 pb-2 text-center">
        <div
          className="tp-card p-5"
          style={{ background: "linear-gradient(135deg, hsl(var(--brand-50)), hsl(var(--card)))" }}
        >
          <div className="text-2xl mb-1">🌿</div>
          <div className="font-extrabold text-sm text-neutral-900">
            {vertical.copy.galleryCtaHeadline}
          </div>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            {vertical.copy.galleryCtaBody.replace("{business}", business || "us")}
          </p>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center h-11 px-5 rounded-2xl bg-brand-800 text-white font-bold text-sm"
          >
            Get a quote from {vertical.brand.name}
          </Link>
        </div>
        <p className="text-center text-[11px] text-muted-foreground pt-6 font-mono tracking-[0.08em]">
          {(business || vertical.brand.name).toUpperCase()}
        </p>
      </footer>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-white/70 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                Before
              </div>
              <img
                src={lightbox.before}
                alt="Before"
                className="w-full rounded-xl object-contain max-h-[70vh] bg-black"
              />
            </div>
            <div>
              <div className="text-accent-400 text-[10px] font-bold uppercase tracking-wider mb-1.5">
                After
              </div>
              {lightbox.after ? (
                <img
                  src={lightbox.after}
                  alt="After"
                  className="w-full rounded-xl object-contain max-h-[70vh] bg-black"
                />
              ) : (
                <div className="w-full aspect-[4/5] rounded-xl bg-black/50 flex items-center justify-center text-white/60 text-sm font-bold">
                  Pending
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

async function sign(path: string): Promise<string> {
  const { data } = await supabase.storage
    .from("job-photos")
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? "";
}

export default Gallery;
