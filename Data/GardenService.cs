using Evergreen.Localization;
using Microsoft.JSInterop;
using Microsoft.AspNetCore.Components;

namespace Evergreen.Data;

public sealed class GardenService(IJSRuntime js, LocalizationService cultures, ILogger<GardenService> logger) : IAsyncDisposable
{
    private IJSObjectReference? module;
    private DotNetObjectReference<GardenService>? reference;
    public GardenSnapshot State { get; private set; } = new();
    public event Action? Changed;
    public bool Initialized { get; private set; }

    public async Task InitializeAsync(GardenSeed seed)
    {
        if (module is not null) return;
        module = await js.InvokeAsync<IJSObjectReference>("import", "./firebase.js");
        reference = DotNetObjectReference.Create(this);
        await module.InvokeVoidAsync("initialize", reference, seed, cultures.Culture.Name);
        Initialized = true;
        cultures.SaveAccountCultureAsync = SaveLanguageAsync;
    }

    [JSInvokable]
    public async Task ReceiveAsync(GardenSnapshot snapshot)
    {
        snapshot.ResolveRelationships(DateOnly.FromDateTime(DateTime.Now));
        var accountChanged = snapshot.Uid != State.Uid;
        State = snapshot;
        try
        {
            if (snapshot.Language.Length > 0 && cultures.Culture.Name != snapshot.Language)
                await cultures.ApplyAccountCultureAsync(snapshot.Language);
            else if (accountChanged && snapshot.Uid.Length == 0)
                await cultures.ApplyAccountCultureAsync(cultures.StartupCulture);
        }
        catch (JSException exception)
        {
            logger.LogError(exception, "Unable to apply the account language.");
            State.Error = "LanguageChangeFailed";
        }
        Changed?.Invoke();
    }

    public Task SignInAsync() => InvokeAsync("signIn", cultures.Culture.Name);
    public Task SignOutAsync() => InvokeAsync("signOut");
    public async Task RetryAsync()
    {
        if (!Initialized) await js.InvokeVoidAsync("location.reload");
        else await InvokeAsync("retry");
    }
    public Task RefreshAsync() => InvokeAsync("refresh");
    public Task SaveAsync(params GardenWrite[] writes) => InvokeAsync("enqueue", State.Uid, writes);

    private Task SaveLanguageAsync(string language) =>
        State.Uid.Length == 0 ? Task.CompletedTask :
        SaveAsync(new GardenWrite("preferences", "language", new { language }));

    public async Task<CompressedPhoto> CompressPhotoAsync(ElementReference input) =>
        await Module.InvokeAsync<CompressedPhoto>("compressSelectedPhoto", input);

    public async Task<string> LoadPhotoAsync(string id) =>
        await Module.InvokeAsync<string>("loadPhoto", State.Uid, id);

    private IJSObjectReference Module => module ?? throw new InvalidOperationException("Firebase is not initialized.");
    private async Task InvokeAsync(string method, params object?[] arguments) =>
        await Module.InvokeVoidAsync(method, arguments);

    public async ValueTask DisposeAsync()
    {
        cultures.SaveAccountCultureAsync = null;
        if (module is not null)
        {
            await module.InvokeVoidAsync("dispose");
            await module.DisposeAsync();
        }
        reference?.Dispose();
    }
}
