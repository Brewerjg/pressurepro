// Typed wrapper around the compose-customer-message edge function. Single
// function — the client calls it to fetch the rendered body and a
// pre-built `sms:` URL, then opens the operator's Messages app or copies
// the text. No fire-and-forget here: this is a strictly request/response
// helper because the UI needs the body string to render copy buttons.

import { supabase } from "@/integrations/supabase/client";
import { publicAppOrigin } from "@/lib/public-url";

export type ComposeKind =
  | "on_the_way"
  | "completed"
  | "review_request"
  | "plan_confirmation"
  | "quote_send"
  | "payment_retry";

export interface ComposeRequest {
  kind: ComposeKind;
  route_stop_id?: string;
  quote_id?: string;
  plan_id?: string;
}

export interface ComposeResult {
  ok: boolean;
  phone: string | null;
  email: string | null;
  subject: string | null;
  body: string;
  sms_url: string | null;
  mailto_url: string | null;
  error?: string;
}

const EMPTY_RESULT: ComposeResult = {
  ok: false,
  phone: null,
  email: null,
  subject: null,
  body: "",
  sms_url: null,
  mailto_url: null,
};

export async function composeCustomerMessage(
  req: ComposeRequest,
): Promise<ComposeResult> {
  try {
    // Forward the PUBLIC web origin so links in the body resolve for the
    // customer. On web this is window.location.origin; in the native app it's
    // the configured VITE_PUBLIC_APP_ORIGIN (NOT the WebView's localhost
    // origin, which would produce dead links). Falls back to undefined so the
    // edge function uses its PUBLIC_APP_ORIGIN secret if we can't resolve one.
    const origin = publicAppOrigin() || undefined;

    const { data, error } = await supabase.functions.invoke(
      "compose-customer-message",
      { body: { ...req, origin } },
    );
    if (error) {
      return { ...EMPTY_RESULT, error: error.message };
    }
    const payload = (data ?? {}) as {
      ok?: boolean;
      phone?: string | null;
      email?: string | null;
      subject?: string | null;
      body?: string;
      sms_url?: string | null;
      mailto_url?: string | null;
      error?: string;
    };
    if (payload.ok === false || payload.error) {
      return {
        ...EMPTY_RESULT,
        error: payload.error || "Couldn't build message",
      };
    }
    return {
      ok: true,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
      subject: payload.subject ?? null,
      body: payload.body ?? "",
      sms_url: payload.sms_url ?? null,
      mailto_url: payload.mailto_url ?? null,
    };
  } catch (e) {
    return {
      ...EMPTY_RESULT,
      error: e instanceof Error ? e.message : "Unknown",
    };
  }
}
