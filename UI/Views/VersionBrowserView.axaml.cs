using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using System;
using System.ComponentModel;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using StellarisModManager.Core.Utils;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class VersionBrowserView : UserControl
{
    private sealed class OverlayRequest
    {
        public string? Action { get; set; }
        public string? ModId { get; set; }
    }

    private Vector _savedScrollOffset = default;
    private VersionBrowserViewModel? _vm;
    private NativeWebView? _modDetailsWebView;
    private bool _modBrowserInitFailed;
    private bool _hasTriggeredInitialLoad;
    private bool _isInitialLoadRunning;

    public VersionBrowserView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        PropertyChanged += OnControlPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_vm is not null)
            _vm.PropertyChanged -= OnViewModelPropertyChanged;

        _vm = DataContext as VersionBrowserViewModel;
        if (_vm is not null)
            _vm.PropertyChanged += OnViewModelPropertyChanged;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (!string.Equals(e.PropertyName, nameof(VersionBrowserViewModel.OverlayStateVersion), StringComparison.Ordinal))
            return;

        if (_modDetailsWebView is null)
            return;

        _ = ApplyOverlayStateAsync(_modDetailsWebView);
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (_vm is not null)
        {
            _vm.PropertyChanged -= OnViewModelPropertyChanged;
            _vm = null;
        }

        if (_modDetailsWebView is not null)
        {
            _modDetailsWebView.EnvironmentRequested -= OnModBrowserEnvironmentRequested;
            _modDetailsWebView.NavigationCompleted -= OnModBrowserNavigationCompleted;
            _modDetailsWebView.WebMessageReceived -= OnModBrowserWebMessageReceived;

            if (_modDetailsWebView is IDisposable disposable)
                disposable.Dispose();

            _modDetailsWebView = null;
        }

        ModBrowserHost.Content = null;
    }

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        if (IsVisible)
            _ = EnsureInitialLoadAsync();
    }

    private void OnControlPropertyChanged(object? sender, AvaloniaPropertyChangedEventArgs e)
    {
        if (e.Property != IsVisibleProperty)
            return;

        if (!IsVisible)
            return;

        _ = EnsureInitialLoadAsync();
    }

    private async Task EnsureInitialLoadAsync()
    {
        if (_hasTriggeredInitialLoad || _isInitialLoadRunning)
            return;

        if (DataContext is not VersionBrowserViewModel vm)
            return;

        _isInitialLoadRunning = true;
        try
        {
            await vm.LoadAsync();
            _hasTriggeredInitialLoad = true;
        }
        catch (Exception ex)
        {
            vm.StatusText = $"By Version failed to load: {ex.Message}";
        }
        finally
        {
            _isInitialLoadRunning = false;
        }
    }

    private void OnCardActionClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is not VersionModCard card)
            return;

        if (DataContext is not VersionBrowserViewModel vm)
            return;

        if (vm.ToggleInstallCommand.CanExecute(card))
            vm.ToggleInstallCommand.Execute(card);
    }

    private void OnCardActionPointerEntered(object? sender, PointerEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is VersionModCard card)
            card.IsActionHovered = true;
    }

    private void OnCardActionPointerExited(object? sender, PointerEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is VersionModCard card)
            card.IsActionHovered = false;
    }

    private async void OnModCardAttachedToVisualTree(object? sender, VisualTreeAttachmentEventArgs e)
    {
        if (sender is not Border cardBorder)
            return;

        cardBorder.Opacity = 0;
        cardBorder.RenderTransform = new TranslateTransform(0, 10);

        var delayMs = 0;
        if (cardBorder.DataContext is VersionModCard card && !string.IsNullOrWhiteSpace(card.WorkshopId))
        {
            var hash = Math.Abs(card.WorkshopId.GetHashCode(StringComparison.Ordinal));
            delayMs = (hash % 6) * 18;
        }

        if (delayMs > 0)
            await Task.Delay(delayMs);

        if (!cardBorder.IsAttachedToVisualTree())
            return;

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            cardBorder.Opacity = 1;
            cardBorder.RenderTransform = new TranslateTransform(0, 0);
        }, DispatcherPriority.Background);
    }

    private void OnModCardPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (sender is not Border border)
            return;

        // Ignore presses coming from the action button.
        if (e.Source is Visual visual && visual.GetSelfAndVisualAncestors().OfType<Button>().Any())
            return;

        if (border.DataContext is not VersionModCard card)
            return;

        if (string.IsNullOrWhiteSpace(card.WorkshopId))
            return;

        _savedScrollOffset = ResultsScrollViewer.Offset;

        var url = $"https://steamcommunity.com/sharedfiles/filedetails/?id={card.WorkshopId}";
        ModBrowserTitleText.Text = card.Name;
        ResultsContentPanel.IsVisible = false;
        ModBrowserPanel.IsVisible = true;

        if (!EnsureModBrowserInitialized())
            return;

        try
        {
            _modDetailsWebView!.Navigate(new Uri(url));
            ModBrowserFallbackPanel.IsVisible = false;
        }
        catch (Exception ex)
        {
            ModBrowserFallbackText.Text = $"Could not navigate to mod page: {ex.Message}";
            ModBrowserFallbackPanel.IsVisible = true;
        }
    }

    private void BackToResultsButton_Click(object? sender, RoutedEventArgs e)
    {
        ModBrowserPanel.IsVisible = false;
        ResultsContentPanel.IsVisible = true;

        Dispatcher.UIThread.Post(() =>
        {
            ResultsScrollViewer.Offset = _savedScrollOffset;
        }, DispatcherPriority.Background);
    }

    private void ModBrowserBackButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_modDetailsWebView is null)
            return;

        try
        {
            if (_modDetailsWebView.CanGoBack)
                _modDetailsWebView.GoBack();
        }
        catch
        {
            // Ignore navigation failures; user can always go back to results.
        }
    }

    private bool EnsureModBrowserInitialized()
    {
        if (_modDetailsWebView is not null)
            return true;

        if (_modBrowserInitFailed)
            return false;

        try
        {
            _modDetailsWebView = new NativeWebView();
            _modDetailsWebView.EnvironmentRequested += OnModBrowserEnvironmentRequested;
            _modDetailsWebView.NavigationCompleted += OnModBrowserNavigationCompleted;
            _modDetailsWebView.WebMessageReceived += OnModBrowserWebMessageReceived;
            ModBrowserHost.Content = _modDetailsWebView;
            ModBrowserFallbackPanel.IsVisible = false;
            return true;
        }
        catch (Exception ex)
        {
            _modBrowserInitFailed = true;
            ModBrowserFallbackText.Text = $"Could not initialize embedded browser: {ex.Message}";
            ModBrowserFallbackPanel.IsVisible = true;
            return false;
        }
    }

    private void OnModBrowserEnvironmentRequested(object? sender, WebViewEnvironmentRequestedEventArgs e)
    {
        WebViewRuntimeConfig.ApplyWritableProfile(e);
    }

    private async void OnModBrowserNavigationCompleted(object? sender, WebViewNavigationCompletedEventArgs e)
    {
        try
        {
            if (!e.IsSuccess || _modDetailsWebView is null)
                return;

            await EnsureInAppNavigationBehaviorAsync(_modDetailsWebView);
            await _modDetailsWebView.InvokeScript(OverlayInjector.BuildInjectionScript());
            await ApplyOverlayStateAsync(_modDetailsWebView);
        }
        catch (Exception ex)
        {
            ModBrowserFallbackText.Text = $"Embedded browser encountered an error: {ex.Message}";
            ModBrowserFallbackPanel.IsVisible = true;
        }
    }

    private void OnModBrowserWebMessageReceived(object? sender, WebMessageReceivedEventArgs e)
    {
        if (DataContext is not VersionBrowserViewModel vm)
            return;

        var payload = ParseOverlayRequest(e.Body);
        var modId = payload?.ModId?.Trim();
        if (string.IsNullOrWhiteSpace(modId))
            return;

        var action = payload?.Action?.Trim().ToLowerInvariant() ?? "install";
        if (action == "uninstall")
        {
            vm.RequestUninstallFromOverlay(modId);
            return;
        }

        vm.RequestInstallFromOverlay(modId);
    }

    private static OverlayRequest? ParseOverlayRequest(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return null;

        try
        {
            var direct = JsonSerializer.Deserialize<OverlayRequest>(message);
            if (!string.IsNullOrWhiteSpace(direct?.ModId))
                return direct;
        }
        catch
        {
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
        }

        var modId = ExtractJsonString(message, "modId");
        if (string.IsNullOrWhiteSpace(modId))
            return null;

        return new OverlayRequest
        {
            ModId = modId,
            Action = ExtractJsonString(message, "action"),
        };
    }

    private static string? ExtractJsonString(string json, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(propertyName))
            return null;

        var pattern = $"\"{Regex.Escape(propertyName)}\"\\s*:\\s*\"(?<value>[^\"]+)\"";
        var match = Regex.Match(json, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return match.Success ? match.Groups["value"].Value : null;
    }

    private async Task ApplyOverlayStateAsync(NativeWebView webView)
    {
        if (_vm is null && DataContext is VersionBrowserViewModel fromDataContext)
            _vm = fromDataContext;

        if (_vm is null)
            return;

        var installedIdsJson = JsonSerializer.Serialize(_vm.GetInstalledWorkshopIdsSnapshot());
        var modStatesJson = JsonSerializer.Serialize(_vm.GetModStatesSnapshot());

        await webView.InvokeScript($"window.__smmSetInstalledMods({installedIdsJson});");
        await webView.InvokeScript($"window.__smmSetModStates({modStatesJson});");
    }

    private static async Task EnsureInAppNavigationBehaviorAsync(NativeWebView webView)
    {
        const string script = """
(() => {
    if (window.__smmInAppNavigationInstalled) {
        return;
    }
    window.__smmInAppNavigationInstalled = true;

    const normalizeAnchors = () => {
        const anchors = document.querySelectorAll('a[target]');
        for (const anchor of anchors) {
            const target = (anchor.getAttribute('target') || '').toLowerCase();
            if (target === '_blank') {
                anchor.setAttribute('target', '_self');
            }
        }
    };

    normalizeAnchors();
    if (document.documentElement) {
        const observer = new MutationObserver(() => normalizeAnchors());
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    const originalOpen = window.open;
    window.open = (url, ...args) => {
        if (typeof url === 'string' && url.length > 0) {
            window.location.href = url;
            return null;
        }

        return originalOpen ? originalOpen.call(window, url, ...args) : null;
    };
})();
""";

        await webView.InvokeScript(script);
    }
}
