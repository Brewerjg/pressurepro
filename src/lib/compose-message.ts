// Typed wrapper around the compose-customer-message edge function. Single
// function — the client calls it to fetch the rendered body and a
// pre-built `sms:` URL, then opens the operator's Messages app or copies
// the text. No fire-and-forget here: this is a strictly request/response
// helper because the UI needs the body string to render copy buttons.

import { supabase } from "@/integrations/supabase/client";

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
    // Forward window.location.origin so links in the body match the
    // operator's deployed app URL rather than whatever PUBLIC_APP_ORIGIN
    // the edge function falls back to.
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : undefined;

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
