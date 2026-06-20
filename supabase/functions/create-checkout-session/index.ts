// create-checkout-session
//
// Creates a Stripe Checkout Session in HOSTED mode (we redirect the browser
// to session.url). Two distinct callers go through this endpoint and the
// `kind` field distinguishes them:
//
//   1) `kind` undefined / 'app_subscription' (default)
//      The OPERATOR is buying TurfPro's own SaaS subscription (Solo / Pro /
//      Crew or PAYG). The operator IS the customer — payment goes to
//      TurfPro's platform account. NO Connect routing, NO application_fee,
//      NO transfer_data.
//
//   2) `kind` === 'maintenance_plan' OR 'plan_one_time' OR 'visit_charge'
//      A lawn-care customer is paying the OPERATOR. This must flow through
//      Stripe Connect: payment lands on the operator's Connect account, and
//      we deduct an application_fee based on the operator's tier (PAYG = 2%,
//      paid tiers = 0%). Requires the operator's profile to have
//      stripe_account_id set AND connect_ready=true. If Connect isn't
//      ready, we currently fall back to platform-account charging (v1
//      transition), but emit a warning.
//
// The TurfPro client calls this with:
//
//   { priceId, userId, customerEmail?, returnUrl, environment, kind?,
//     operatorUserId?, amountCents? }
//
// For app subscriptions: priceId is treated as a Stripe lookup_key — we
// resolve it to a real `price_xxx` ID via stripe.prices.list({ lookup_keys
// }) so the client can ship human-readable identifiers (turfpro_solo_monthly
// etc.) without leaking real Stripe IDs into the bundle.
//
// For Connect-routed checkouts (plan one-time / visit charges) the caller
// supplies amountCents directly (one-off payment, no Stripe Price needed)
// and `operatorUserId` identifies whose Connect account receives the funds
// — this lets the homeowner pay the operator from a public/portal link
// without the homeowner being authenticated as the operator.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { createStripeClient, type AppId, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { loadOperatorConnect } from "../_shared/fees.ts";

const APP_ID: AppId = "turfpro";

