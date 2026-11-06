using Evergreen.Components;
using Evergreen.Components.Plants;
using Evergreen.Components.Garden;
using Evergreen.Localization;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
builder.Services.AddLocalization(options => options.ResourcesPath = "Resources");
builder.Services.AddScoped<LocalizationService>();
builder.Services.AddScoped(_ => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<PlantCatalogService>();
builder.Services.AddScoped<GardenStorageService>();

var host = builder.Build();
await host.Services.GetRequiredService<LocalizationService>().InitializeAsync();
await host.RunAsync();
