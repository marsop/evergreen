# Contributing

Thanks for helping improve Evergreen.

## Set up

1. Install the .NET 10 SDK.
2. Clone the repository and open its root directory.
3. Run `dotnet restore` to restore dependencies.
4. Run `dotnet run --project Evergreen.csproj` to start the app. The HTTP profile uses `http://localhost:5287`.

## Before opening a pull request

- Build the app with `dotnet build Evergreen.csproj --configuration Release`.
- Describe the user-visible change and any relevant limitations in the pull request.
- Include screenshots for visual changes when useful.
- Do not include generated build output, local settings, or secrets.

There is currently no automated test project. If you add one, include its test command here and in the CI workflow.
