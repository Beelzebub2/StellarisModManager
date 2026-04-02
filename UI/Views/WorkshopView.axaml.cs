using System;
using System.ComponentModel;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using StellarisModManager.Core.Utils;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class WorkshopView : UserControl
{
    private sealed class OverlayRequest
    {
        public string? Action { get; set; }
        public string? ModId { get; set; }
    }

    private WorkshopViewModel? _vm;
    private bool _isNativeEngineReady;
    private bool _eventsWired;
    private int _navigationAttempt;
    private bool _steamAutoRetryUsed;
    private string _lastNavigatedUrl = string.Empty;

    public WorkshopView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        Loaded += OnLoaded;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_vm is not null)
            _vm.PropertyChanged -= OnViewModelPropertyChanged;

        _vm = DataContext as WorkshopViewModel;

        if (_vm is not null)
            _vm.PropertyChanged += OnViewModelPropertyChanged;
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        _vm = DataContext as WorkshopViewModel;
        TryInitWebView();
    }

    private void TryInitWebView()
    {
        try
        {
            if (!_eventsWired)
            {
                WebView.AdapterCreated += OnAdapterCreated;
                WebView.AdapterDestroyed += OnAdapterDestroyed;
                WebView.NavigationStarted += OnNavigationStarted;
                WebView.NavigationCompleted += OnNavigationCompleted;
                WebView.WebMessageReceived += OnWebMessageReceived;
                _eventsWired = true;
            }

            ShowEmbeddedBrowser();

            // If adapter is already alive (e.g., after re-attach), navigate immediately.
            if (_isNativeEngineReady)
                _ = Dispatcher.UIThread.InvokeAsync(() => NavigateTo(_vm?.CurrentUrl ?? WorkshopViewModel.HomeUrl));
        }
        catch (Exception ex)
        {
            _isNativeEngineReady = false;
            ShowFallback($"Embedded browser initialization failed: {ex.Message}");
        }
    }

    private void OnAdapterCreated(object? sender, WebViewAdapterEventArgs e)
    {
        _isNativeEngineReady = true;
        Dispatcher.UIThread.Post(() => NavigateTo(_vm?.CurrentUrl ?? WorkshopViewModel.HomeUrl));
    }

    private void OnAdapterDestroyed(object? sender, WebViewAdapterEventArgs e)
    {
        _isNativeEngineReady = false;
    }

    private void OnNavigationStarted(object? sender, WebViewNavigationStartingEventArgs e)
    {
        if (_vm is not null)
            _vm.IsLoading = true;
    }

    private async void OnNavigationCompleted(object? sender, WebViewNavigationCompletedEventArgs e)
    {
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            if (_vm is not null)
            {
                _vm.IsLoading = false;
                _vm.CanGoBack = WebView.CanGoBack;
                _vm.CanGoForward = WebView.CanGoForward;
            }
        });

        if (!e.IsSuccess)
        {
            ShowFallback("Steam Workshop could not load in the embedded browser. You can retry, install WebView2 runtime, or open in your default browser.");
            return;
        }

        ShowEmbeddedBrowser();

        try
        {
            var script = OverlayInjector.BuildInjectionScript();
            await WebView.InvokeScript(script);
            await ApplyOverlayStateAsync();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WorkshopView] Overlay injection failed: {ex.Message}");
        }
    }

    private void OnWebMessageReceived(object? sender, WebMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.Body;
            if (string.IsNullOrWhiteSpace(json))
                return;

            var payload = ParseOverlayRequest(json);
            var modId = payload?.ModId;
            if (string.IsNullOrWhiteSpace(modId))
                return;

            var action = payload?.Action?.Trim().ToLowerInvariant() ?? "install";

            Dispatcher.UIThread.Post(() =>
            {
                if (action == "uninstall")
                    _vm?.OnUninstallRequested(modId);
                else
                    _vm?.OnInstallRequested(modId);
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WorkshopView] Web message parse failed: {ex.Message}");
        }
    }

    private static OverlayRequest? ParseOverlayRequest(string message)
    {
        // Some adapters deliver a JSON object, others deliver a JSON-encoded string.
        try
        {
            var direct = JsonSerializer.Deserialize<OverlayRequest>(message);
            if (!string.IsNullOrWhiteSpace(direct?.ModId))
                return direct;
        }
        catch
        {
            // Try alternate shape below.
        }

        try
        {
            var wrapped = JsonSerializer.Deserialize<string>(message);
            if (!string.IsNullOrWhiteSpace(wrapped))
            {
                var parsed = JsonSerializer.Deserialize<OverlayRequest>(wrapped);
                if (!string.IsNullOrWhiteSpace(parsed?.ModId))
                    return parsed;
            }
        }
        catch
        {
            // Try regex fallback below.
        }

        var modId = ExtractJsonString(message, "modId");
        if (string.IsNullOrWhiteSpace(modId))
            return null;

        return new OverlayRequest
        {
            ModId = modId,
            Action = ExtractJsonString(message, "action")
        };
    }

    private void NavigateTo(string rawUrl)
    {
        var url = NormalizeUrl(rawUrl);
        if (!string.Equals(url, _lastNavigatedUrl, StringComparison.OrdinalIgnoreCase))
        {
            _steamAutoRetryUsed = false;
            _lastNavigatedUrl = url;
        }

        if (_vm is not null)
        {
            _vm.CurrentUrl = url;
            _vm.IsLoading = true;
        }

        if (!_isNativeEngineReady)
            return;

        var attempt = ++_navigationAttempt;
        _ = StartNavigationWatchdogAsync(attempt, url);

        if (AddressInput.Text != url)
            AddressInput.Text = url;

        try
        {
            WebView.Navigate(new Uri(url));
            ShowEmbeddedBrowser();
        }
        catch (Exception ex)
        {
            if (_vm is not null)
                _vm.IsLoading = false;

            ShowFallback($"Navigation failed: {ex.Message}");
        }
    }

    private async Task StartNavigationWatchdogAsync(int attempt, string url)
    {
        await Task.Delay(TimeSpan.FromSeconds(12));

        if (_vm is null)
            return;

        if (attempt != _navigationAttempt)
            return;

        if (!_vm.IsLoading)
            return;

        if (!_steamAutoRetryUsed && IsSteamWorkshopUrl(url))
        {
            _steamAutoRetryUsed = true;
            await Dispatcher.UIThread.InvokeAsync(() => NavigateTo(url));
            return;
        }

        _vm.IsLoading = false;
        ShowFallback($"Embedded browser timed out while loading {url}. This is usually caused by WebView runtime/driver incompatibility.");
    }

    private static bool IsSteamWorkshopUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return false;

        return uri.Host.Contains("steamcommunity.com", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeUrl(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return WorkshopViewModel.HomeUrl;

        if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return trimmed;

        return "https://" + trimmed;
    }

    private void ShowFallback(string message)
    {
        BrowserErrorText.Text = message;
        WebView.IsVisible = false;
        FallbackPanel.IsVisible = true;
    }

    private void ShowEmbeddedBrowser()
    {
        WebView.IsVisible = true;
        FallbackPanel.IsVisible = false;
    }

    private void BackButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_isNativeEngineReady)
            WebView.GoBack();
    }

    private void ForwardButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_isNativeEngineReady)
            WebView.GoForward();
    }

    private void RefreshButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_isNativeEngineReady)
        {
            if (_vm is not null)
                _vm.IsLoading = true;
            WebView.Refresh();
        }
    }

    private void HomeButton_Click(object? sender, RoutedEventArgs e)
    {
        NavigateTo(WorkshopViewModel.HomeUrl);
    }

    private void AddressInput_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            NavigateTo(AddressInput.Text ?? string.Empty);
    }

    private void GoButton_Click(object? sender, RoutedEventArgs e)
    {
        NavigateTo(AddressInput.Text ?? string.Empty);
    }

    private void RetryInAppButton_Click(object? sender, RoutedEventArgs e)
    {
        if (!_isNativeEngineReady)
            TryInitWebView();
        else
            NavigateTo(_vm?.CurrentUrl ?? WorkshopViewModel.HomeUrl);
    }

    private void InstallRuntimeButton_Click(object? sender, RoutedEventArgs e)
    {
        OpenUrl("https://developer.microsoft.com/en-us/microsoft-edge/webview2/");
    }

    private void OpenSteamButton_Click(object? sender, RoutedEventArgs e)
    {
        OpenUrl(_vm?.CurrentUrl ?? WorkshopViewModel.HomeUrl);
    }

    private void ModIdInput_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            TriggerManualInstall();
    }

    private void InstallModButton_Click(object? sender, RoutedEventArgs e)
    {
        TriggerManualInstall();
    }

    private void TriggerManualInstall()
    {
        var input = ModIdInput.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(input))
            return;

        var modId = ParseWorkshopId(input);
        if (modId is null)
        {
            ShowInstallStatus("Could not parse Workshop ID from the input.", isError: true);
            return;
        }

        ShowInstallStatus($"Install request queued for mod {modId}.", isError: false);
        _vm?.OnInstallRequested(modId);
        ModIdInput.Text = string.Empty;
    }

    private void ShowInstallStatus(string message, bool isError)
    {
        InstallStatusText.Text = message;
        InstallStatusText.Foreground = isError
            ? new SolidColorBrush(Color.Parse("#FF8F8F"))
            : new SolidColorBrush(Color.Parse("#6FE5AE"));
        InstallStatusText.IsVisible = true;
    }

    private static string? ParseWorkshopId(string input)
    {
        var trimmed = input.Trim();

        if (Regex.IsMatch(trimmed, @"^\d+$"))
            return trimmed;

        var match = Regex.Match(trimmed, @"[?&]id=(\d+)", RegexOptions.IgnoreCase);
        if (match.Success)
            return match.Groups[1].Value;

        match = Regex.Match(trimmed, @"publishedfileid=(\d+)", RegexOptions.IgnoreCase);
        if (match.Success)
            return match.Groups[1].Value;

        match = Regex.Match(trimmed, @"\b(\d{8,})\b");
        if (match.Success)
            return match.Groups[1].Value;

        return null;
    }

    private static string? ExtractJsonString(string json, string key)
    {
        var pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"";
        var match = Regex.Match(json, pattern, RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : null;
    }

    private async Task ApplyOverlayStateAsync()
    {
        if (!_isNativeEngineReady || _vm is null)
            return;

        var idsJson = string.IsNullOrWhiteSpace(_vm.InstalledWorkshopIdsJson)
            ? "[]"
            : _vm.InstalledWorkshopIdsJson;

        var statesJson = string.IsNullOrWhiteSpace(_vm.ModStatesJson)
            ? "{}"
            : _vm.ModStatesJson;

        await WebView.InvokeScript($"window.__smmSetInstalledMods?.({idsJson});");
        await WebView.InvokeScript($"window.__smmSetModStates?.({statesJson});");
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(WorkshopViewModel.InstalledWorkshopIdsJson) &&
            e.PropertyName != nameof(WorkshopViewModel.ModStatesJson))
            return;

        _ = Dispatcher.UIThread.InvokeAsync(ApplyOverlayStateAsync);
    }

    private static void OpenUrl(string url)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WorkshopView] OpenUrl failed: {ex.Message}");
        }
    }
}
