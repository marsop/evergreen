# Evergreen

Evergreen is a Blazor WebAssembly plant-care dashboard for keeping track of plants, growing places, and care journal entries. It runs in the browser and can be hosted as static files on GitHub Pages.

## Features

- Today view with care tasks and watering progress
- Plant list, search, profiles, and plant editing
- Growing-place management
- Care journal with notes and optional photos
- Interactive client-rendered UI
- Browser Back/Forward navigation and reloadable links to views and plant profiles
- English, Spanish, and German with instant language switching
- Installable progressive web app with offline startup after an initial online visit

Gardens are private to a Google account and stored in Firebase Cloud Firestore. Each new account receives the sample garden once. Edits, care history, compressed journal photos, and language preferences survive reloads and synchronize across devices. This remains a prototype: care advice and preview charts are illustrative, while watering progress uses actual local dates.

## Requirements

- .NET 10 SDK
- Node.js 22 or later
- A Firebase project on the no-cost Spark plan (see setup below)

## Install on a device

Open the deployed HTTPS site in a supported browser:

- **Android:** use Chrome's **Install app** or **Add to Home screen** menu.
- **iPhone/iPad:** in Safari, choose **Share → Add to Home Screen** (enable **Open as Web App** if offered).
- **Desktop:** use the browser's install icon or **Install app** menu where supported.

Installation uses the browser's own controls, not an in-app button; availability and wording vary by browser and OS. The installed app opens in its own standalone window with Evergreen's icon. HTTPS is required in production; localhost is permitted for development/testing.

Visit online first and allow the published service worker to finish caching before going offline. The app shell, runtime, translations, and bundled images are cached; first-time sign-in still needs connectivity. Installation does not change the Firebase garden-storage and synchronization behavior described below.

App updates wait until all Evergreen tabs and installed windows for that site are closed. Reopen to use the updated version; the app does not force a reload while you are editing. Development builds deliberately do not cache the app shell.

## Run locally

From the repository root:

```powershell
npm ci
dotnet run --project Evergreen.csproj
```

The Blazor WebAssembly development server URL is printed when the app starts. To build without starting the app:

```powershell
dotnet build Evergreen.csproj
```

Run the localization tests with:

```powershell
dotnet test Tests\Evergreen.Tests.csproj
node --test Tests\localization.test.cjs Tests\pwa.test.cjs
npm run test:client
npm run test:rules
```

The Firebase emulator tests additionally require Java 21. The [CI workflow](.github/workflows/ci.yml) builds the app in Release configuration and runs the .NET, JavaScript, emulator, and browser tests for source pushes and pull requests, excluding the generated `gh-pages` branch.

## Firebase setup (Spark, no billing account)

