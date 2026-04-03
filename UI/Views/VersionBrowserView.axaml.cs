using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using System;
using System.Linq;
using System.Threading.Tasks;
using StellarisModManager.Core.Utils;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class VersionBrowserView : UserControl
{
    private Vector _savedScrollOffset = default;
    private NativeWebView? _modDetailsWebView;
    private bool _modBrowserInitFailed;
    private bool _hasTriggeredInitialLoad;
    private bool _isInitialLoadRunning;

    public VersionBrowserView()
    {
        InitializeComponent();
        PropertyChanged += OnControlPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (_modDetailsWebView is not null)
        {
            _modDetailsWebView.EnvironmentRequested -= OnModBrowserEnvironmentRequested;
            _modDetailsWebView.NavigationCompleted -= OnModBrowserNavigationCompleted;

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
        }
        catch (Exception ex)
        {
            ModBrowserFallbackText.Text = $"Embedded browser encountered an error: {ex.Message}";
            ModBrowserFallbackPanel.IsVisible = true;
        }
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
