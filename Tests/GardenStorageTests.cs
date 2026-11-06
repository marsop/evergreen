using System.Text.Json;
using Evergreen.Components.Garden;
using Evergreen.Components.Plants;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

namespace Evergreen.Tests;

public sealed class GardenStorageTests
{
    private static readonly PlantCatalogEntry[] Catalog = [new() { Id = "sample-1" }];
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task MissingDataIsDifferentFromAnEmptySavedGarden()
    {
        var js = new StorageRuntime();
        var service = CreateService(js);
        Assert.Equal(new GardenLoadResult(null, null), await service.LoadAsync(Catalog));
        Assert.True(await service.SaveAsync(new GardenSnapshot(), Catalog));
        var restored = await service.LoadAsync(Catalog);
        Assert.NotNull(restored.Snapshot);
        Assert.Empty(restored.Snapshot.Plants);
        Assert.Empty(restored.Snapshot.Places);
        Assert.Empty(restored.Snapshot.Entries);
    }

    [Fact]
    public async Task RoundTripPreservesIdentityOverridesDatesAttachmentsAndTranslationKeys()
    {
        var js = new StorageRuntime();
        var service = CreateService(js);
        var snapshot = Sample();
        Assert.True(await service.SaveAsync(snapshot, Catalog));
        var restored = await service.LoadAsync(Catalog);
        Assert.Null(restored.Error);
        Assert.Equal(JsonSerializer.Serialize(snapshot, Options), JsonSerializer.Serialize(restored.Snapshot, Options));
        Assert.Equal(restored.Snapshot!.Plants[0].Id, restored.Snapshot.Entries[0].PlantId);
        Assert.Equal("PanopticonAdvice", restored.Snapshot.Places[0].NoteKey);
    }

    [Theory]
    [InlineData("{", "GardenInvalid")]
    [InlineData("null", "GardenInvalid")]
    [InlineData("{}", "GardenInvalid")]
    [InlineData("{\"version\":1,\"plants\":null,\"places\":[],\"entries\":[]}", "GardenInvalid")]
    [InlineData("{\"version\":2,\"plants\":[],\"places\":[],\"entries\":[]}", "GardenUnsupported")]
    public async Task InvalidOrUnsupportedDataIsNotOverwritten(string saved, string error)
    {
        var js = new StorageRuntime { Value = saved };
        var result = await CreateService(js).LoadAsync(Catalog);
        Assert.Null(result.Snapshot);
        Assert.Equal(error, result.Error);
        Assert.Equal(saved, js.Value);
        Assert.Equal(0, js.Writes);
    }

    [Fact]
    public void RejectsBrokenReferencesDuplicatesMissingFieldsAndInvalidEntryMetadata()
    {
        Action<GardenSnapshot>[] corruptions =
        [
            snapshot => snapshot.Plants.Add(snapshot.Plants[0]),
            snapshot => snapshot.Places.Add(snapshot.Places[0] with { Name = "ROOM" }),
            snapshot => snapshot.Plants[0].Location = "missing",
            snapshot => snapshot.Plants[0].CatalogId = "missing",
            snapshot => snapshot.Plants[0].Category = "missing",
            snapshot => snapshot.Plants[0].Species = "",
            snapshot => snapshot.Plants[0].CatalogId = null,
            snapshot => snapshot.Entries[0] = snapshot.Entries[0] with { PlantId = "missing" },
            snapshot => snapshot.Entries[0] = snapshot.Entries[0] with { TitleKey = "missing" },
            snapshot => snapshot.Entries[0] = snapshot.Entries[0] with { Date = default },
            snapshot => snapshot.Entries[0] = snapshot.Entries[0] with { Type = "Photo", AutomaticWatering = true },
            snapshot => snapshot.Entries[0] = snapshot.Entries[0] with { PhotoData = "not an image" }
        ];
        foreach (var corrupt in corruptions)
        {
            var snapshot = Sample();
            corrupt(snapshot);
            Assert.False(snapshot.IsValid(Catalog));
        }
    }

    [Fact]
    public void CustomPlantsRetainCareCatalogAssociationAndTheirUserNames()
    {
        var snapshot = Sample();
        snapshot.Plants[0].CatalogId = null;
        snapshot.Plants[0].CareCatalogId = "sample-1";
        Assert.True(snapshot.IsValid(Catalog));
        snapshot.Plants[0].CareCatalogId = "missing";
        Assert.False(snapshot.IsValid(Catalog));
    }

    [Fact]
    public async Task StorageFailuresPreserveLastSnapshotAndCanBeRetried()
    {
        var js = new StorageRuntime();
        var service = CreateService(js);
        Assert.True(await service.SaveAsync(Sample(), Catalog));
        var saved = js.Value;
        js.Fail = true;
        Assert.False(await service.SaveAsync(new GardenSnapshot(), Catalog));
        Assert.Equal(saved, js.Value);
        Assert.Equal("GardenReadFailed", (await service.LoadAsync(Catalog)).Error);
        Assert.False(await service.ResetAsync());
        Assert.Equal(saved, js.Value);
        js.Fail = false;
        Assert.True(await service.ResetAsync());
        Assert.Null(js.Value);
    }

    [Fact]
    public async Task InvalidCandidateNeverReachesBrowserStorage()
    {
        var js = new StorageRuntime();
        var snapshot = Sample();
        snapshot.Plants.Clear();
        await Assert.ThrowsAsync<InvalidDataException>(() => CreateService(js).SaveAsync(snapshot, Catalog));
        Assert.Equal(0, js.Writes);
    }

    private static GardenStorageService CreateService(StorageRuntime js) => new(js, NullLogger<GardenStorageService>.Instance);

    private static GardenSnapshot Sample() => new()
    {
        Plants = [new()
        {
            Id = "stable-id", CatalogId = "sample-1", Name = "My fern", Species = "Fern",
            Location = "Room", Category = "Tropical, let top dry", WateredOn = new DateOnly(2026, 11, 6)
        }],
        Places = [new("Room", "Full sun", "Winter", false, "", "WinterTemperature", "PanopticonAdvice")],
        Entries = [new("JournalPhotoTitle", "JournalPhotoTitle", "Photo", new DateOnly(2026, 11, 5),
            123, "stable-id", "data:image/jpeg;base64,/9j/2Q==", "My note")]
    };

    private sealed class StorageRuntime : IJSRuntime
    {
        public string? Value { get; set; }
        public bool Fail { get; set; }
        public int Writes { get; private set; }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) =>
            InvokeAsync<TValue>(identifier, CancellationToken.None, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (Fail) throw new JSException("Browser storage unavailable.");
            object? result = null;
            switch (identifier)
            {
                case "evergreenGarden.read": result = Value; break;
                case "evergreenGarden.write": Value = (string)args![0]!; Writes++; break;
                case "evergreenGarden.reset": Value = null; break;
                default: throw new InvalidOperationException(identifier);
            }
            return ValueTask.FromResult(result is null ? default! : (TValue)result);
        }
    }
}
