using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace StellarisModManager.UI.ViewModels;

public partial class WorkshopViewModel : ViewModelBase
{
    public const string HomeUrl = "https://steamcommunity.com/workshop/browse/?appid=281990";

    // Current URL in the workshop view
    [ObservableProperty]
    private string _currentUrl = HomeUrl;

    // Navigation state
    public bool CanGoBack { get; set; }
    public bool CanGoForward { get; set; }

    // Status
    [ObservableProperty] private bool _isLoading = false;
    [ObservableProperty] private string _pageTitle = "";
    [ObservableProperty] private string _installedWorkshopIdsJson = "[]";
    [ObservableProperty] private string _modStatesJson = "{}";

    // Event raised when a mod install is requested from workshop overlay
    public event EventHandler<string>? InstallModRequested;  // string = workshopId
    public event EventHandler<string>? UninstallModRequested;
    public event EventHandler<string>? NavigateToUrlRequested;

    public void SetInstalledWorkshopIds(IEnumerable<string> workshopIds)
    {
        var ids = workshopIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        InstalledWorkshopIdsJson = JsonSerializer.Serialize(ids);
    }

    public void SetModStates(IReadOnlyDictionary<string, string> modStates)
    {
        ModStatesJson = JsonSerializer.Serialize(modStates);
    }

    // Called by the View when WebView posts a message
    public void OnInstallRequested(string workshopId)
    {
        InstallModRequested?.Invoke(this, workshopId);
    }

    public void OnUninstallRequested(string workshopId)
    {
        UninstallModRequested?.Invoke(this, workshopId);
    }

    public void RequestNavigateToUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return;

        CurrentUrl = url;
        NavigateToUrlRequested?.Invoke(this, url);
    }

    [RelayCommand]
    private void GoBack()
    {
        // Will be wired to WebView in workshop view code-behind
    }

    [RelayCommand]
    private void GoForward()
    {
        // Will be wired to WebView in workshop view code-behind
    }

    [RelayCommand]
    private void Refresh()
    {
        // Will be wired to WebView in workshop view code-behind
    }

    [RelayCommand]
    private void NavigateHome()
    {
        CurrentUrl = HomeUrl;
    }
}
