using System.Globalization;
using System.Text.RegularExpressions;

namespace Evergreen.Localization;

public static class CultureSelection
{
    public static string? Normalize(string? language)
    {
        if (string.IsNullOrWhiteSpace(language))
        {
            return null;
        }

        var name = language.Trim().Replace('_', '-');
        if (!Regex.IsMatch(name, @"^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return null;
        }
        try
        {
            var culture = CultureInfo.GetCultureInfo(name);
            return culture.TwoLetterISOLanguageName is "en" or "es" or "de"
                ? culture.TwoLetterISOLanguageName
                : null;
        }
        catch (CultureNotFoundException)
        {
            return null;
        }
    }

    public static string Resolve(string? savedLanguage, IEnumerable<string> browserLanguages) =>
        Normalize(savedLanguage)
        ?? browserLanguages.Select(Normalize).FirstOrDefault(language => language is not null)
        ?? "en";
}
