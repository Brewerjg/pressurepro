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
