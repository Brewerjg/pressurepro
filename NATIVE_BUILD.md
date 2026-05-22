# Native builds (iOS + Android)

TurfPro is a Vite + React SPA wrapped with Capacitor for native iOS and Android. The web build is the canonical artifact — `dist/` is what ships inside the native app shells.

## One-time setup

```bash
npm install                      # picks up @capacitor/* deps
npx cap add android              # creates android/ (requires Android Studio for builds)
npx cap add ios                  # creates ios/ — macOS + Xcode required
```

`cap add` is platform-specific:
- **Android folder generation works on Windows / macOS / Linux.** Building an APK / AAB requires Android Studio.
- **iOS folder generation requires macOS** (Capacitor's CLI shells out to Xcode tooling). You can develop the web app on any OS, but the iOS native shell can only be opened, signed, and built on a Mac.

## Day-to-day

```bash
npm run dev                      # local browser dev — fastest loop
npm run build                    # produces dist/
npm run cap:sync                 # build + copy dist/ into both native projects
npm run cap:android              # build + sync + open Android Studio
npm run cap:ios                  # build + sync + open Xcode (Mac only)
```

`cap sync` does two things: copies the web build into each native project, AND copies any new Capacitor plugin native code into the native project. Run it whenever you `npm install` a new `@capacitor/*` plugin.

## Plugins currently wired

| Plugin | Purpose | Permissions |
|---|---|---|
| `@capacitor/camera` | Photo-pair before/after capture, damage docs | Camera access |
| `@capacitor/geolocation` | "Where am I" hint on active route stop (deferred — not yet wired) | Location while in use |
| `@capacitor/preferences` | Offline cache of today's route (deferred — not yet wired) | Local storage |

Camera permissions need to be declared in:
- iOS: `ios/App/App/Info.plist` — `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`
- Android: `android/app/src/main/AndroidManifest.xml` — `<uses-permission android:name="android.permission.CAMERA" />`

`npx cap add` generates these files with sensible defaults; you'll need to edit the iOS strings to be user-facing (e.g., "TurfPro uses your camera to capture before/after photos for customer records").

## Bundle identifier

Set in [capacitor.config.ts](capacitor.config.ts):

```ts
appId: "tech.falcon.turfpro"
```

Change this BEFORE generating the native folders if you want a different reverse-DNS namespace. After folders are generated, changes to `appId` require renaming the native projects (Capacitor has a `cap migrate` for this but it's awkward — easier to delete and re-add).

## Versioning

App version lives in two places:
1. `package.json` — informational only
2. The native project files — `android/app/build.gradle` (`versionCode` / `versionName`) and `ios/App/App.xcodeproj` (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`)

Bump those before each store release.

## Deep links (Supabase auth redirect, Stripe checkout return)

Add your URL scheme to `capacitor.config.ts` under `ios.scheme` (already set to `TurfPro`) and configure intent filters in `AndroidManifest.xml`. The auth flow in [src/pages/Auth.tsx](src/pages/Auth.tsx) currently uses `window.location.origin` as the email-confirmation redirect; that returns to the web URL when run in a browser. For native, you'll want to update it to the custom scheme so the user returns to the app.

## Don't commit secrets

`.env` is checked in because both `VITE_SUPABASE_*` values are publishable / anon keys (safe to ship to every user's browser). When you add Stripe / OpenWeather / Mapbox keys via edge functions, those secrets live in Supabase project secrets, NOT in the client bundle.

## Pre-flight audit (do before the first real Android/iOS run)

Walk through each item on a real device once the native shells are generated. The web app passes these in browser DevTools' device-emulation mode, but Capacitor's WebView surfaces different edges.

| Check | Why it matters | Where to look |
|---|---|---|
| Safe-area padding on iOS notch + home indicator | The shell already uses `env(safe-area-inset-*)` in `body` padding and TabBar padding-bottom. Verify it actually clears the Dynamic Island on a 15 Pro and the home bar on every device. | [src/index.css](src/index.css), [src/components/TabBar.tsx](src/components/TabBar.tsx) |
| Status-bar tinting | iOS WebView uses translucent status bar by default. Set `ios.contentInset: 'always'` (already in `capacitor.config.ts`). Consider `@capacitor/status-bar` if you want to tint it green when the user is on Home (hero gradient) vs default elsewhere. | `capacitor.config.ts` |
| Keyboard handling on forms | iOS WebView scrolls the input into view by default but Android sometimes lets the keyboard cover the field. `@capacitor/keyboard` plugin offers `Keyboard.setResizeMode('body')` to shrink the viewport. Add the plugin if any of Auth, NewPlan, NewPhotoPair, Onboarding feel cramped. | Not currently wired |
| Pull-to-refresh | Default WebView pull-to-refresh can fire accidentally on touch-scrolled lists. Disable globally on Android via `<application android:allowBackup="false" ...>` plus disabling overscroll in the WebView config; on iOS it's not the default behavior. | `android/app/src/main/AndroidManifest.xml` after `cap add android` |
| Auth deep-link redirect | [src/pages/Auth.tsx](src/pages/Auth.tsx) uses `window.location.origin` as the email-confirmation redirect. In a native build that's something like `capacitor://localhost`. Add the custom scheme + a deep-link handler so users return to the app after clicking the email link. | [src/pages/Auth.tsx:38](src/pages/Auth.tsx#L38), `capacitor.config.ts` `ios.scheme` |
| Stripe checkout return URL | The Stripe `success_url` is built relative to `window.location.origin`. Native users will hit `https://` URLs (your hosted web bundle's origin) from Checkout — make sure the hosted bundle has a route that closes the in-app browser and `postMessage`s the result back. Or use Capacitor's `@capacitor/browser` plugin for the Checkout step. | [src/lib/stripe.ts](src/lib/stripe.ts), edge fn `create-checkout-session` |
| Camera permission strings | iOS will reject builds without `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` in `Info.plist`. Write user-facing copy ("TurfPro uses your camera to capture before/after lawn photos."). | `ios/App/App/Info.plist` after `cap add ios` |
| External maps link | RouteMode's "Navigate" button does `window.open(googleMapsUrl, '_blank')`. In Capacitor, `_blank` opens an in-app browser; the operator wants the real Maps app. Use `@capacitor/app` `App.openUrl(url)` or set the `target` to `_system`. | [src/pages/RouteMode.tsx](src/pages/RouteMode.tsx) |
| `tel:` and `mailto:` links | Both [CustomerDetail.tsx](src/pages/CustomerDetail.tsx) and the PlanPortal use plain `<a href="tel:...">` — works on web, works native if the `app-open-url` plugin is set. Verify on iOS once. | Multiple files |
| Bundle size on slow networks | Even after lazy-loading, the first paint pulls ~556 KB of JS (155 KB gzipped). On a truck-cab 3G connection that's still a 2–4 second wait. Consider preloading the worker bundles after sign-in if you find startup feels slow. | `vite.config.ts` rollupOptions if you want manual chunks |

None of these block a first beta. They're the kind of paper cuts you want to find before you do the App Store submission, not on launch day.
