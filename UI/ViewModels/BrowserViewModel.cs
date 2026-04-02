using System;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace StellarisModManager.UI.ViewModels;

public partial class BrowserViewModel : ViewModelBase
{
    // Current URL in the browser
    [ObservableProperty]
    private string _currentUrl = "https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems";

    // Navigation state
    public bool CanGoBack { get; set; }
    public bool CanGoForward { get; set; }

    // Status
    [ObservableProperty] private bool _isLoading = false;
    [ObservableProperty] private string _pageTitle = "";

    // Event raised when a mod install is requested from browser overlay
    public event EventHandler<string>? InstallModRequested;  // string = workshopId

    // Called by the View when WebView posts a message
    public void OnInstallRequested(string workshopId)
    {
        InstallModRequested?.Invoke(this, workshopId);
    }

    [RelayCommand]
    private void GoBack()
    {
        // Will be wired to WebView in browser view code-behind
    }

    [RelayCommand]
    private void GoForward()
    {
        // Will be wired to WebView in browser view code-behind
    }

    [RelayCommand]
    private void Refresh()
    {
        // Will be wired to WebView in browser view code-behind
    }

    [RelayCommand]
    private void NavigateHome()
    {
        CurrentUrl = "https://steamcommunity.com/workshop/browse/?appid=281990&browsesort=trend&section=readytouseitems";
    }
}
