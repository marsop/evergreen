# Little Jungle

Little Jungle is a Blazor WebAssembly plant-care dashboard for keeping track of plants, growing places, and care journal entries. It runs in the browser and can be hosted as static files on GitHub Pages.

## Features

- Today view with care tasks and watering progress
- Plant list, search, profiles, and plant editing
- Growing-place management
- Care journal with notes and optional photos
- Interactive client-rendered UI

The current app is a prototype: its plant, place, and journal data lives in browser memory and is not saved across page reloads.

## Requirements

- .NET 10 SDK

## Run locally

From the repository root:

```powershell
dotnet run --project LittleJungle.csproj
```

The Blazor WebAssembly development server URL is printed when the app starts. To build without starting the app:

```powershell
dotnet build LittleJungle.csproj
```

There is not currently an automated test project. The CI workflow builds the app in Release configuration and deploys it to GitHub Pages when a commit is pushed to the repository's default branch.

To enable deployment, configure the repository's **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow publishes the app under the repository path and includes a static-hosting fallback for client-side routes.

## Project layout

- `Components/Pages/` contains the Blazor pages, including the plant-care dashboard in `Home.razor`.
- `Components/Layout/` contains shared layout and navigation components.
- `wwwroot/` contains styles, images, and static libraries.
- `Program.cs` configures the Blazor WebAssembly app.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [CHANGELOG.md](CHANGELOG.md) for notable changes. This project is distributed under the terms in [LICENSE](LICENSE).
