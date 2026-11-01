# Project Guidelines

## Project

- This is a .NET 10 Blazor WebAssembly app for static hosting. See `Program.cs` and `Evergreen.csproj`.
- The plant-care dashboard and its current sample data are in `Components/Pages/Home.razor`.
- Account data is stored in Firebase Firestore on Spark with an IndexedDB offline queue. Never report queued edits as cloud-synchronized.
- Keep static assets in `wwwroot/` and reuse the existing application styles where practical.

## Build and validation

- Build with `dotnet build Evergreen.csproj`.
- Run `npm ci` before building; MSBuild bundles the Firebase SDK locally. Firebase emulator tests require Java 21.
- Run localization tests with `dotnet test Tests\Evergreen.Tests.csproj` and `node --test Tests\localization.test.cjs` (Node.js 22 or later).
- Run Firebase tests with `npm run test:client`, `npm run test:rules`, and the published browser test documented in README.md.
- For localization changes, follow [the resource and live-switching guidance](README.md#languages-and-localization) and verify that switching preserves in-memory garden data.
- Keep the GitHub Actions build workflow in sync with the supported .NET SDK.

## Configuration and security

- Never commit credentials, private keys, or machine-specific settings.
- Use environment variables or .NET user secrets for local secrets; keep committed `appsettings*.json` files free of secrets.
- Keep the app compatible with static hosting on GitHub Pages; do not introduce server-only dependencies without an intentional hosting change.
- Keep UID ownership and schema validation in firestore.rules in sync with writes. Photo payloads must remain separately stored, bounded, and unindexed; do not enable Blaze or Cloud Storage.
