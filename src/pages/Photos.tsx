// List view of all photo pairs the operator has captured. Lawn-care
// before/afters are usually less dramatic than pressure-washing (a freshly
// mown lawn is still a lawn), so the list focuses on context — address +
// date — rather than the visual punch.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, Plus, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PhotoPairRow {
  id: string;
  property_id: string | null;
  address: string | null;
  before_path: string | null;
  after_path: string | null;
  thumb_before_path: string | null;
  thumb_after_path: string | null;
  created_at: string;
}

interface PropertyOption {
  id: string;
  address: string;
}

interface PairView extends PhotoPairRow {
  beforeUrl?: string;
  afterUrl?: string;
}

export default function Photos() {
  const [propertyFilter, setPropertyFilter] = useState<string>("");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Recent properties for the filter dropdown.
  const { data: properties } = useQuery({
    queryKey: ["photos-property-filter"],
    queryFn: async (): Promise<PropertyOption[]> => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PropertyOption[];
    },
  });

  const { data: pairs, isLoading } = useQuery({
    queryKey: ["photo-pairs", propertyFilter],
    queryFn: async (): Promise<PhotoPairRow[]> => {
      // Build the filter step first (eq returns a filter builder), then
      // apply order/limit which produce a transform builder. Doing it in this
      // sequence keeps Supabase's chained types happy.
      const base = supabase
        .from("photo_pairs")
        .select(
          "id, property_id, address, before_path, after_path, thumb_before_path, thumb_after_path, created_at",
        );
      const filtered = propertyFilter ? base.eq("property_id", propertyFilter) : base;
      const { data, error } = await filtered
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as PhotoPairRow[];
    },
  });

  // Resolve thumbnail signed URLs in a batch each time the pair list changes.
  // 1-hour TTL is plenty for a list view; PhotoDetail re-signs as needed.
  useEffect(() => {
    if (!pairs) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        pairs.flatMap((p) => {
          const tasks: Promise<void>[] = [];
          const beforePath = p.thumb_before_path ?? p.before_path;
          const afterPath = p.thumb_after_path ?? p.after_path;
          if (beforePath) {
            tasks.push(
              supabase.storage
                .from("job-photos")
                .createSignedUrl(beforePath, 60 * 60)
                .then(({ data }) => {
                  if (data?.signedUrl) next[`${p.id}:b`] = data.signedUrl;
                }),
            );
          }
          if (afterPath) {
            tasks.push(
              supabase.storage
                .from("job-photos")
                .createSignedUrl(afterPath, 60 * 60)
                .then(({ data }) => {
                  if (data?.signedUrl) next[`${p.id}:a`] = data.signedUrl;
                }),
            );
          }
          return tasks;
        }),
      );
      if (!cancelled) setSignedUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pairs]);

  const view: PairView[] = useMemo(
    () =>
      (pairs ?? []).map((p) => ({
        ...p,
        beforeUrl: signedUrls[`${p.id}:b`],
        afterUrl: signedUrls[`${p.id}:a`],
      })),
    [pairs, signedUrls],
  );

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-[18px] flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-[0.4px] uppercase text-ink-500">
            {pairs?.length ?? 0} pair{(pairs?.length ?? 0) === 1 ? "" : "s"}
          </div>
          <h1 className="tp-display text-2xl font-bold text-ink-900 mt-0.5">
            Photo pairs
          </h1>
        </div>
        <Link
          to="/photos/new"
          className="h-11 w-11 rounded-[14px] bg-bronze-500 text-white flex items-center justify-center shadow-bronze hover:bg-bronze-600 transition-colors"
          aria-label="New pair"
        >
          <Plus className="h-[22px] w-[22px]" strokeWidth={2.4} />
        </Link>
      </header>

      {/* Property filter */}
      <section className="mx-4 pb-3.5">
        <div className="relative">
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="w-full h-11 pl-3 pr-9 rounded-xl border-[1.5px] border-ink-200 bg-card text-sm font-medium outline-none focus:border-green-800 transition-colors appearance-none"
          >
            <option value="">All properties</option>
            {(properties ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
        </div>
      </section>

      {isLoading && (
        <div className="text-sm text-ink-500 text-center py-6">Loading…</div>
      )}

      {!isLoading && view.length === 0 && (
        <section className="mx-4">
          <div className="tp-card p-8 text-center">
            <div className="h-12 w-12 mx-auto rounded-2xl bg-green-100 text-green-800 flex items-center justify-center">
              <Camera className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <h3 className="tp-display text-lg mt-3 text-ink-900">No photos yet</h3>
            <p className="text-sm text-ink-500 mt-1 max-w-[260px] mx-auto">
              Capture a before/after pair from any property — damage docs,
              baselines, social proof.
            </p>
            <Link
              to="/photos/new"
              className="inline-flex items-center gap-1.5 mt-4 bg-bronze-500 text-white px-5 py-2.5 rounded-full font-bold text-sm shadow-bronze hover:bg-bronze-600 transition-colors"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} /> Capture pair
            </Link>
          </div>
        </section>
      )}

      {view.length > 0 && (
        <section className="mx-4">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {view.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/photos/${p.id}`}
                  className="block tp-card p-0 overflow-hidden active:bg-ink-100 transition-colors"
                >
                  <div className="relative grid grid-cols-2 gap-px bg-hairline aspect-[2/1.05]">
                    {p.beforeUrl ? (
                      <img
                        src={p.beforeUrl}
                        alt="Before"
                        className="w-full h-full object-cover bg-ink-100"
                        loading="lazy"
                      />
                    ) : (
                      <div className="bg-ink-100" />
                    )}
                    {p.afterUrl ? (
                      <img
                        src={p.afterUrl}
                        alt="After"
                        className="w-full h-full object-cover bg-ink-100"
                        loading="lazy"
                      />
                    ) : (
                      <div className="bg-ink-100 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-ink-500">
                        + After
                      </div>
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-ink-900/80 text-white text-[9px] font-bold uppercase tracking-wider">
                      Before
                    </span>
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-green-800 text-white text-[9px] font-bold uppercase tracking-wider">
                      After
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="text-[13px] font-bold text-ink-900 truncate">
                      {p.address || "Untitled"}
                    </div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {new Date(p.created_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="h-6" />
    </div>
  );
}
