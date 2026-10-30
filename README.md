# Little Jungle

Little Jungle is a Blazor Server plant-care dashboard for keeping track of plants, growing places, and care journal entries.

## Features

- Today view with care tasks and watering progress
- Plant list, search, profiles, and plant editing
- Growing-place management
- Care journal with notes and optional photos
- Interactive server-rendered UI

The current app is a prototype: its plant, place, and journal data lives in component memory and is not saved across page reloads or server restarts.

## Requirements

- .NET 10 SDK

## Run locally

From the repository root:

```powershell
dotnet run --project LittleJungle.csproj
```

The HTTP launch profile opens the app at `http://localhost:5287`. To build without starting the app:

```powershell
dotnet build LittleJungle.csproj
```

There is not currently an automated test project. The CI workflow builds the app in Release configuration.

## Project layout

- `Components/Pages/` contains the Blazor pages, including the plant-care dashboard in `Home.razor`.
- `Components/Layout/` contains shared layout and navigation components.
- `wwwroot/` contains styles, images, and static libraries.
- `Program.cs` configures the interactive server-rendered Blazor app.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [CHANGELOG.md](CHANGELOG.md) for notable changes. This project is distributed under the terms in [LICENSE](LICENSE).
