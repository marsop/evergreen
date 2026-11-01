using System.Text.Json.Serialization;
using System.Globalization;

namespace Evergreen.Data;

public sealed class Plant(string name, string species, string location, string category, string waterAmount, string light, string image, bool isSelected = false)
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = name;
    public string Species { get; set; } = species;
    public string PlaceId { get; set; } = "";
    public string Category { get; set; } = category;
    public string WaterAmount { get; set; } = waterAmount;
    public string Light { get; set; } = light;
    public string Image { get; set; } = image;
    [JsonIgnore] public string Location { get; set; } = location;
    [JsonIgnore] public bool IsSelected { get; set; } = isSelected;
    [JsonIgnore] public bool Watered { get; set; }
}

public sealed record Place(string Name, string Light, string Temperature, bool Outdoor, string Note, string? TemperatureKey = null)
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
}

public sealed record JournalEntry(string TitleKey, string DescriptionKey, string Type, DateOnly? Date, long SortOrder,
    string PlantName = "", string PhotoData = "", string? UserNote = null, string WaterAmount = "")
{
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public string PlantId { get; init; } = "";
    public string PhotoId { get; init; } = "";
}

public sealed class GardenSnapshot
{
    public string Uid { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool Ready { get; set; }
    public bool FromCache { get; set; }
    public bool Offline { get; set; }
    public bool PersistenceUnavailable { get; set; }
    public bool AppCacheUnavailable { get; set; }
    public int Pending { get; set; }
    public int Failed { get; set; }
    public string Error { get; set; } = "";
    public string Language { get; set; } = "";
    public List<Plant> Plants { get; set; } = [];
    public List<Place> Places { get; set; } = [];
    public List<JournalEntry> JournalEntries { get; set; } = [];

    public void ResolveRelationships(DateOnly today)
    {
        foreach (var plant in Plants)
        {
            plant.Location = Places.FirstOrDefault(place => place.Id == plant.PlaceId)?.Name ?? "";
            plant.Watered = JournalEntries.Any(entry => entry.Id == WateringId(plant.Id, today));
        }
    }

    public static string WateringId(string plantId, DateOnly day) =>
        $"water-{plantId}-{day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";
}

public sealed record GardenSeed(List<Plant> Plants, List<Place> Places, List<JournalEntry> JournalEntries);
public sealed record GardenWrite(string Collection, string Id, object? Data, bool Delete = false);
public sealed record CompressedPhoto(string Payload, int Bytes, int Width, int Height);
