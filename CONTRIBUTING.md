# Contributing

Thanks for helping improve Evergreen.

## Set up

1. Install the .NET 10 SDK.
2. Clone the repository and open its root directory.
3. Run `dotnet restore` to restore dependencies.
4. Run `dotnet run --project Evergreen.csproj` to start the app. The HTTP profile uses `http://localhost:5287`.

## Before opening a pull request

- Build the app with `dotnet build Evergreen.csproj --configuration Release`.
- Run `dotnet test Tests\Evergreen.Tests.csproj` and `node --test Tests\localization.test.cjs` (Node.js 22 or later).
- Describe the user-visible change and any relevant limitations in the pull request.
- Include screenshots for visual changes when useful.
- Do not include generated build output, local settings, or secrets.

For UI changes, update all three `Resources/AppResources*.resx` files with matching keys and placeholders. Keep user content and stable internal identifiers separate from translated labels. Check language switching without reloading, including open forms, and check Spanish/German text at mobile widths. See [README.md](README.md#languages-and-localization) for the localization design.
