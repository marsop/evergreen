namespace Evergreen.Components.Shared;

public static class PlantImages
{
    public const string DefaultPlant = "images/default-plant.svg";

    public static string DisplaySource(string? image) =>
        string.IsNullOrWhiteSpace(image) ? DefaultPlant : image;
}
