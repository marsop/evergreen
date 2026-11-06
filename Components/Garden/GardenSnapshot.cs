using System.Text.Json.Serialization;
using Evergreen.Components.Plants;

namespace Evergreen.Components.Garden;

public sealed class GardenSnapshot
{
    [JsonRequired]
    public int Version { get; set; } = 1;
    [JsonRequired]
    public List<GardenPlant> Plants { get; set; } = [];
    [JsonRequired]
    public List<GardenPlace> Places { get; set; } = [];
    [JsonRequired]
    public List<GardenEntry> Entries { get; set; } = [];

    public bool IsValid(IReadOnlyList<PlantCatalogEntry> catalog)
    {
        if (Version != 1 || Plants is null || Places is null || Entries is null)
            return false;
        var placeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var place in Places)
        {
            if (place is null || string.IsNullOrWhiteSpace(place.Name) || !placeNames.Add(place.Name) ||
                !Lights.Contains(place.Light) || place.Temperature is null || place.Note is null ||
                place.TemperatureKey is not (null or "WinterTemperature" or "Outdoor") ||
                place.NoteKey is not (null or "PanopticonAdvice"))
                return false;
        }
        var plantIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var plant in Plants)
        {
            if (plant is null || string.IsNullOrWhiteSpace(plant.Id) || !plantIds.Add(plant.Id) ||
                plant.Name is null || string.IsNullOrWhiteSpace(plant.Species) ||
                !Places.Any(place => place.Name == plant.Location) || !Categories.Contains(plant.Category) ||
                plant.Image is null || plant.WaterAmount is null || plant.Light is null ||
                (plant.CatalogId is not null && !catalog.Any(item => item.Id == plant.CatalogId)) ||
                (plant.CatalogId is null && (string.IsNullOrWhiteSpace(plant.Name) ||
                    !catalog.Any(item => item.Id == plant.CareCatalogId))))
                return false;
        }
        foreach (var entry in Entries)
        {
            if (entry is null || !plantIds.Contains(entry.PlantId) || !EntryTypes.Contains(entry.Type) ||
                entry.TitleKey != "Journal" + entry.Type + "Title" ||
                entry.DescriptionKey != (entry.AutomaticWatering ? "WateringDescription" : entry.TitleKey) ||
                (entry.AutomaticWatering && entry.Type != "Watered") || entry.Date == default ||
                entry.SortOrder <= 0 || entry.PhotoData is null ||
                (entry.PhotoData.Length > 0 && !entry.PhotoData.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal)))
                return false;
        }
        return true;
    }

    public static readonly string[] Categories = ["Succulents & dry", "Tropical, let top dry", "Tropical, evenly moist", "Mediterranean"];
    public static readonly string[] EntryTypes = ["Watered", "Fertilized", "Repotted", "Pruned", "Treated", "Photo"];
    public static readonly string[] Lights = ["Bright, filtered", "Direct afternoon sun", "Full sun", "Low light", "Full sun to shade"];
}

public sealed class GardenPlant
{
    [JsonRequired]
    public string Id { get; set; } = string.Empty;
    [JsonRequired]
    public string? CatalogId { get; set; }
    [JsonRequired]
    public string? CareCatalogId { get; set; }
    [JsonRequired]
    public string Name { get; set; } = string.Empty;
    [JsonRequired]
    public string Species { get; set; } = string.Empty;
    [JsonRequired]
    public string Location { get; set; } = string.Empty;
    [JsonRequired]
    public string Category { get; set; } = string.Empty;
    [JsonRequired]
    public string Image { get; set; } = string.Empty;
    [JsonRequired]
    public string WaterAmount { get; set; } = string.Empty;
    [JsonRequired]
    public string Light { get; set; } = string.Empty;
    [JsonRequired]
    public DateOnly? WateredOn { get; set; }
}

public sealed record GardenPlace(string Name, string Light, string Temperature, bool Outdoor, string Note,
    string? TemperatureKey = null, string? NoteKey = null);

public sealed record GardenEntry(string TitleKey, string DescriptionKey, string Type, DateOnly Date,
    long SortOrder, string PlantId, string PhotoData = "", string? UserNote = null, bool AutomaticWatering = false);
