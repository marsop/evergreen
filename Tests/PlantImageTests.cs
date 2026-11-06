using Evergreen.Components.Shared;

namespace Evergreen.Tests;

public sealed class PlantImageTests
{
    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void MissingPlantImageUsesDefaultForDisplay(string image) =>
        Assert.Equal(PlantImages.DefaultPlant, PlantImages.DisplaySource(image));

    [Fact]
    public void ExistingPlantImageIsPreservedForDisplay()
    {
        const string image = "images/fern.webp";
        Assert.Equal(image, PlantImages.DisplaySource(image));
    }
}
