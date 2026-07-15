// Extract a human-friendly message from a `supabase.functions.invoke` error.
//
// On a non-2xx response, supabase-js surfaces a FunctionsHttpError whose
// `.message` is the useless generic "Edge Function returned a non-2xx status
// code" — the real, user-facing message the function returned (e.g.
// connect_not_ready "This business hasn't finished setting up payments yet.")
// lives in the response body on `error.context`. This reads that body's
// `error` field, falling back to the raw message, then a caller-supplied
// fallback. Duck-typed so it survives supabase-js minor version churn.
export async function friendlyFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = (await (ctx as Response).json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error) return body.error;
    } catch {
      // body wasn't JSON — fall through to the message/fallback
    }
  }
  const msg = (error as { message?: unknown })?.message;
  if (typeof msg === "string" && msg && !/non-2xx status/i.test(msg)) {
    return msg;
  }
  return fallback;
}
