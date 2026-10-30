using System.Globalization;
using Microsoft.Extensions.Localization;
using Microsoft.JSInterop;

namespace Evergreen.Localization;

public sealed class LocalizationService(IJSRuntime js, ILogger<LocalizationService> logger)
{
    public CultureInfo Culture { get; private set; } = CultureInfo.GetCultureInfo("en");
    public bool PreferenceUnavailable { get; private set; }
    public event Action? Changed;

    public async Task InitializeAsync()
    {
        var preference = await js.InvokeAsync<BrowserPreference>("evergreenLocalization.initialize");
        var resolved = CultureSelection.Resolve(preference.SavedCulture, preference.BrowserLanguages);
        ApplyCulture(resolved);
        PreferenceUnavailable = preference.StorageUnavailable;
        await js.InvokeVoidAsync("evergreenLocalization.applyCulture", resolved);
    }

    public async Task SetCultureAsync(string language)
    {
        var normalized = CultureSelection.Normalize(language)
            ?? throw new ArgumentException("Unsupported language.", nameof(language));
        try
        {
            await js.InvokeVoidAsync("evergreenLocalization.applyCulture", normalized);
            var saved = await js.InvokeAsync<bool>("evergreenLocalization.saveCulture", normalized);
            ApplyCulture(normalized);
            PreferenceUnavailable = !saved;
            if (!saved)
            {
                logger.LogWarning("The language preference could not be saved in browser storage.");
            }
            Changed?.Invoke();
        }
        catch (JSException exception)
        {
            logger.LogError(exception, "Unable to change the application language.");
            throw;
        }
    }

    public string Translate(IStringLocalizer localizer, string key, params object[] arguments)
    {
        var previousCulture = CultureInfo.CurrentCulture;
        var previousUiCulture = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = Culture;
            CultureInfo.CurrentUICulture = Culture;
            return arguments.Length == 0 ? localizer[key].Value : localizer[key, arguments].Value;
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
            CultureInfo.CurrentUICulture = previousUiCulture;
        }
    }

    private void ApplyCulture(string language)
    {
        Culture = CultureInfo.GetCultureInfo(language);
        CultureInfo.DefaultThreadCurrentCulture = Culture;
        CultureInfo.DefaultThreadCurrentUICulture = Culture;
        CultureInfo.CurrentCulture = Culture;
        CultureInfo.CurrentUICulture = Culture;
    }

    public sealed class BrowserPreference
    {
        public string? SavedCulture { get; set; }
        public string[] BrowserLanguages { get; set; } = [];
        public bool StorageUnavailable { get; set; }
    }
}
