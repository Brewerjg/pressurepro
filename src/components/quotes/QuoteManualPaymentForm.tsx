import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ManualPaymentMethod,
  METHOD_LABEL,
} from "@/lib/manual-payments";

// =====================================================================
// QuoteManualPaymentForm — inline cash/check intake against a quote or
// invoice. Same shape as the PlanDetail variant; kept here so the quote
// and invoice pages can both reuse it.
// =====================================================================
const QUOTE_METHODS: ManualPaymentMethod[] = [
  "cash",
  "check",
  "venmo",
  "cashapp",
  "zelle",
  "other",
];

export default function QuoteManualPaymentForm({
  defaultAmount,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  defaultAmount: number;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (args: {
    method: ManualPaymentMethod;
    amountCents: number;
    checkNumber: string | null;
  }) => void;
}) {
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [amount, setAmount] = useState<string>(
    defaultAmount > 0 ? defaultAmount.toFixed(2) : "",
  );
  const [checkNumber, setCheckNumber] = useState<string>("");

  const submit = () => {
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      window.alert("Enter a valid amount");
      return;
    }
    onSubmit({
      method,
      amountCents: Math.round(amountNum * 100),
      checkNumber: method === "check" ? (checkNumber.trim() || null) : null,
    });
  };

  return (
    <div className="tp-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-ink-900">
          Record payment
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-semibold text-ink-500 hover:text-ink-700"
        >
          Cancel
        </button>
      </div>

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
          Method
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {QUOTE_METHODS.map((m) => {
            const on = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "py-2 rounded-xl text-[12px] font-semibold transition-colors border",
                  on
                    ? "border-bronze-500 bg-bronze-500 text-white"
                    : "border-ink-200 bg-card text-ink-700 hover:border-bronze-400",
                )}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
            Amount
          </div>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
          />
        </div>
        {method === "check" && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.4px] text-ink-500 mb-1.5">
              Check #
            </div>
            <input
              type="text"
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2.5 rounded-xl border border-ink-200 bg-card text-ink-900 text-sm focus:outline-none focus:border-green-800"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-[hsl(var(--destructive-bg))] text-destructive text-[12.5px] font-semibold p-3">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-full bg-bronze-500 text-white font-bold text-[14px] py-3 shadow-bronze hover:bg-bronze-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Save payment
      </button>
    </div>
  );
}
