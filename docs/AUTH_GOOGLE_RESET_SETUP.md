# Auth setup: Google sign-in + password reset

The code for "Continue with Google" and "Forgot password" is shipped, but it
will not work until the following is configured in the Supabase and Google
dashboards. These are dashboard/store steps the app itself cannot perform.

Supabase project ref: `dkksryutecjbyuscpxdb`
Supabase auth callback: `https://dkksryutecjbyuscpxdb.supabase.co/auth/v1/callback`
Native deep-link scheme: `turfpro://auth-callback`
Android package: `com.turfpro.beta`

---

## 1. Enable Google as a provider (Supabase)

Supabase Dashboard → Authentication → Providers → Google:

1. Toggle **Enable**.
2. Paste the **Client ID** and **Client Secret** from the Google OAuth client
   you create in step 2.
3. Save.

## 2. Create the Google OAuth client (Google Cloud Console)

Google Cloud Console → APIs & Services → Credentials → Create credentials →
OAuth client ID.

**Web application client** (used for web + as the Supabase provider client):

- Authorized redirect URI (exact):
  ```
  https://dkksryutecjbyuscpxdb.supabase.co/auth/v1/callback
  ```
- Copy the resulting Client ID + Secret into Supabase (step 1).

(You will also need an OAuth consent screen configured for the project.)

## 3. URL configuration / redirect allowlist (Supabase)

Supabase Dashboard → Authentication → URL Configuration:

- **Site URL**: the production web origin (e.g. `https://app.turfpro.com`).
- **Redirect URLs** (add every value the app uses as `redirectTo`):
  - the web origin, e.g. `https://app.turfpro.com`
  - `https://app.turfpro.com/reset-password`
  - `turfpro://auth-callback`

  Add the equivalent localhost entries for local dev too
  (`http://localhost:5173`, `http://localhost:5173/reset-password`).

Supabase only redirects back to URLs that match this allowlist, so the web
Google flow and the web reset-password flow both depend on these entries.

## 4. Native (Android) Google sign-in — REMAINING NATIVE WORK

Google blocks OAuth inside WebViews, so on native the app opens the consent
screen in the system browser and expects the callback to return via the
`turfpro://auth-callback` deep link. Two native pieces are still required:

1. **Android OAuth client** in Google Cloud Console:
   - Application type: Android
   - Package name: `com.turfpro.beta`
   - SHA-1 signing-certificate fingerprint of your signing key
     (`keytool -list -v -keystore <your.keystore>` or, for debug,
     the debug keystore).

2. **Deep-link intent-filter** in
   `android/app/src/main/AndroidManifest.xml` on the main activity:

   ```xml
   <intent-filter>
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="turfpro" android:host="auth-callback" />
   </intent-filter>
   ```

   This is the known TODO referenced in `src/lib/auth-deep-link.ts`
   (`TODO(native-android-deeplink)`). Capacitor 6 does not scaffold it.
   Without it, Android will not hand the `turfpro://` callback back to the
   app and Google sign-in / native email links will not complete.

   The in-app PKCE code exchange (`exchangeCodeForSession`) and hash-token
   `setSession` handling are already implemented in `auth-deep-link.ts`;
   they only run once the deep link actually reaches the app.

> iOS uses a custom-scheme handler that Capacitor registers more readily,
> but if you ship iOS you should still register the `turfpro` URL scheme in
> the iOS app's `Info.plist` (CFBundleURLTypes).

## 5. Password-reset emails — Resend SMTP (Supabase)

Forgot-password uses Supabase's transactional email. The built-in sender works
with zero config but is rate-limited (~a few/hour) — fine for testing. For real
use, relay through **Resend** (we already use Resend elsewhere in the app).

Sender identity: this app ships under the parent company **Falcon Tech**
(`falcontech.io`), so auth email is sent from that domain.

### a. Resend — verify the domain + make an API key
1. Resend → **Domains → Add Domain** → `falcontech.io` → add the SPF/DKIM DNS
   records Resend shows to the `falcontech.io` DNS host → wait for **Verified**.
   (`falcontech.io` is the company domain — `info@falcontech.io` confirms
   ownership, so you can verify it.)
2. Resend → **API Keys → Create API Key** (Sending access) → copy the `re_…`.

### b. Supabase → Authentication → SMTP Settings → Enable Custom SMTP
| Field | Value |
| --- | --- |
| Sender email | `noreply@falcontech.io` (or `info@falcontech.io` if you want replies to land in that inbox) |
| Sender name | `TurfPro` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (always literally "resend") |
| Password | the Resend `re_…` API key |
| Minimum interval per user | `60` |

After enabling, Supabase raises the email rate limit (default 30/hr, adjustable).

### c. Template
Authentication → Emails → Templates → **"Reset Password"**: confirm the link
uses `{{ .RedirectTo }}` so it honors the app's `redirectTo`
(`<origin>/reset-password` on web). Brand the copy as TurfPro.

### d. Verify
Tap **Forgot password?** in the app → check inbox + the Resend **Logs** tab to
confirm the send. (For a quick test before DNS verifies, you can temporarily use
sender `onboarding@resend.dev`, which only delivers to your own Resend account
email.)

---

## How it works in the code (reference)

- Web Google: `signInWithOAuth({ provider: "google", redirectTo: origin })`
  → full-page redirect → Supabase returns to the origin →
  `AuthContext.onAuthStateChange` picks up the session. Fully functional once
  steps 1–3 are done.
- Native Google: `signInWithOAuth({ ..., skipBrowserRedirect: true })`, then
  the returned `data.url` is opened with `@capacitor/browser`;
  `redirectTo = turfpro://auth-callback`. The deep-link listener exchanges the
  returned `?code` for a session. Requires step 4.
- Forgot password: `resetPasswordForEmail(email, { redirectTo })` →
  `<origin>/reset-password` (web) shows `ResetPassword.tsx`, which listens for
  the `PASSWORD_RECOVERY` session and calls `updateUser({ password })`.
