using System.Globalization;
using System.Net;
using Evergreen.Components.Plants;

namespace Evergreen.Tests;

public sealed class PlantCatalogTests
{
    [Fact]
    public async Task LoadsAllSupportedPlantsWithColocatedImagesAndTranslations()
    {
        using var httpClient = new HttpClient(new PlantCatalogFileHandler())
        {
            BaseAddress = new Uri("https://evergreen.test/")
        };
        var plants = await new PlantCatalogService(httpClient).LoadAsync();

        Assert.Equal(23, plants.Count);
        Assert.Equal(Enumerable.Range(1, 23).Select(index => $"sample-{index}"), plants.Select(plant => plant.Id));
        Assert.All(plants, plant =>
        {
            Assert.False(plant.Validated);
            Assert.All(new[] { "en", "es", "de" }, language =>
            {
                Assert.False(string.IsNullOrWhiteSpace(plant.Name[language]));
                Assert.True(File.Exists(Path.Combine(AppContext.BaseDirectory, plant.Image.Replace('/', Path.DirectorySeparatorChar))));
            });
        });
    }

    [Fact]
    public async Task ResolvesBuiltInNamesForAllSupportedLanguages()
    {
        using var httpClient = new HttpClient(new PlantCatalogFileHandler())
        {
            BaseAddress = new Uri("https://evergreen.test/")
        };
        var plants = await new PlantCatalogService(httpClient).LoadAsync();

        Assert.Equal("Rubber plant", PlantCatalogService.LocalizedValue(plants[5].Name, CultureInfo.GetCultureInfo("en")));
        Assert.Equal("Árbol del caucho", PlantCatalogService.LocalizedValue(plants[5].Name, CultureInfo.GetCultureInfo("es")));
        Assert.Equal("Gummibaum", PlantCatalogService.LocalizedValue(plants[5].Name, CultureInfo.GetCultureInfo("de")));
    }

    [Fact]
    public async Task AllBuiltInPlantsStartWithTheSameCareParameters()
    {
        using var httpClient = new HttpClient(new PlantCatalogFileHandler())
        {
            BaseAddress = new Uri("https://evergreen.test/")
        };
        var plants = await new PlantCatalogService(httpClient).LoadAsync();
        var sharedCare = System.Text.Json.JsonSerializer.Serialize(plants[0].Care);

        Assert.All(plants, plant => Assert.Equal(sharedCare, System.Text.Json.JsonSerializer.Serialize(plant.Care)));
        Assert.Equal(12, plants[0].Care.Months.Count);
        Assert.Equal("Normal", plants[0].Care.Details["Water"].Amount!["en"]);
    }

    private sealed class PlantCatalogFileHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var relativePath = request.RequestUri!.AbsolutePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var filePath = Path.Combine(AppContext.BaseDirectory, relativePath);
            if (!File.Exists(filePath))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(File.ReadAllText(filePath))
            };
            return Task.FromResult(response);
        }
    }
}
