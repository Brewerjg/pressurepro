// send-push — server-side push notification dispatcher.
//
// Operator setup (one-time):
//   1. Create a Firebase project at https://console.firebase.google.com.
//   2. Add an Android app (package name from capacitor.config.ts) and an
//      iOS app (bundle id from capacitor.config.ts) to that project.
//   3. iOS: upload an APNs auth key (.p8 from the Apple Dev portal) to the
//      Firebase iOS app's Cloud Messaging settings. Firebase wraps APNs
//      under FCM v1 so a single send call reaches both platforms.
//   4. Generate a Firebase service-account JSON (Project Settings →
//      Service Accounts → Generate new private key). The full JSON blob
//      goes into a Supabase function secret called FCM_SERVICE_ACCOUNT_JSON.
//
// FCM v1 vs the legacy server-key API:
//   FCM v1 requires an OAuth2 access token minted from the service-account
//   key + the messaging scope. The legacy server-key API is deprecated and
//   will be sunset; we go straight to v1. We mint a fresh access token per
//   invocation since edge functions are stateless — Google caches the token
//   for ~50 minutes, so a busier deployment would benefit from in-memory
//   caching, but for v1 the extra OAuth call per dispatch is fine.
//
// Request shape:
//   POST /send-push
//   { user_id: string, title: string, body: string, data?: Record<string,string> }
//
// Auth:
//   This endpoint accepts BOTH a user-bearing JWT (operator firing a push
//   to themselves — e.g. a test from Settings) AND a service-role JWT (the
//   payments-webhook calls into here when dunning fires). We don't require
//   the publishable-key user-identity check because the payments-webhook
//   is the primary caller and it presents a service-role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { corsHeaders } from "../_shared/cors.ts";

interface SendPushPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface TokenRow {
  token: string;
  platform: "ios" | "android" | "web";
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Partial<SendPushPayload>;
    if (!payload.user_id || !payload.title || !payload.body) {
      return json({ error: "user_id, title, and body are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fan out: every token belonging to this user. Web tokens are skipped
    // — v1 doesn't ship browser push. Each device send is independent so
    // we Promise.all them.
    const { data: tokens, error: tokensErr } = await supabase
      .from("push_tokens" as never)
      .select("token, platform")
      .eq("user_id", payload.user_id);
    if (tokensErr) {
      console.error("[send-push] token query failed:", tokensErr);
      return json({ error: "Failed to load push tokens" }, 500);
    }

    const targets = ((tokens ?? []) as unknown as TokenRow[]).filter(
      (t) => t.platform === "ios" || t.platform === "android",
    );
    if (targets.length === 0) {
      // Not an error per se — operator hasn't registered any native devices.
      return json({ ok: true, sent: 0, results: [] });
    }

    const serviceAccountJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) {
      return json(
        {
          error:
            "Push not configured. Set FCM_SERVICE_ACCOUNT_JSON in function secrets.",
        },
        503,
      );
    }
    let serviceAccount: ServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
    } catch (e) {
      console.error("[send-push] FCM_SERVICE_ACCOUNT_JSON parse failed:", e);
      return json({ error: "Invalid FCM_SERVICE_ACCOUNT_JSON" }, 503);
    }

    let accessToken: string;
    try {
      accessToken = await mintFcmAccessToken(serviceAccount);
    } catch (e) {
      console.error("[send-push] OAuth token mint failed:", e);
      return json({ error: "FCM auth failed" }, 502);
    }

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

    const results = await Promise.all(
      targets.map(async (t) => {
        try {
          const message = {
            message: {
              token: t.token,
              notification: {
                title: payload.title,
                body: payload.body,
              },
              // Extra structured payload so the client can deep-link on tap.
              data: payload.data
                ? // FCM v1 requires every data value to be a string.
                  Object.fromEntries(
                    Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
                  )
                : undefined,
              // APNs envelope — wakes iOS even when the app is backgrounded.
              apns: {
                payload: {
                  aps: {
                    sound: "default",
                    badge: 1,
                  },
                },
              },
              // Android default channel; operator can re-channel later via
              // the native side if they want quiet vs loud notifications.
              android: {
                priority: "HIGH",
                notification: {
                  sound: "default",
                },
              },
            },
          };
          const res = await fetch(fcmUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          });
          const ok = res.ok;
          let detail: unknown = null;
          try {
            detail = await res.json();
          } catch {
            /* ignore — empty body */
          }

          // Token cleanup: if FCM rejects with NOT_FOUND or UNREGISTERED the
          // token is permanently dead (uninstalled, etc.). Delete it so the
          // next send doesn't re-attempt.
          if (!ok && res.status === 404) {
            await supabase
              .from("push_tokens" as never)
              .delete()
              .eq("token", t.token);
          }
          return {
            token: t.token,
            platform: t.platform,
            ok,
            status: res.status,
            detail: ok ? null : detail,
          };
        } catch (err) {
          return {
            token: t.token,
            platform: t.platform,
            ok: false,
            status: 0,
            detail: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    return json({ ok: true, sent, results });
  } catch (e) {
    console.error("[send-push] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =====================================================================
// FCM v1 OAuth2 — sign a JWT with the service account, exchange for an
// access token. RSA-SHA256 via WebCrypto (no third-party JWT lib needed).
// =====================================================================
async function mintFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(claims)}`;

  const key = await importPkcs8PrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64urlEncode(new Uint8Array(sigBuf))}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("OAuth response missing access_token");
  return body.access_token;
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPkcs8PrivateKey(pem: string): Promise<CryptoKey> {
  // Service-account keys come PEM-armored with literal "\n" in the JSON;
  // unescape both real newlines and escaped ones.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    raw.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