type CheckoutKind =
  | "app_subscription"
  | "maintenance_plan"
  | "plan_one_time"
  | "visit_charge"
  | "deposit"
  | "balance";

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const {
      priceId,
      userId,
      customerEmail,
      returnUrl,
      environment,
      kind,
      operatorUserId,
      amountCents: bodyAmountCents,
      productName: bodyProductName,
      metadata: extraMetadata,
      quote_id: bodyQuoteId,
    } = body as {
      priceId?: string;
      userId?: string;
      customerEmail?: string;
      returnUrl?: string;
      environment?: StripeEnv;
      kind?: CheckoutKind;
      operatorUserId?: string;
      amountCents?: number;
      productName?: string;
      metadata?: Record<string, string>;
      quote_id?: string;
    };

    const checkoutKind: CheckoutKind = kind ?? "app_subscription";
    const isAppSubscription = checkoutKind === "app_subscription";
    const isConnectRouted = !isAppSubscription;
    const isDeposit = checkoutKind === "deposit";
    const isBalance = checkoutKind === "balance";
    // Both deposit and balance are customer→operator charges driven off a
    // quote_id (the public Accept and Invoice pages). They hydrate amount /
    // operator / customer / returnUrl from the quote + invoice below.
    const isQuoteCharge = isDeposit || isBalance;

    if (!isQuoteCharge && (!returnUrl || !environment)) {
      return jsonResponse(
        { error: "Missing required fields (returnUrl, environment)" },
        { status: 400 },
      );
    }
    if (isQuoteCharge && !bodyQuoteId) {
      return jsonResponse(
        { error: "quote_id is required for this checkout" },
        { status: 400 },
      );
    }

    // For the deposit flow the client may omit `environment`; default to
    // sandbox to mirror the webhook's getStripeEnvFromUrl default. All other
    // flows are guaranteed to have it from the validation above.
    const resolvedEnv: StripeEnv = environment ?? "sandbox";

    const stripe = createStripeClient(resolvedEnv, APP_ID);

    // -------------------------------------------------------------
    // App subscription path: operator buying their own SaaS plan.
    // Stays on platform account. NO Connect routing.
    // -------------------------------------------------------------
    if (isAppSubscription) {
      if (!priceId || !userId) {
        return jsonResponse(
          { error: "Missing required fields (priceId, userId)" },
          { status: 400 },
        );
      }
      // Defensive — lookup_keys come from constants in src/lib/stripe.ts but
      // we still validate so a tampered request can't smuggle SQL/markup.
      if (!/^[a-zA-Z0-9_-]+$/.test(priceId)) {
        return jsonResponse({ error: "Invalid priceId" }, { status: 400 });
      }

      const prices = await stripe.prices.list({
        lookup_keys: [priceId],
        limit: 1,
        active: true,
      });
      if (!prices.data.length) {
        return jsonResponse(
          { error: `No active Stripe price with lookup_key "${priceId}"` },
          { status: 404 },
        );
      }
      const price = prices.data[0];
      const isRecurring = price.type === "recurring";

      const session = await stripe.checkout.sessions.create({
        mode: isRecurring ? "subscription" : "payment",
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: returnUrl,
        cancel_url: returnUrl.replace(
          "session_id={CHECKOUT_SESSION_ID}",
          "canceled=1",
        ),
        ...(customerEmail && { customer_email: customerEmail }),
        // Metadata is mirrored to the resulting Subscription so the webhook
        // can find the userId without a round-trip to Supabase.
        metadata: {
          userId,
          priceId,
          environment: resolvedEnv,
          kind: "app_subscription",
          ...(extraMetadata ?? {}),
        },
        ...(isRecurring && {
          subscription_data: {
            trial_period_days: 14,
            metadata: {
              userId,
              priceId,
              environment: resolvedEnv,
              kind: "app_subscription",
              ...(extraMetadata ?? {}),
            },
          },
        }),
        allow_promotion_codes: true,
      });

      if (!session.url) {
        return jsonResponse(
          { error: "Stripe did not return a session URL" },
          { status: 502 },
        );
      }
      return jsonResponse({ url: session.url, sessionId: session.id });
    }

    // -------------------------------------------------------------
    // Quote-charge path: homeowner paying a DEPOSIT (from the public Accept
    // page) or the remaining BALANCE (from the public Invoice page). Both
    // send { quote_id, kind }, so we hydrate amount / operator / customer /
    // returnUrl from the quote + its invoice here. Routed through Stripe
    // Connect to the operator (platform fallback if not Connect-ready).
    //
    // The invoice OWNS the money, so we look up the quote's invoice and stamp
    // both quote_id AND invoice_id onto the session + payment_intent metadata.
    // The webhook keys off invoice_id when present. For a balance charge the
    // invoice is required; for a deposit it's optional (metadata-only).
    // -------------------------------------------------------------
    if (isQuoteCharge) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: quote, error: quoteErr } = await supabase
        .from("quotes")
        .select(
          "id,user_id,customer_id,customer_name,customer_email,deposit_amount,total",
        )
        .eq("id", bodyQuoteId!)
        .maybeSingle();
      if (quoteErr || !quote) {
        return jsonResponse(
          { error: "Quote not found for checkout" },
          { status: 404 },
        );
      }

      // Look up the quote's invoice (invoices.quote_id is unique).
      let invoiceId: string | null = null;
      let invoiceTotalCents = 0;
      let invoicePublicToken: string | null = null;
      try {
        const { data: invoice } = await (supabase as any)
          .from("invoices")
          .select("id,total,public_token")
          .eq("quote_id", bodyQuoteId!)
          .maybeSingle();
        if (invoice) {
          invoiceId = invoice.id ?? null;
          invoiceTotalCents = Math.round(Number(invoice.total ?? 0) * 100);
          invoicePublicToken = invoice.public_token ?? null;
        }
      } catch (e) {
        console.warn("[create-checkout-session] invoice lookup failed", e);
      }

      // Compute the charge amount + product label per kind.
      let chargeCents: number;
      let productName: string;
      if (isBalance) {
        if (!invoiceId) {
          return jsonResponse(
            { error: "No invoice found for this quote" },
            { status: 404 },
          );
        }
        // Remaining balance = invoice total − cumulative non-voided payments
        // already applied to the invoice. A paid deposit is recorded against
        // the invoice by the webhook, so it's included here — we never
        // double-charge it.
        let paidCents = 0;
        try {
          const { data: pays } = await (supabase as any)
            .from("manual_payments")
            .select("amount_cents,status")
            .eq("invoice_id", invoiceId);
          paidCents = (pays ?? [])
            .filter((p: any) => p.status !== "voided")
            .reduce((s: number, p: any) => s + Number(p.amount_cents ?? 0), 0);
        } catch (e) {
          console.warn("[create-checkout-session] payments sum failed", e);
        }
        chargeCents = invoiceTotalCents - paidCents;
        productName = bodyProductName ?? "Invoice balance";
        if (chargeCents < 50) {
          return jsonResponse(
            { error: "This invoice has no balance to collect" },
            { status: 400 },
          );
        }
      } else {
        // deposit
        const depositAmount = Number((quote as any).deposit_amount);
        if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
          return jsonResponse(
            { error: "This quote has no deposit to collect" },
            { status: 400 },
          );
        }
        chargeCents = Math.round(depositAmount * 100);
        productName = bodyProductName ?? "Deposit";
        if (chargeCents < 50) {
          return jsonResponse(
            { error: "Deposit amount must be at least $0.50" },
            { status: 400 },
          );
        }
      }

      const opUserId = (quote as any).user_id as string;
      const operator = await loadOperatorConnect(supabase, opUserId);
      // DIRECT CHARGES ONLY: we refuse the charge unless the operator's
      // Connect account is ready. We never fall back to a platform charge —
      // funds must settle directly into the operator's account so TurfPro
      // never holds (or is liable for) the operator's money.
      if (!operator.shouldRoute) {
        return jsonResponse(
          {
            error:
              "This business hasn't finished setting up payments yet. Please try again later.",
            code: "connect_not_ready",
          },
          { status: 409 },
        );
      }
      const feeAmountCents =
        operator.feePercent > 0
          ? Math.round((chargeCents * operator.feePercent) / 100)
          : undefined;

      // Build the customer return URL. Prefer an explicit returnUrl; otherwise
      // derive one from the request Origin — the accept page for deposits, the
      // public invoice page for balances.
      const origin = req.headers.get("origin") ?? "";
      const paidMarker = isBalance ? "paid=1" : "deposit=paid";
      const fallbackReturn = isBalance
        ? (invoicePublicToken && origin
            ? `${origin}/invoice/${invoicePublicToken}?paid=1`
            : null)
        : (origin ? `${origin}/accept/${bodyQuoteId}?deposit=paid` : null);
      const chargeReturnUrl = returnUrl ?? fallbackReturn;
      if (!chargeReturnUrl) {
        return jsonResponse(
          { error: "Unable to determine a return URL for checkout" },
          { status: 400 },
        );
      }

      const chargeMeta: Record<string, string> = {
        userId: opUserId,
        operatorUserId: opUserId,
        environment: resolvedEnv,
        kind: checkoutKind,
        quote_id: bodyQuoteId!,
        ...(invoiceId ? { invoice_id: invoiceId } : {}),
        ...((quote as any).customer_id
          ? { customer_id: (quote as any).customer_id as string }
          : {}),
        tier_at_capture: operator.tier,
        fee_percent: String(operator.feePercent),
        ...(extraMetadata ?? {}),
      };

      const chargeCustomerEmail =
        customerEmail ?? ((quote as any).customer_email as string | null) ?? undefined;

      // DIRECT CHARGE: created ON the operator's connected account via the
      // `stripeAccount` request option. Funds settle into the operator's
      // balance, the operator's account pays Stripe's processing fee, and
      // TurfPro skims `application_fee_amount`. No `transfer_data` — that's
      // for destination charges where the platform holds funds + liability.
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: productName },
                unit_amount: chargeCents,
              },
              quantity: 1,
            },
          ],
          success_url: chargeReturnUrl,
          cancel_url: chargeReturnUrl
            .replace("session_id={CHECKOUT_SESSION_ID}", "canceled=1")
            .replace(paidMarker, isBalance ? "paid=0" : "deposit=canceled"),
          ...(chargeCustomerEmail && { customer_email: chargeCustomerEmail }),
          metadata: chargeMeta,
          payment_intent_data: {
            metadata: chargeMeta,
            ...(feeAmountCents !== undefined
              ? { application_fee_amount: feeAmountCents }
              : {}),
          },
        },
        { stripeAccount: operator.stripeAccountId! },
      );

      if (!session.url) {
        return jsonResponse(
          { error: "Stripe did not return a session URL" },
          { status: 502 },
        );
      }
      return jsonResponse({ url: session.url, sessionId: session.id });
    }

    // -------------------------------------------------------------
    // Connect-routed path: homeowner paying the operator.
    // Lawn-care customer is the payer; operator's Connect account is
    // the destination. We deduct application_fee_amount based on
    // operator tier (PAYG 2% / paid 0%).
    //
    // Caller supplies amountCents directly because these are one-off
    // charges that don't need a Stripe Price catalog entry.
    // -------------------------------------------------------------
    const opUserId = operatorUserId ?? userId;
    if (!opUserId) {
      return jsonResponse(
        { error: "operatorUserId required for Connect-routed checkout" },
        { status: 400 },
      );
    }
    const amount = Number(bodyAmountCents);
    if (!Number.isFinite(amount) || amount < 50) {
      return jsonResponse(
        { error: "amountCents must be a number >= 50" },
        { status: 400 },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const operator = await loadOperatorConnect(supabase, opUserId);

    // DIRECT CHARGES ONLY: refuse unless the operator's Connect account is
    // ready. We never charge on the platform account — funds must settle
    // directly to the operator so TurfPro never holds their money.
    if (!operator.shouldRoute) {
      return jsonResponse(
        {
          error:
            "This business hasn't finished setting up payments yet. Please try again later.",
          code: "connect_not_ready",
        },
        { status: 409 },
      );
    }

    // Checkout Sessions in `payment` mode use application_fee_amount
    // (fixed cents), NOT application_fee_percent. Convert percent → cents
    // off the line-item total.
    const feeAmountCents =
      operator.feePercent > 0
        ? Math.round((amount * operator.feePercent) / 100)
        : undefined;

    const productName = bodyProductName ?? "TurfPro charge";

    const chargeMeta = {
      userId: opUserId,
      operatorUserId: opUserId,
      environment: resolvedEnv,
      kind: checkoutKind,
      tier_at_capture: operator.tier,
      fee_percent: String(operator.feePercent),
      ...(extraMetadata ?? {}),
    };

    // DIRECT CHARGE on the operator's connected account (see the quote-charge
    // path above for the rationale). No transfer_data.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: productName },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: returnUrl,
        cancel_url: returnUrl.replace(
          "session_id={CHECKOUT_SESSION_ID}",
          "canceled=1",
        ),
        ...(customerEmail && { customer_email: customerEmail }),
        metadata: chargeMeta,
        payment_intent_data: {
          metadata: chargeMeta,
          ...(feeAmountCents !== undefined
            ? { application_fee_amount: feeAmountCents }
            : {}),
        },
      },
      { stripeAccount: operator.stripeAccountId! },
    );

    if (!session.url) {
      return jsonResponse(
        { error: "Stripe did not return a session URL" },
        { status: 502 },
      );
    }
    return jsonResponse({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("create-checkout-session error:", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
});
