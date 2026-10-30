using System.Collections;
using System.Globalization;
using System.Resources;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Evergreen.Localization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Localization;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Evergreen.Tests;

public sealed class LocalizationTests
{
    [Theory]
    [InlineData("en", "en")]
    [InlineData("en-GB", "en")]
    [InlineData("ES-mx", "es")]
    [InlineData("de_DE", "de")]
    [InlineData(" de-AT ", "de")]
    [InlineData("fr-FR", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("not a language!", null)]
    [InlineData("en-@@", null)]
    public void NormalizesOnlySupportedLanguages(string? input, string? expected) =>
        Assert.Equal(expected, CultureSelection.Normalize(input));

    [Theory]
    [InlineData("de-DE", "es-MX", "de")]
    [InlineData(null, "es-MX", "es")]
    [InlineData("fr", "de-AT", "de")]
    [InlineData(null, "ja", "en")]
    public void SavedSelectionOverridesBrowserWithEnglishFallback(string? saved, string browser, string expected) =>
        Assert.Equal(expected, CultureSelection.Resolve(saved, [browser]));

    [Fact]
    public void ResolvesFirstSupportedBrowserLanguage() =>
        Assert.Equal("de", CultureSelection.Resolve(null, ["fr-CA", "de-AT", "es"]));

    [Theory]
    [InlineData("es")]
    [InlineData("de")]
    public void TranslationsHaveExactlyTheSameKeysAndPlaceholders(string language)
    {
        var english = ReadResources("AppResources.resx");
        var translated = ReadResources($"AppResources.{language}.resx");
        Assert.Equal(english.Keys.Order(), translated.Keys.Order());
        foreach (var (key, value) in english)
        {
            Assert.False(string.IsNullOrWhiteSpace(translated[key]), key);
            Assert.Equal(Placeholders(value), Placeholders(translated[key]));
            Assert.Equal(CompositeFormat.Parse(value).MinimumArgumentCount,
                CompositeFormat.Parse(translated[key]).MinimumArgumentCount);
        }
    }

    [Theory]
    [InlineData("en", "Today")]
    [InlineData("es", "Hoy")]
    [InlineData("de", "Heute")]
    [InlineData("fr", "Today")]
    [InlineData("es-MX", "Hoy")]
    public void CompiledResourcesResolveWithNeutralAndParentFallback(string culture, string expected)
    {
        var resources = new ResourceManager("Evergreen.Resources.AppResources", typeof(AppResources).Assembly);
        Assert.Equal(expected, resources.GetString("Today", CultureInfo.GetCultureInfo(culture)));
    }

    [Theory]
    [InlineData("es")]
    [InlineData("de")]
    public void CompiledSatelliteResourcesContainEveryTranslation(string language)
    {
        var manager = new ResourceManager("Evergreen.Resources.AppResources", typeof(AppResources).Assembly);
        var resources = manager.GetResourceSet(CultureInfo.GetCultureInfo(language), true, false);
        Assert.NotNull(resources);
        var compiled = resources.Cast<DictionaryEntry>().ToDictionary(entry => (string)entry.Key, entry => (string)entry.Value!);
        Assert.Equal(ReadResources($"AppResources.{language}.resx").OrderBy(pair => pair.Key),
            compiled.OrderBy(pair => pair.Key));
    }

    [Theory]
    [InlineData("en", 0, "0 plants")]
    [InlineData("en", 1, "1 plant")]
    [InlineData("en", 2, "2 plants")]
    [InlineData("es", 0, "0 plantas")]
    [InlineData("es", 1, "1 planta")]
    [InlineData("es", 2, "2 plantas")]
    [InlineData("de", 0, "0 Pflanzen")]
    [InlineData("de", 1, "1 Pflanze")]
    [InlineData("de", 2, "2 Pflanzen")]
    public async Task FormatsCountVariants(string language, int count, string expected)
    {
        using var services = CreateServices();
        var localizer = services.GetRequiredService<IStringLocalizer<AppResources>>();
        var service = CreateService(language);
        await service.InitializeAsync();
        Assert.Equal(expected, service.Translate(localizer, count == 1 ? "PlantCountOne" : "PlantCountMany", count));
    }

    [Theory]
    [InlineData("en", "Sunday", "October", "Watered Monstera")]
    [InlineData("es", "domingo", "octubre", "Riego de Monstera")]
    [InlineData("de", "Sonntag", "Oktober", "Monstera gegossen")]
    public async Task FormatsSampleDateAndGeneratedJournalTitle(string language, string day, string month, string title)
    {
        using var services = CreateServices();
        var service = CreateService(language);
        await service.InitializeAsync();
        var localizer = services.GetRequiredService<IStringLocalizer<AppResources>>();
        var date = new DateOnly(2026, 10, 18).ToString(service.Translate(localizer, "DashboardDateFormat"), service.Culture);
        Assert.Contains(day, date);
        Assert.Contains(month, date);
        Assert.Equal(title, service.Translate(services.GetRequiredService<IStringLocalizer<AppResources>>(),
            "JournalWateredTitle", "Monstera"));
    }

    [Fact]
    public async Task LookupUsesSelectedCultureEvenWhenAmbientCultureDiffers()
    {
        using var services = CreateServices();
        var service = CreateService("es");
        await service.InitializeAsync();
        CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("de");
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de");
        Assert.Equal("Hoy", service.Translate(services.GetRequiredService<IStringLocalizer<AppResources>>(), "Today"));
        Assert.Equal("de", CultureInfo.CurrentUICulture.Name);
        Assert.Equal("de", CultureInfo.CurrentCulture.Name);
    }

    [Fact]
    public async Task StorageFailureStillAppliesCultureAndNotifiesConsumers()
    {
        var js = new BrowserJs { SaveSucceeds = false };
        var service = new LocalizationService(js, NullLogger<LocalizationService>.Instance);
        await service.InitializeAsync();
        var changes = 0;
        service.Changed += () => changes++;
        await service.SetCultureAsync("de-DE");
        Assert.Equal("de", service.Culture.Name);
        Assert.True(service.PreferenceUnavailable);
        Assert.Equal(1, changes);
        Assert.Contains("evergreenLocalization.applyCulture", js.Calls);
        Assert.Contains("evergreenLocalization.saveCulture", js.Calls);
    }

    [Fact]
    public async Task SuccessfulSaveClearsInitialStorageWarning()
    {
        var js = new BrowserJs { Preference = new() { StorageUnavailable = true } };
        var service = new LocalizationService(js, NullLogger<LocalizationService>.Instance);
        await service.InitializeAsync();
        Assert.True(service.PreferenceUnavailable);
        await service.SetCultureAsync("es");
        Assert.False(service.PreferenceUnavailable);
    }

    [Fact]
    public async Task InvalidLanguageIsRejectedWithoutInvokingBrowserInterop()
    {
        var js = new BrowserJs();
        var service = new LocalizationService(js, NullLogger<LocalizationService>.Instance);
        await Assert.ThrowsAsync<ArgumentException>(() => service.SetCultureAsync("fr"));
        Assert.Empty(js.Calls);
    }

    private static Dictionary<string, string> ReadResources(string filename) =>
        XDocument.Load(Path.Combine(AppContext.BaseDirectory, "Resources", filename))
            .Root!.Elements("data")
            .ToDictionary(element => element.Attribute("name")!.Value, element => element.Element("value")!.Value);

    private static string[] Placeholders(string value) =>
        Regex.Matches(value, @"\{\d+(?:[^}]*)\}").Select(match => match.Value).Order().ToArray();

    private static ServiceProvider CreateServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddLocalization(options => options.ResourcesPath = "Resources");
        return services.BuildServiceProvider();
    }

    private static LocalizationService CreateService(string language) =>
        new(new BrowserJs { Preference = new() { SavedCulture = language } }, NullLogger<LocalizationService>.Instance);

    private sealed class BrowserJs : IJSRuntime
    {
        public LocalizationService.BrowserPreference Preference { get; init; } = new();
        public bool SaveSucceeds { get; init; } = true;
        public List<string> Calls { get; } = [];

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) =>
            InvokeAsync<TValue>(identifier, CancellationToken.None, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            Calls.Add(identifier);
            return identifier switch
            {
                "evergreenLocalization.initialize" => ValueTask.FromResult((TValue)(object)Preference),
                "evergreenLocalization.saveCulture" => ValueTask.FromResult((TValue)(object)SaveSucceeds),
                "evergreenLocalization.applyCulture" => ValueTask.FromResult(default(TValue)!),
                _ => throw new InvalidOperationException($"Unexpected JS call: {identifier}")
            };
        }
    }
}
