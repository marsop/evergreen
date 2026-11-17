namespace Evergreen.Tests;

public sealed class SocialShareMetadataTests
{
    private static string FindWwwRootPath()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "wwwroot");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html")))
            {
                return candidate;
            }
            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate wwwroot folder containing index.html");
    }

    [Fact]
    public void IndexHtmlContainsSocialSharingMetadataForWhatsApp()
    {
        var wwwroot = FindWwwRootPath();
        var indexHtml = File.ReadAllText(Path.Combine(wwwroot, "index.html"));

        Assert.Matches(@"<meta\s+property=""og:title""\s+content=""[^""]+""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:description""\s+content=""[^""]+""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:image""\s+content=""images/og-preview\.jpg""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:image:type""\s+content=""image/jpeg""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:image:width""\s+content=""1200""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:image:height""\s+content=""630""", indexHtml);
        Assert.Matches(@"<meta\s+property=""og:type""\s+content=""website""", indexHtml);

        Assert.Matches(@"<meta\s+name=""twitter:card""\s+content=""summary_large_image""", indexHtml);
        Assert.Matches(@"<meta\s+name=""twitter:image""\s+content=""images/og-preview\.jpg""", indexHtml);
    }

    [Fact]
    public void SocialShareImageMeetsWhatsAppAndOpenGraphSpecs()
    {
        var wwwroot = FindWwwRootPath();
        var imagePath = Path.Combine(wwwroot, "images", "og-preview.jpg");

        Assert.True(File.Exists(imagePath), $"Expected social share image at '{imagePath}'");

        var fileInfo = new FileInfo(imagePath);
        // WhatsApp link previews require og:image to be less than 300 KB.
        Assert.True(fileInfo.Length < 300 * 1024, $"Image must be under 300 KB for WhatsApp, but was {fileInfo.Length} bytes.");
        Assert.True(fileInfo.Length > 10 * 1024, "Image file should be non-empty and reasonably sized.");

        var bytes = File.ReadAllBytes(imagePath);
        // JPEG SOI marker
        Assert.Equal(0xFF, bytes[0]);
        Assert.Equal(0xD8, bytes[1]);

        // Parse JPEG frame header to verify 1200x630 dimensions
        var (width, height) = GetJpegDimensions(bytes);
        Assert.Equal(1200, width);
        Assert.Equal(630, height);
    }

    private static (int Width, int Height) GetJpegDimensions(byte[] bytes)
    {
        var i = 2;
        while (i < bytes.Length - 4)
        {
            if (bytes[i] != 0xFF)
            {
                i++;
                continue;
            }

            var marker = bytes[i + 1];
            i += 2;
            if (marker is 0xD9 or 0xDA)
            {
                break;
            }

            var length = (bytes[i] * 256) + bytes[i + 1];
            if (marker is >= 0xC0 and <= 0xC3)
            {
                var height = (bytes[i + 3] * 256) + bytes[i + 4];
                var width = (bytes[i + 5] * 256) + bytes[i + 6];
                return (width, height);
            }

            i += length;
        }

        throw new InvalidOperationException("Could not extract JPEG dimensions from file.");
    }
}
