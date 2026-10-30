using System.Globalization;
using Evergreen.Localization;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Localization;

namespace Evergreen.Components;

public abstract class LocalizedComponentBase : ComponentBase
{
    [Inject] protected LocalizationService Cultures { get; set; } = default!;
    [Inject] protected IStringLocalizer<AppResources> Localizer { get; set; } = default!;
    [CascadingParameter] public CultureInfo SelectedCulture { get; set; } = CultureInfo.GetCultureInfo("en");

    protected string T(string key, params object[] arguments) => Cultures.Translate(Localizer, key, arguments);
}
