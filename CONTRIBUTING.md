# Contributing

Thanks for helping improve Evergreen.

## Set up

1. Install the .NET 10 SDK and Node.js 22 or later.
2. Clone the repository and open its root directory.
3. Run `npm ci` and `dotnet restore` to restore dependencies. Follow [Firebase setup](README.md#firebase-setup-spark-no-billing-account) for public configuration and a Spark project.
4. Run `dotnet run --project Evergreen.csproj` to start the app. The HTTP profile uses `http://localhost:5287`.

## Before opening a pull request

- Build the app with `dotnet build Evergreen.csproj --configuration Release`.
- Run `dotnet test Tests\Evergreen.Tests.csproj` and `node --test Tests\localization.test.cjs` (Node.js 22 or later).
- Run `npm run test:client` and `npm run test:rules` (Java 21 required for emulators). For integration/UI changes, run the [published browser tests](README.md#integration-validation).
- Keep Firestore schema/rules/index exemptions consistent with client writes; test unauthorized access, offline reload/retry, atomic attachments, and pending-write sign-out.
- Describe the user-visible change and any relevant limitations in the pull request.
- Include screenshots for visual changes when useful.
- Do not include generated build output, local settings, or secrets.

For UI changes, update all three `Resources/AppResources*.resx` files with matching keys and placeholders. Keep user content and stable internal identifiers separate from translated labels. Check language switching without reloading, including open forms, and check Spanish/German text at mobile widths. See [README.md](README.md#languages-and-localization) for the localization design.