1. In the [Firebase console](https://console.firebase.google.com/), create a new project on **Spark** and register a **Web app**. Analytics is optional; Evergreen does not require it.
2. Create a **Cloud Firestore** database in production mode, choosing its region deliberately (it cannot be changed later). Do not enable Cloud Storage or Blaze.
3. Under **Authentication → Sign-in method**, enable **Google** and set the required support email. Under **Settings → Authorized domains**, add your Pages hostname and `localhost` for development. New projects may not authorize localhost automatically. Domains are hostnames, not repository URL paths.
4. Copy `wwwroot/firebase-config.example.json` to `wwwroot/firebase-config.json` and replace its placeholders with the registered app's public `apiKey`, `authDomain`, `projectId`, and `appId`. This local file is ignored by Git. Firebase web configuration is necessarily browser-visible; never put service-account keys, private credentials, or Admin SDK credentials in it.
5. Authenticate the CLI with `npx firebase login`, then deploy the committed ownership rules and payload index exemption:

   ```powershell
   npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   ```

6. For Pages, create the repository **Actions variable** `FIREBASE_WEB_CONFIG` containing the same public configuration JSON. The publish workflow validates/injects it before publication. Missing configuration stops publication; running an unconfigured local app displays a setup error instead of silently using an unsaved garden.

Google sign-in uses a popup to avoid cross-origin redirect-storage restrictions on static Pages hosting. Permit popups when prompted. The app never uses Firebase Admin APIs or a server-only dependency.

### Offline data and conflicts

After one successful online sign-in and garden load, the published app caches its static assets for offline startup, and Firestore/IndexedDB retain a private-account projection and durable edit queue on this device. First-time sign-in and new-account initialization need connectivity. Development builds do not cache the app shell.

Queued edits appear immediately with a **pending** status, not a claim of successful cloud persistence. Online synchronization applies each operation atomically with a receipt so reload/retry cannot duplicate it, then reads the accepted documents into the local cache before removing the queued projection. These confirmation reads also count toward the daily quota. Updates patch only changed fields; independent fields/records merge, while competing changes to the same field use the last server-accepted write. A daily watering event has a deterministic plant/date ID; undo does not erase manually logged care or older days.

Failed edits remain visibly marked on the device for retry (including quota/rule failures). Sign-out waits for pending/failed edits to synchronize rather than discarding them, clears the Firestore cache, and coordinates other tabs. Browser/device storage is not a backup: clearing site data before synchronization loses local-only edits. Do not use shared devices for confidential garden notes. Unsupported IndexedDB/Web Locks is explicitly reported. The local queue may remain for a previous account if authentication is externally changed; it is isolated by UID and resumes only when that same account signs in.

Service-worker updates wait until existing app tabs close, avoiding forced reloads while editing. Static caching excludes Firebase API/auth traffic; garden and photo data are not put into the static asset cache.

### Photos and free-tier limits

JPEG/PNG/WebP uploads are limited to 5 MiB input and converted to JPEG with a white background, a longest edge of at most 1,600 pixels, and at most **512 KiB decoded image bytes**. Compression reduces quality/dimensions; impossible or invalid inputs show an error. Attachments use separate documents, are fetched only on request, and save atomically with journal metadata. The payload field is not indexed.

[Firestore quotas](https://firebase.google.com/docs/firestore/quotas#collections_documents_and_fields) include **1 MiB per document**, **1 GiB total stored data**, **50,000 reads/day**, and **20,000 writes/day** on Spark. Base64 expands image data by about one third; the image cap leaves document-size headroom but images still consume the same database quota as garden data. Operation receipts also consume storage/writes. There is no unlimited-photo promise; monitor Firebase usage, and resolve quota exhaustion before retrying. No automatic paid upgrade is configured.

[Cloud Storage now requires Blaze](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), even for no-cost usage. Evergreen deliberately does not use that product.

### Integration validation

To validate the published app using local demo emulators (no production project or credentials):

```powershell
dotnet publish Evergreen.csproj --configuration Release --output publish
npx playwright install chromium
node --test Tests\pwa-browser.test.mjs
npm run test:browser
```

The PWA browser tests verify published asset hashes, browser installability diagnostics, offline reloads, translations, and non-forced updates at both root and repository-subpath URLs. The Firebase test server uses only the `demo-evergreen` Auth/Firestore emulators, serves the app under a repository subpath, and exercises browser Back/Forward and deep links, offline/reload, photos, language, and account isolation. Production Google OAuth, authorized domains, actual Firebase connectivity, and installation on physical iPhone/iPad or Android devices still require smoke tests.

## View navigation

Moving between Today, Plants, Places, Journal, and plant profiles creates browser history entries without reloading the app. Use browser Back/Forward to retrace these visits. Selecting the current destination does not add another entry. The profile's **Back to plants** control always opens Plants, even when the profile was opened directly.

View links use query parameters relative to the site's base URL: `?view=plants`, `?view=places`, `?view=journal`, and `?view=profile&plant=<plant-id>`. Today uses the base URL. Opening a place's plants also includes `place=<place-id>`. These links work on static hosting and restore the destination after sign-in and garden loading. Unavailable plants show a message rather than another account's data; invalid view names return to Today without adding a history entry.

Ordinary search/filter changes, language changes, care edits, and opening/closing dialogs do not create history entries. Navigating to another destination, including with Back/Forward, closes open dialogs and discards their unsaved inputs. Garden edits and pending offline synchronization are unaffected.

## Languages and localization

Evergreen supports English (the fallback), Spanish, and German. On startup, a saved language choice takes precedence over the first supported browser language; regional variants such as `es-MX` and `de-AT` use Spanish and German. Unsupported languages fall back to English.

Use the language selector in the header or an open dialog to switch immediately without losing plants, watering progress, journal entries, filters, or form inputs. The signed-in account's language is synchronized through Firestore; browser localStorage (`evergreen.culture`) is only a startup hint before account data loads. If local storage is blocked, switching continues to work with a warning. View navigation is stored in the URL, not synchronized to the account. Search, ordinary filters, and unsaved form contents are transient and not synchronized.

Application translations live in `Resources/AppResources.resx` (English), `Resources/AppResources.es.resx`, and `Resources/AppResources.de.resx`. Keep resource keys and numbered placeholders identical across files. Use complete messages, singular/plural variants where needed, and the shared localization helper for lookups and explicit culture-aware formatting. Internal navigation/filter values must not depend on translated labels.

Built-in care advice and sample journal text are translated when rendered. Plant/place names, botanical names, and user-entered text are not translated. Historical sample dates remain unchanged; new care entries and daily watering progress use actual local dates, with localized date, weekday, and month labels.

The small translation map in `wwwroot/localization.js` is limited to loading and fatal-error text needed before .NET starts. Keep those strings aligned with the application error resources. Startup loads all satellite resources and globalization data to support live switching on static hosting.

## GitHub Pages deployment

The [GitHub Pages workflow](.github/workflows/pages.yml) deploys static files from the root of `gh-pages`:

- Pushes to `master` publish the app, update `gh-pages`, and then deploy it in the same workflow run.
- Direct pushes to `gh-pages` deploy the existing files without rebuilding.
- **Actions → GitHub Pages → Run workflow** deploys the existing `gh-pages` branch without republishing.

To enable deployment, configure the repository's **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Allow the workflow's `GITHUB_TOKEN` to write to `gh-pages`, and ensure the `github-pages` environment permits deployment from both `master` and `gh-pages`. No personal access token is required.

The first successful push build on `master` creates `gh-pages`; manual deployment requires that branch to exist already. Publication preserves branch history but replaces its static contents, so manual edits to generated files are overwritten by the next source publication. A copy of the Pages workflow is included on `gh-pages` to support direct branch pushes; workflow and Git metadata are excluded from the deployed site.

Published files use the repository's Pages base path (or `/` for an owner Pages repository) and include `404.html` for client-side routing and `.nojekyll` for static hosting. The workflow explicitly deploys after publishing because branch pushes made with `GITHUB_TOKEN` do not trigger another workflow run.

## Project layout

- `Components/Pages/` contains the Blazor pages, including the plant-care dashboard in `Home.razor`.
- `Components/Layout/` contains shared layout and navigation components.
- `wwwroot/` contains styles, images, and static libraries.
- `Program.cs` configures the Blazor WebAssembly app.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [CHANGELOG.md](CHANGELOG.md) for notable changes. This project is distributed under the terms in [LICENSE](LICENSE).
