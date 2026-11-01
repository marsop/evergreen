using System.Text.Json;
using Evergreen.Data;

namespace Evergreen.Tests;

public sealed class GardenTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void SamplesHaveDeterministicIdsAndCompleteRelationships()
    {
        var first = GardenSamples.Create();
        var second = GardenSamples.Create();
        Assert.Equal(23, first.Plants.Count);
        Assert.Equal(5, first.Places.Count);
        Assert.Equal(6, first.JournalEntries.Count);
        Assert.Equal(first.Plants.Select(plant => plant.Id), second.Plants.Select(plant => plant.Id));
        Assert.All(first.Plants, plant => Assert.Contains(first.Places, place => place.Id == plant.PlaceId));
        Assert.All(first.JournalEntries.Where(entry => entry.PlantName.Length > 0),
            entry => Assert.Contains(first.Plants, plant => plant.Id == entry.PlantId));
    }

    [Fact]
    public void SerializedPlantsDoNotContainTransientOrNameBasedRelationships()
    {
        var plant = new Plant("Fern", "Fern", "Kitchen", "Tropical, evenly moist", "Normal", "Filtered", "")
            { Id = "plant-1", PlaceId = "place-1", Watered = true, IsSelected = true };
        var document = JsonSerializer.SerializeToElement(plant, Json);
        Assert.Equal("place-1", document.GetProperty("placeId").GetString());
        Assert.False(document.TryGetProperty("location", out _));
        Assert.False(document.TryGetProperty("watered", out _));
        Assert.False(document.TryGetProperty("isSelected", out _));
        var restored = JsonSerializer.Deserialize<Plant>(document, Json);
        Assert.NotNull(restored);
        Assert.Equal(plant.Id, restored.Id);
        Assert.Equal(plant.Name, restored.Name);
    }

    [Fact]
    public void RelationshipsAndDailyWateringResolveAfterReloadAndRename()
    {
        var today = new DateOnly(2026, 10, 31);
        var plant = new Plant("Renamed fern", "Fern", "", "Tropical, evenly moist", "Normal", "Filtered", "")
            { Id = "plant-1", PlaceId = "place-1" };
        var state = new GardenSnapshot
        {
            Plants = [plant],
            Places = [new("Renamed place", "Low light", "20 C", false, "") { Id = "place-1" }],
            JournalEntries = [new("JournalWateredTitle", "WateringDescription", "Watered", today, 1)
                { Id = GardenSnapshot.WateringId(plant.Id, today), PlantId = plant.Id }]
        };
        state.ResolveRelationships(today);
        Assert.Equal("Renamed place", plant.Location);
        Assert.True(plant.Watered);
        state.ResolveRelationships(today.AddDays(1));
        Assert.False(plant.Watered);
        Assert.Single(state.JournalEntries);
    }

    [Fact]
    public void JournalAndPhotoHaveStableSerializableReferences()
    {
        var entry = new JournalEntry("JournalPhotoTitle", "JournalPhotoTitle", "Photo", new(2026, 10, 31), 10)
            { Id = "entry-1", PlantId = "plant-1", PhotoId = "entry-1" };
        var restored = JsonSerializer.Deserialize<JournalEntry>(JsonSerializer.Serialize(entry, Json), Json);
        Assert.Equal(entry, restored);
        Assert.Empty(restored!.PhotoData);
    }
}
