# Project Guidelines

## Project

- This is a .NET 10 Blazor app using interactive server rendering. See `Program.cs` and `LittleJungle.csproj`.
- The plant-care dashboard and its current sample data are in `Components/Pages/Home.razor`.
- App data is currently held in component memory; do not imply that it is persisted.
- Keep static assets in `wwwroot/` and reuse the existing application styles where practical.

## Build and validation

- Build with `dotnet build LittleJungle.csproj`.
- There is no automated test project yet. If behavior changes, add or update appropriate tests when a test project is introduced.
- Keep the GitHub Actions build workflow in sync with the supported .NET SDK.

## Configuration and security

- Never commit credentials, private keys, or machine-specific settings.
- Use environment variables or .NET user secrets for local secrets; keep committed `appsettings*.json` files free of secrets.
- Preserve the existing interactive server rendering and antiforgery configuration unless a change intentionally requires otherwise.
