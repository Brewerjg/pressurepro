import { DollarSign } from "lucide-react";
import { type ManualPayment, METHOD_LABEL } from "@/lib/manual-payments";

// =====================================================================
// ManualPaymentsList — recorded payment history for a quote or invoice,
// plus the running cumulative total so the operator can see at-a-glance
// how much of the total has been collected offline.
// =====================================================================
const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

export default function ManualPaymentsList({
  payments,
  quoteTotal,
}: {
  payments: ManualPayment[];
  quoteTotal: number;
}) {
  const cumulative = payments.reduce(
    (s, p) => s + (p.status === "voided" ? 0 : p.amount_cents / 100),
    0,
  );
  const remaining = Math.max(0, quoteTotal - cumulative);
  return (
    <div className="tp-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-neutral-900 inline-flex items-center gap-1.5">
          <DollarSign className="h-4 w-4 text-accent-600" strokeWidth={2.2} />
          Recorded payments
        </h2>
        <div className="text-[11px] text-neutral-500 tp-num">
          <span className="font-semibold text-neutral-900">{fmtUSD(cumulative)}</span>
          {quoteTotal > 0 && (
            <span className="ml-1.5">
              of {fmtUSD(quoteTotal)} ·{" "}
              {remaining > 0 ? `${fmtUSD(remaining)} remaining` : "paid in full"}
            </span>
          )}
        </div>
      </div>
      <ul className="divide-y divide-neutral-200">
        {payments.map((p) => (
          <li key={p.id} className="py-2.5 flex items-center justify-between text-[13px]">
            <span className="text-neutral-700">
              {new Date(p.received_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="tp-num font-semibold text-neutral-900">
              {fmtUSD(p.amount_cents / 100)}
            </span>
            <span className="px-2 py-[2px] rounded-full text-[10.5px] font-bold uppercase tracking-[0.4px] bg-accent-100 text-accent-700">
              {METHOD_LABEL[p.method]}
              {p.check_number ? ` #${p.check_number}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
