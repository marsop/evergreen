# Evergreen

Evergreen is a Blazor WebAssembly plant-care dashboard for keeping track of plants, growing places, and care journal entries. It runs in the browser and can be hosted as static files on GitHub Pages.

## Features

- Today view with care tasks and watering progress
- Plant list, search, profiles, and plant editing
- Growing-place management
- Care journal with notes and optional photos
- Interactive client-rendered UI
- Browser Back/Forward navigation between views and plant profiles
- English, Spanish, and German with instant language switching

The current app is a prototype: its plant, place, and journal data lives in browser memory and is not saved across page reloads.

## View navigation

Moving between Today, Plants, Places, Journal, and plant profiles creates browser history entries without reloading the app. Browser Back/Forward retraces those visits while preserving in-memory garden edits. Selecting the current destination does not add a duplicate entry. The profile's **Back to plants** control always opens Plants rather than leaving the app.

View links use query parameters relative to the site's base URL: `?view=plants`, `?view=places`, `?view=journal`, and `?view=profile&plant=<plant-id>`. Today uses the base URL. Opening a place's plants also includes `place=<encoded-place-name>`. Sample plant links survive reloads; newly added plants remain in memory only, so their links show an unavailable message after reload. Invalid view names return to Today without adding a history entry.

Search, ordinary filter changes, language changes, care edits, and opening/closing dialogs do not create history entries. Navigating to a different destination, including with Back/Forward, closes dialogs and discards their unsaved inputs.

## Requirements

- .NET 10 SDK

## Run locally

From the repository root:

```powershell
dotnet run --project Evergreen.csproj
```

The Blazor WebAssembly development server URL is printed when the app starts. To build without starting the app:

```powershell
dotnet build Evergreen.csproj
```

Run the localization tests with:

```powershell
dotnet test Tests\Evergreen.Tests.csproj
node --test Tests\localization.test.cjs
```

The JavaScript tests require Node.js 22 or later. The [CI workflow](.github/workflows/ci.yml) builds the app in Release configuration and runs the localization and browser navigation suites for source pushes and pull requests, excluding the generated `gh-pages` branch.

Run the browser navigation regression test against a fresh static publication:

```powershell
npm ci
npx playwright install chromium
dotnet publish Evergreen.csproj --configuration Release --output publish
npm run test:browser
```

The browser tests serve the app at both root and repository-subpath URLs and verify real Back/Forward traversal, desktop/mobile navigation, deep links, dialog dismissal, translations, and preservation of in-memory garden edits.

## Languages and localization

Evergreen supports English (the fallback), Spanish, and German. On startup, a saved language choice takes precedence over the first supported browser language; regional variants such as `es-MX` and `de-AT` use Spanish and German. Unsupported languages fall back to English.

Use the language selector in the header or an open dialog to switch immediately without losing plants, watering progress, journal entries, filters, or form inputs. Only the language choice is saved in browser localStorage (`evergreen.culture`); garden data still resets on a page reload. If storage is blocked, switching continues to work and a warning explains that the preference cannot be saved.

Application translations live in `Resources/AppResources.resx` (English), `Resources/AppResources.es.resx`, and `Resources/AppResources.de.resx`. Keep resource keys and numbered placeholders identical across files. Use complete messages, singular/plural variants where needed, and the shared localization helper for lookups and explicit culture-aware formatting. Internal navigation/filter values must not depend on translated labels.

Built-in care advice and generated journal text are translated when rendered. The journal starts empty; entries added manually or through care actions are kept for the current session. Plant/place names, botanical names, and user-entered text are not translated. The prototype's sample dates and care schedule remain unchanged, with localized date, weekday, and month labels.

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
