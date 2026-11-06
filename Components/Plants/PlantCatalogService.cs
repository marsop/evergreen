using System.Globalization;
using System.Net.Http.Json;

namespace Evergreen.Components.Plants;

public sealed class PlantCatalogService(HttpClient httpClient)
{
    private static readonly string[] SupportedLanguages = ["en", "es", "de"];
    private static readonly string[] RequiredCareDetails = ["Light", "Water", "Fertilizer", "TemperatureHumidity", "SubstrateRepotting", "Pruning", "Propagation"];
    private static readonly string[] RequiredWatchouts = ["YellowLeaves", "BrownEdges", "SpiderMites", "Thrips"];

    public async Task<IReadOnlyList<PlantCatalogEntry>> LoadAsync(CancellationToken cancellationToken = default)
    {
        var index = await httpClient.GetFromJsonAsync<PlantCatalogIndexEntry[]>("plants/index.json", cancellationToken)
            ?? throw new InvalidDataException("The plant catalog index is empty.");
        if (index.Length == 0)
            throw new InvalidDataException("The plant catalog index is empty.");

        var plants = new List<PlantCatalogEntry>(index.Length);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var folders = new HashSet<string>(StringComparer.Ordinal);

        foreach (var item in index)
        {
            if (string.IsNullOrWhiteSpace(item.Id) || !ids.Add(item.Id))
                throw new InvalidDataException($"The plant catalog contains an empty or duplicate plant ID '{item.Id}'.");
            if (!IsSafeFolderName(item.Folder) || !folders.Add(item.Folder))
                throw new InvalidDataException($"The plant catalog contains an invalid or duplicate folder '{item.Folder}'.");

            var plant = await httpClient.GetFromJsonAsync<PlantCatalogEntry>(
                $"plants/{item.Folder}/plant.json", cancellationToken)
                ?? throw new InvalidDataException($"Plant data is empty for '{item.Folder}'.");
            if (!string.Equals(item.Id, plant.Id, StringComparison.Ordinal))
                throw new InvalidDataException($"Plant ID mismatch in '{item.Folder}/plant.json'.");

            Validate(item.Folder, plant);
            plants.Add(plant);
        }

        return plants;
    }

    public static string LocalizedValue(IReadOnlyDictionary<string, string> values, CultureInfo culture)
    {
        var language = culture.TwoLetterISOLanguageName;
        if (values.TryGetValue(language, out var value))
            return value;
        if (values.TryGetValue("en", out value))
            return value;
        throw new InvalidDataException("Plant catalog text has no value for the active language or English fallback.");
    }

    private static void Validate(string folder, PlantCatalogEntry plant)
    {
        if (string.IsNullOrWhiteSpace(plant.Species) ||
            string.IsNullOrWhiteSpace(plant.Category) ||
            string.IsNullOrWhiteSpace(plant.Location) ||
            string.IsNullOrWhiteSpace(plant.Image) ||
            !plant.Image.StartsWith($"plants/{folder}/", StringComparison.Ordinal))
            throw new InvalidDataException($"Plant data is incomplete or has a non-colocated image in '{folder}/plant.json'.");

        ValidateTranslations(folder, "name", plant.Name);
        ValidateTranslations(folder, "profileAlert", plant.Care.ProfileAlert);
        foreach (var key in RequiredCareDetails)
        {
            if (!plant.Care.Details.TryGetValue(key, out var detail))
                throw new InvalidDataException($"Plant data in '{folder}/plant.json' is missing care detail '{key}'.");
            ValidateTranslations(folder, $"{key}.value", detail.Value);
            ValidateTranslations(folder, $"{key}.advice", detail.Advice);
            if (key == "Water")
            {
                if (detail.Amount is null)
                    throw new InvalidDataException($"Plant data in '{folder}/plant.json' is missing the watering amount.");
                ValidateTranslations(folder, $"{key}.amount", detail.Amount);
            }
        }

        if (plant.Care.Months.Count != 12 ||
            !plant.Care.Months.Select(month => month.Month).SequenceEqual(Enumerable.Range(1, 12)))
            throw new InvalidDataException($"Plant data in '{folder}/plant.json' must contain care for each month in order.");

        var watchouts = plant.Care.Watchouts.ToDictionary(item => item.Key, StringComparer.Ordinal);
        foreach (var key in RequiredWatchouts)
        {
            if (!watchouts.TryGetValue(key, out var watchout))
                throw new InvalidDataException($"Plant data in '{folder}/plant.json' is missing watchout '{key}'.");
            ValidateTranslations(folder, $"{key}.title", watchout.Title);
            ValidateTranslations(folder, $"{key}.advice", watchout.Advice);
        }
    }

    private static void ValidateTranslations(string folder, string field, IReadOnlyDictionary<string, string> values)
    {
        foreach (var language in SupportedLanguages)
        {
            if (!values.TryGetValue(language, out var value) || string.IsNullOrWhiteSpace(value))
                throw new InvalidDataException($"Plant data in '{folder}/plant.json' is missing {language} text for '{field}'.");
        }
    }

    private static bool IsSafeFolderName(string folder) =>
        !string.IsNullOrWhiteSpace(folder) &&
        folder.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
}

public sealed class PlantCatalogIndexEntry
{
    public string Id { get; set; } = string.Empty;
    public string Folder { get; set; } = string.Empty;
}

public sealed class PlantCatalogEntry
{
    public string Id { get; set; } = string.Empty;
    public Dictionary<string, string> Name { get; set; } = [];
    public string Species { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Image { get; set; } = string.Empty;
    public PlantCareProfile Care { get; set; } = new();
}

public sealed class PlantCareProfile
{
    public Dictionary<string, PlantCareDetail> Details { get; set; } = [];
    public List<PlantMonthCare> Months { get; set; } = [];
    public List<PlantWatchout> Watchouts { get; set; } = [];
    public Dictionary<string, string> ProfileAlert { get; set; } = [];
}

public sealed class PlantCareDetail
{
    public Dictionary<string, string> Value { get; set; } = [];
    public Dictionary<string, string> Advice { get; set; } = [];
    public Dictionary<string, string>? Amount { get; set; }
}

public sealed class PlantMonthCare
{
    public int Month { get; set; }
    public int Water { get; set; }
    public int Fertilizer { get; set; }
}

public sealed class PlantWatchout
{
    public string Key { get; set; } = string.Empty;
    public Dictionary<string, string> Title { get; set; } = [];
    public Dictionary<string, string> Advice { get; set; } = [];
}
