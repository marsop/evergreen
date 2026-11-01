using Evergreen.Components;
using Evergreen.Localization;
using Evergreen.Data;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");
builder.Services.AddLocalization(options => options.ResourcesPath = "Resources");
builder.Services.AddScoped<LocalizationService>();
builder.Services.AddScoped<GardenService>();

var host = builder.Build();
await host.Services.GetRequiredService<LocalizationService>().InitializeAsync();
await host.RunAsync();
