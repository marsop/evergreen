# Project Guidelines

## Project

- This is a .NET 10 Blazor WebAssembly app for static hosting. See `Program.cs` and `Evergreen.csproj`.
- The plant-care dashboard and its current sample data are in `Components/Pages/Home.razor`.
- App data is currently held in component memory; do not imply that it is persisted.
- Keep static assets in `wwwroot/` and reuse the existing application styles where practical.

## Build and validation

- Build with `dotnet build Evergreen.csproj`.
- Run localization tests with `dotnet test Tests\Evergreen.Tests.csproj` and `node --test Tests\localization.test.cjs` (Node.js 22 or later).
- For localization changes, follow [the resource and live-switching guidance](README.md#languages-and-localization) and verify that switching preserves in-memory garden data.
- Keep the GitHub Actions build workflow in sync with the supported .NET SDK.

## Configuration and security

- Never commit credentials, private keys, or machine-specific settings.
- Use environment variables or .NET user secrets for local secrets; keep committed `appsettings*.json` files free of secrets.
- Keep the app compatible with static hosting on GitHub Pages; do not introduce server-only dependencies without an intentional hosting change.
