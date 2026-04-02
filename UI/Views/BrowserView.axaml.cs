using System;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using StellarisModManager.Core.Utils;
using StellarisModManager.UI.ViewModels;
using WebViewCore;
using WebViewCore.Events;

namespace StellarisModManager.UI.Views;

public partial class BrowserView : UserControl
{
    private BrowserViewModel? _vm;
    private IWebViewControl? _webViewControl;
    private bool _webViewReady;
    private bool _eventsWired;
    private int _navigationAttempt;

    public BrowserView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        Loaded += OnLoaded;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        _vm = DataContext as BrowserViewModel;
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        _vm = DataContext as BrowserViewModel;
        TryInitWebView();
    }

    private void TryInitWebView()
    {
        try
        {
            _webViewControl = WebView as IWebViewControl;
            if (_webViewControl is null)
                throw new InvalidOperationException("WebView bridge is unavailable.");

            if (!_eventsWired)
            {
                WebView.NavigationCompleted += OnNavigationCompleted;
                WebView.WebMessageReceived += OnWebMessageReceived;
                _eventsWired = true;
            }

            _webViewReady = true;
            ShowEmbeddedBrowser();
            NavigateTo(_vm?.CurrentUrl ?? BrowserViewModel.HomeUrl);
        }
        catch (Exception ex)
        {
            _webViewReady = false;
            ShowFallback($"Embedded browser initialization failed: {ex.Message}");
        }
    }

    private async void OnNavigationCompleted(object? sender, WebViewUrlLoadedEventArg e)
    {
        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            if (_vm is not null && _webViewControl is not null)
            {
                _vm.IsLoading = false;
                _vm.CanGoBack = _webViewControl.IsCanGoBack;
                _vm.CanGoForward = _webViewControl.IsCanGoForward;
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
            await WebView.ExecuteScriptAsync(script);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BrowserView] Overlay injection failed: {ex.Message}");
        }
    }

    private void OnWebMessageReceived(object? sender, WebViewMessageReceivedEventArgs e)
    {
        try
        {
            var json = e.Message ?? e.MessageAsJson;
            if (string.IsNullOrWhiteSpace(json))
                return;

            var modId = ExtractJsonString(json, "modId");
            if (string.IsNullOrWhiteSpace(modId))
                return;

            Dispatcher.UIThread.Post(() => _vm?.OnInstallRequested(modId));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BrowserView] Web message parse failed: {ex.Message}");
        }
    }

    private void NavigateTo(string rawUrl)
    {
        if (!_webViewReady || _webViewControl is null)
        {
            ShowFallback("Embedded browser is unavailable on this system.");
            return;
        }

        var url = NormalizeUrl(rawUrl);

        if (_vm is not null)
        {
            _vm.CurrentUrl = url;
            _vm.IsLoading = true;
        }

        var attempt = ++_navigationAttempt;
        _ = StartNavigationWatchdogAsync(attempt, url);

        if (AddressInput.Text != url)
            AddressInput.Text = url;

        try
        {
            _webViewControl.Navigate(new Uri(url));
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
        await Task.Delay(TimeSpan.FromSeconds(8));

        if (_vm is null)
            return;

        if (attempt != _navigationAttempt)
            return;

        if (!_vm.IsLoading)
            return;

        _vm.IsLoading = false;
        ShowFallback($"Embedded browser timed out while loading {url}. This is usually caused by WebView runtime/driver incompatibility.");
    }

    private static string NormalizeUrl(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
            return BrowserViewModel.HomeUrl;

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
        if (_webViewReady)
            _webViewControl?.GoBack();
    }

    private void ForwardButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_webViewReady)
            _webViewControl?.GoForward();
    }

    private void RefreshButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_webViewReady)
        {
            if (_vm is not null)
                _vm.IsLoading = true;
            _webViewControl?.Reload();
        }
    }

    private void HomeButton_Click(object? sender, RoutedEventArgs e)
    {
        NavigateTo(BrowserViewModel.HomeUrl);
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
        if (!_webViewReady)
            TryInitWebView();
        else
            NavigateTo(_vm?.CurrentUrl ?? BrowserViewModel.HomeUrl);
    }

    private void InstallRuntimeButton_Click(object? sender, RoutedEventArgs e)
    {
        OpenUrl("https://developer.microsoft.com/en-us/microsoft-edge/webview2/");
    }

    private void OpenSteamButton_Click(object? sender, RoutedEventArgs e)
    {
        OpenUrl(_vm?.CurrentUrl ?? BrowserViewModel.HomeUrl);
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

        var match = Regex.Match(trimmed, @"[?&]id=(\d+)");
        if (match.Success)
            return match.Groups[1].Value;

        return null;
    }

    private static string? ExtractJsonString(string json, string key)
    {
        var pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"";
        var match = Regex.Match(json, pattern);
        return match.Success ? match.Groups[1].Value : null;
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
            System.Diagnostics.Debug.WriteLine($"[BrowserView] OpenUrl failed: {ex.Message}");
        }
    }
}
