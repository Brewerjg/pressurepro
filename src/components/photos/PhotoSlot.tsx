import { Camera, RefreshCw } from "lucide-react";

// Shared before/after capture card used by NewPhotoPair.
// Empty state shows a camera icon + "Tap to capture"; populated state shows a
// preview thumbnail with a "Retake" link.

interface PhotoSlotProps {
  label: "Before" | "After";
  previewUrl: string | null;
  processing?: boolean;
  active?: boolean;
  onCapture: () => void;
}

export function PhotoSlot({
  label,
  previewUrl,
  processing,
  active,
  onCapture,
}: PhotoSlotProps) {
  const isBefore = label === "Before";
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onCapture}
        disabled={processing}
        className={[
          "relative aspect-[3/4] w-full rounded-[16px] overflow-hidden border-2 transition-all",
          previewUrl
            ? "border-ink-200"
            : "border-dashed bg-ink-100",
          active && !previewUrl
            ? isBefore
              ? "border-green-700 bg-green-50"
              : "border-bronze-500 bg-bronze-100/40"
            : "",
          processing ? "opacity-60" : "active:scale-[0.98]",
        ].join(" ")}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${label} preview`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ink-500">
            <div
              className={[
                "h-12 w-12 rounded-2xl flex items-center justify-center",
                isBefore ? "bg-green-100 text-green-800" : "bg-bronze-100 text-bronze-600",
              ].join(" ")}
            >
              <Camera className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <div className="font-mono text-[10px] font-bold tracking-[0.12em] uppercase">
              Tap to capture
            </div>
          </div>
        )}
        <span
          className={[
            "absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
            isBefore ? "bg-ink-900/80 text-white" : "bg-green-800 text-white",
          ].join(" ")}
        >
          {label}
        </span>
        {processing && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center text-xs font-bold text-ink-700">
            Processing…
          </div>
        )}
      </button>
      {previewUrl && !processing && (
        <button
          type="button"
          onClick={onCapture}
          className="mt-1.5 text-[11px] font-semibold text-ink-500 inline-flex items-center justify-center gap-1 hover:text-ink-700"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2.2} />
          Retake
        </button>
      )}
    </div>
  );
}
