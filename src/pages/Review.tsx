import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Star, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { BrandHeader } from "@/components/public/BrandHeader";
import { vertical } from "@/vertical";

const REVIEW_GOOGLE_THRESHOLD = 4;
const COMMENT_MAX_CHARS = 2000;

type PublicQuote = {
  id: string;
  customer_name: string;
  user_id: string;
};

const googleReviewUrl = (placeId: string | null | undefined): string | null => {
  const trimmed = (placeId ?? "").trim();
  if (!trimmed) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(trimmed)}`;
};

const Review = () => {
  const { id } = useParams();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{
    rating: number;
    googleReviewUrl: string | null;
    reviewId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      // Public lookup by UUID — app discriminator intentionally not filtered (see app-context.ts)
      const { data } = await supabase
        .from("quotes")
        .select("id, customer_name, user_id")
        .eq("id", id)
        .maybeSingle();
      if (!data) {
        setLoading(false);
        return;
      }
      setQuote(data as PublicQuote);
      const { data: prof } = await supabase.rpc("public_business_info", {
        p_user_id: data.user_id,
      });
      const row = prof?.[0];
      setBusinessName(row?.business_name ?? "");
      setPlaceId(row?.google_place_id ?? null);

      // If the customer already submitted a review, render the thank-you
      // state straight away.
      const { data: existing } = await supabase
        .from("quote_reviews")
        .select("id, rating")
        .eq("quote_id", data.id)
        .maybeSingle();
      if (existing) {
        setSubmitted({
          rating: existing.rating,
          reviewId: existing.id,
          googleReviewUrl: googleReviewUrl(row?.google_place_id ?? null),
        });
      }
      setLoading(false);
    })();
  }, [id]);

  const submit = async () => {
    setErrorMsg(null);
    if (rating < 1 || rating > 5) {
      setErrorMsg("Pick a star rating to submit.");
      return;
    }
    if (!quote) return;
    setSubmitting(true);
    try {
      // Prefer the shared edge function; fall back to direct insert.
      const { data, error } = await supabase.functions.invoke("submit-review", {
        body: { quote_id: quote.id, rating, comment: comment.trim() || null },
      });
      if (error) throw error;
      const ack = data as {
        ok?: boolean;
        reviewId?: string;
        googleReviewUrl?: string | null;
        error?: string;
      } | null;
      if (!ack?.ok || !ack.reviewId) {
        throw new Error(ack?.error || "Couldn't submit review");
      }
      setSubmitted({
        rating,
        reviewId: ack.reviewId,
        googleReviewUrl: ack.googleReviewUrl ?? googleReviewUrl(placeId),
      });
    } catch (e) {
      // Fallback path — direct insert. Public RLS in the shared schema
      // allows anonymous INSERT on quote_reviews.
      try {
        const { data: row, error: insErr } = await supabase
          .from("quote_reviews")
          .insert({
            quote_id: quote.id,
            rating,
            comment: comment.trim() || null,
            user_agent: navigator.userAgent.slice(0, 500),
          } as never)
          .select("id")
          .single();
        if (insErr) throw insErr;
        setSubmitted({
          rating,
          reviewId: (row as { id: string }).id,
          googleReviewUrl: googleReviewUrl(placeId),
        });
      } catch (e2) {
        setErrorMsg(
          e2 instanceof Error
            ? e2.message
            : e instanceof Error
              ? e.message
              : "Couldn't submit review",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onClickGoogle = () => {
    if (!submitted?.googleReviewUrl) return;
    if (submitted.reviewId) {
      // Best-effort: tell the backend the customer took the public path.
      void supabase.functions.invoke("submit-review", {
        body: { op: "mark_routed", review_id: submitted.reviewId },
      });
    }
    window.open(submitted.googleReviewUrl, "_blank", "noopener");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="font-display text-2xl">Review not found</h1>
          <p className="text-sm text-muted-foreground mt-1">
            The link may have expired.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    const isHigh = submitted.rating >= REVIEW_GOOGLE_THRESHOLD;
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="h-16 w-16 rounded-full bg-[hsl(var(--success-bg))] text-success flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="font-display text-[26px] mt-4">
          {isHigh ? "Thanks so much!" : "Thanks for the feedback"}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          {isHigh
            ? `Glad you had a great experience with ${businessName || "us"}.`
            : `We've shared your notes with ${businessName || "the team"} — they'll be in touch.`}
        </p>

        {isHigh && submitted.googleReviewUrl && (
          <div
            className="tp-card p-4 mt-6 max-w-sm w-full text-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--accent-100)), hsl(var(--card)))" }}
          >
            <div className="text-2xl mb-1.5">🌱</div>
            <div className="font-extrabold text-sm mb-1">
              {vertical.copy.reviewCalloutHeadline}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {vertical.copy.reviewCalloutBody}
            </p>
            <button
              onClick={onClickGoogle}
              className="w-full h-12 rounded-2xl bg-brand-800 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              Leave a Google review <ExternalLink className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const liveRating = hoverRating || rating;
  const firstName = quote.customer_name.split(" ")[0];

  return (
    <div className="min-h-screen bg-background">
      <BrandHeader business={businessName}>
        <h1 className="font-display text-[32px] text-white">
          How did we do, <span className="text-accent-400">{firstName}?</span>
        </h1>
        <p className="text-white/70 text-sm mt-2">Your feedback helps us get better.</p>
      </BrandHeader>

      <main className="max-w-md mx-auto px-4 pt-7">
        <div className="tp-card p-7 text-center">
          <div className="flex justify-center gap-2 mb-4">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = n <= liveRating;
              return (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  className="p-1 active:scale-90 transition-transform"
                >
                  <Star
                    className="h-[42px] w-[42px]"
                    fill={filled ? "hsl(var(--accent-500))" : "transparent"}
                    color={filled ? "hsl(var(--accent-500))" : "hsl(var(--border))"}
                    strokeWidth={1.5}
                  />
                </button>
              );
            })}
          </div>
          <div className="font-display font-extrabold text-2xl">
            {liveRating === 0 ? "Rate your experience" : ratingLabel(liveRating)}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {liveRating === 0
              ? "Tap a star to rate"
              : liveRating >= REVIEW_GOOGLE_THRESHOLD
                ? "Anything to add?"
                : "What could we improve?"}
          </p>
        </div>

        {rating > 0 && (
          <div className="mt-4">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX_CHARS))}
              rows={3}
              placeholder={
                rating >= REVIEW_GOOGLE_THRESHOLD
                  ? `A few words for ${businessName || "the team"}…`
                  : "Tell us what went wrong — only the team will see this."
              }
              className="w-full px-3.5 py-3 rounded-xl border-[1.5px] border-border bg-card text-sm font-medium text-foreground focus:border-brand-800 outline-none resize-none"
            />
          </div>
        )}

        {rating > 0 && (
          <div className="mt-4">
            <button
              onClick={submit}
              disabled={submitting}
              className="w-full h-14 rounded-2xl bg-accent-500 text-brand-900 font-bold text-[15px] shadow-accent flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
              Submit review
            </button>
            {errorMsg && (
              <p className="mt-2 text-xs text-destructive text-center">{errorMsg}</p>
            )}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground py-6">
          Powered by {vertical.brand.name}
        </p>
      </main>
    </div>
  );
};

const RATING_LABELS: Record<number, string> = {
  1: "Not great",
  2: "Could be better",
  3: "OK",
  4: "Pretty good",
  5: "Excellent",
};
function ratingLabel(n: number): string {
  return RATING_LABELS[n] ?? "";
}

export default Review;
