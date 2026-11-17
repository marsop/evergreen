using System.Text.Json;
using Evergreen.Components.Plants;
using Microsoft.JSInterop;

namespace Evergreen.Components.Garden;

public sealed class GardenStorageService(IJSRuntime js, ILogger<GardenStorageService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions IndentedJsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public async Task<GardenLoadResult> LoadAsync(IReadOnlyList<PlantCatalogEntry> catalog)
    {
        try
        {
            var json = await js.InvokeAsync<string?>("evergreenGarden.read");
            if (json is null)
                return new(null, null);
            var snapshot = JsonSerializer.Deserialize<GardenSnapshot>(json, JsonOptions);
            if (snapshot is null)
                return new(null, "GardenInvalid");
            if (snapshot.Version != 1)
            {
                logger.LogWarning("Saved garden schema version {Version} is unsupported.", snapshot.Version);
                return new(null, "GardenUnsupported");
            }
            if (!snapshot.IsValid(catalog))
            {
                logger.LogWarning("Saved garden data failed validation.");
                return new(null, "GardenInvalid");
            }
            return new(snapshot, null);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Saved garden data could not be decoded.");
            return new(null, "GardenInvalid");
        }
        catch (JSException exception)
        {
            logger.LogWarning(exception, "Saved garden data could not be read.");
            return new(null, "GardenReadFailed");
        }
    }

    public async Task<bool> SaveAsync(GardenSnapshot candidate, IReadOnlyList<PlantCatalogEntry> catalog)
    {
        if (!candidate.IsValid(catalog))
            throw new InvalidDataException("The candidate garden snapshot is invalid.");
        try
        {
            await js.InvokeVoidAsync("evergreenGarden.write", JsonSerializer.Serialize(candidate, JsonOptions));
            return true;
        }
        catch (JSException exception)
        {
            logger.LogWarning(exception, "Garden changes were not saved.");
            return false;
        }
    }

    public async Task<bool> ResetAsync()
    {
        try
        {
            await js.InvokeVoidAsync("evergreenGarden.reset");
            return true;
        }
        catch (JSException exception)
        {
            logger.LogWarning(exception, "Saved garden data could not be reset.");
            return false;
        }
    }

    public async Task<bool> ExportAsync(GardenSnapshot snapshot)
    {
        try
        {
            var json = JsonSerializer.Serialize(snapshot, IndentedJsonOptions);
            var filename = $"evergreen-garden-{DateTime.Now:yyyy-MM-dd}.json";
            await js.InvokeVoidAsync("evergreenGarden.exportFile", filename, json, "application/json");
            return true;
        }
        catch (JSException exception)
        {
            logger.LogWarning(exception, "Garden file could not be exported.");
            return false;
        }
    }

    public GardenImportResult ValidateImport(string json, IReadOnlyList<PlantCatalogEntry> catalog)
    {
        try
        {
            var snapshot = JsonSerializer.Deserialize<GardenSnapshot>(json, JsonOptions);
            if (snapshot is null)
                return new(null, "ImportInvalidFile");
            if (snapshot.Version != 1)
            {
                logger.LogWarning("Imported garden schema version {Version} is unsupported.", snapshot.Version);
                return new(null, "GardenUnsupported");
            }
            if (!snapshot.IsValid(catalog))
            {
                logger.LogWarning("Imported garden data failed validation.");
                return new(null, "ImportInvalidFile");
            }
            return new(snapshot, null);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Imported garden data could not be parsed as JSON.");
            return new(null, "ImportInvalidFile");
        }
    }
}

public sealed record GardenLoadResult(GardenSnapshot? Snapshot, string? Error);
public sealed record GardenImportResult(GardenSnapshot? Snapshot, string? Error);
