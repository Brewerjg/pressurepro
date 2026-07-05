// Photo-pair detail: full-resolution before/after, property + customer link,
// notes, delete action. The "Share to gallery" toggle flips
// photo_pairs.public_gallery so the row appears in the public /g/:propertyId
// gallery.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  ExternalLink,
  Eye,
  MapPin,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PhotoPairDetail {
  id: string;
  property_id: string | null;
  customer_id: string | null;
  address: string | null;
  before_path: string | null;
  after_path: string | null;
  thumb_before_path: string | null;
  thumb_after_path: string | null;
  created_at: string;
  customer_name: string | null;
  public_gallery: boolean;
}

export default function PhotoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["photo-pair", id],
    queryFn: async (): Promise<PhotoPairDetail | null> => {
      if (!id) return null;
      // route_stop_id / notes / public_gallery added in 0010_photo_pairs_lawn.sql
      const { data, error } = await (supabase as any)
        .from("photo_pairs")
        .select(
          "id, property_id, customer_id, address, before_path, after_path, thumb_before_path, thumb_after_path, created_at, public_gallery, customers(name)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const customerName =
        ((data as { customers?: { name: string } | null }).customers?.name) ?? null;
      return {
        id: data.id,
        property_id: data.property_id,
        customer_id: data.customer_id,
        address: data.address,
        before_path: data.before_path,
        after_path: data.after_path,
        thumb_before_path: data.thumb_before_path,
        thumb_after_path: data.thumb_after_path,
        created_at: data.created_at,
        customer_name: customerName,
        public_gallery: data.public_gallery === true,
      };
    },
    enabled: !!id,
  });

  const shareToGallery = data?.public_gallery === true;

  const togglePublicGallery = useMutation({
    mutationFn: async (next: boolean) => {
      if (!data) return;
      // route_stop_id / notes / public_gallery added in 0010_photo_pairs_lawn.sql
      const { error } = await (supabase as any)
        .from("photo_pairs")
        .update({ public_gallery: next })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["photo-pair", id] });
      queryClient.invalidateQueries({ queryKey: ["photo-pairs"] });
    },
  });

  // Sign full-resolution URLs for the detail view. Falls back to the thumbnail
  // path if the original isn't there (legacy / thumb-only rows).
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      const beforePath = data.before_path ?? data.thumb_before_path;
      const afterPath = data.after_path ?? data.thumb_after_path;
      const [b, a] = await Promise.all([
        beforePath
          ? supabase.storage.from("job-photos").createSignedUrl(beforePath, 60 * 60)
          : Promise.resolve({ data: null }),
        afterPath
          ? supabase.storage.from("job-photos").createSignedUrl(afterPath, 60 * 60)
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setBeforeUrl(b.data?.signedUrl ?? null);
      setAfterUrl(a.data?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const deletePair = useMutation({
    mutationFn: async () => {
      if (!data) return;
      // Best-effort cleanup of storage objects. Errors are non-fatal — the row
      // delete below is what removes the photo from the user's view.
      const paths = [
        data.before_path,
        data.after_path,
        data.thumb_before_path,
        data.thumb_after_path,
      ].filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("job-photos").remove(paths);
      }
      const { error } = await supabase.from("photo_pairs").delete().eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["photo-pairs"] });
      navigate("/photos");
    },
  });

  if (isLoading) {
    return <div className="pt-6 px-[22px] text-sm text-neutral-500">Loading…</div>;
  }
  if (!data) {
    return (
      <div className="pt-6 px-[22px]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-500 inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="tp-card p-5 text-sm text-neutral-700">Photo pair not found.</div>
      </div>
    );
  }

  return (
    <div className="pt-3">
      {/* Header */}
      <header className="px-[22px] pb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.4px] uppercase text-neutral-500 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="text-[10px] font-semibold tracking-[0.4px] uppercase text-accent-600">
          Photo pair
        </div>
        <h1 className="tp-display text-[22px] font-bold text-neutral-900 mt-0.5 leading-tight">
          {data.address || "Untitled"}
        </h1>
        <div className="text-[11px] text-neutral-500 mt-1 inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {new Date(data.created_at).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </header>

      <section className="mx-4 space-y-3">
        {/* Photos — stacked on narrow screens, side-by-side on sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Pane label="Before" tone="ink" url={beforeUrl} />
          <Pane label="After" tone="green" url={afterUrl} />
        </div>

        {/* Property + customer */}
        <div className="tp-card p-0 overflow-hidden">
          {data.property_id && (
            <Link
              to={`/properties/${data.property_id}`}
              className="flex items-center gap-3 p-3.5 active:bg-neutral-100 transition-colors border-b border-neutral-200"
            >
              <div className="h-9 w-9 rounded-[10px] bg-brand-100 text-brand-800 flex items-center justify-center">
                <MapPin className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                  Property
                </div>
                <div className="text-sm font-bold text-neutral-900 truncate">
                  {data.address || "Open property"}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-neutral-400" strokeWidth={2.2} />
            </Link>
          )}
          {data.customer_id && (
            <Link
              to={`/customers/${data.customer_id}`}
              className="flex items-center gap-3 p-3.5 active:bg-neutral-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-[10px] bg-accent-100 text-accent-700 flex items-center justify-center">
                <UserIcon className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                  Customer
                </div>
                <div className="text-sm font-bold text-neutral-900 truncate">
                  {data.customer_name || "Open customer"}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-neutral-400" strokeWidth={2.2} />
            </Link>
          )}
        </div>

        {/* Share to gallery — flips photo_pairs.public_gallery on this row.
            The /g/:propertyId surface filters to public_gallery=true. */}
        <div className="tp-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-[10px] bg-neutral-100 text-neutral-700 flex items-center justify-center">
                <Eye className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-neutral-900">Share to gallery</div>
                <div className="text-[11px] text-neutral-500">
                  {shareToGallery
                    ? "Visible on the public property gallery"
                    : "Private — only you can see this pair"}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={shareToGallery}
              onClick={() => togglePublicGallery.mutate(!shareToGallery)}
              disabled={togglePublicGallery.isPending}
              className={`relative h-6 w-10 rounded-full transition-colors disabled:opacity-60 ${
                shareToGallery ? "bg-brand-700" : "bg-neutral-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  shareToGallery ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          {data.property_id && (
            <Link
              to={`/g/${data.property_id}`}
              className={`mt-3 inline-flex items-center gap-1 text-[11px] font-bold ${
                shareToGallery ? "text-brand-800" : "text-neutral-400"
              }`}
            >
              View property gallery
              <ExternalLink className="h-3 w-3" strokeWidth={2.4} />
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (confirm("Delete this photo pair? This cannot be undone.")) {
              deletePair.mutate();
            }
          }}
          disabled={deletePair.isPending}
          className="w-full text-destructive text-sm font-bold flex items-center justify-center gap-1.5 py-3 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deletePair.isPending ? "Deleting…" : "Delete pair"}
        </button>
      </section>

      <div className="h-6" />
    </div>
  );
}

function Pane({
  label,
  tone,
  url,
}: {
  label: "Before" | "After";
  tone: "ink" | "green";
  url: string | null;
}) {
  return (
    <div className="relative rounded-[16px] overflow-hidden bg-neutral-100 aspect-[3/4]">
      {url ? (
        <img src={url} alt={label} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-neutral-500">
          Missing {label.toLowerCase()}
        </div>
      )}
      <span
        className={[
          "absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
          tone === "ink" ? "bg-neutral-900/80 text-white" : "bg-brand-800 text-white",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}
