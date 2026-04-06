using Avalonia.Controls;
using System;
using System.IO;
using System.Threading.Tasks;
using StellarisModManager.Core.Services;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class MainWindow : Window
{
    private readonly AppSettings _settings;
    private readonly MainViewModel _vm;

    public MainWindow()
    {
        InitializeComponent();
        TrySetWindowIcon();

        var db = new ModDatabase();
        var settings = AppSettings.Load();
        ThemePaletteService.ApplyPalette(settings.ThemePalette);
        var downloader = new WorkshopDownloader();
        var installer = new ModInstaller();
        var updateChecker = new ModUpdateChecker();

        var vm = new MainViewModel(db, settings, downloader, installer, updateChecker)
        {
            RequestRestartConfirmationAsync = ShowRestartConfirmationAsync,
            RequestUpdatePromptAsync = ShowUpdatePromptAsync,
            RequestSharedProfileInstallConfirmationAsync = ShowSharedProfileInstallConfirmationAsync,
        };

        _settings = settings;
        _vm = vm;
        DataContext = vm;

        Opened += MainWindow_Opened;
    }

    private async void MainWindow_Opened(object? sender, EventArgs e)
    {
        Opened -= MainWindow_Opened;
        await EnsurePublicUsernameAsync();
    }

    private async Task<(bool installNow, bool skipVersion)> ShowUpdatePromptAsync(string versionMsg)
    {
        var prompt = new UpdateAvailablePromptWindow(versionMsg);
        var result = await prompt.ShowDialog<(bool installNow, bool skipVersion)?>(this);
        return result ?? (false, false);
    }

    private async Task<(bool proceed, bool skipPrompt)> ShowRestartConfirmationAsync()
    {
        var prompt = new RestartGamePromptWindow();
        var result = await prompt.ShowDialog<(bool proceed, bool skipPrompt)?>(this);
        return result ?? (false, false);
    }

    private async Task<bool> ShowSharedProfileInstallConfirmationAsync(string message)
    {
        var prompt = new SharedProfileInstallPromptWindow(message);
        var result = await prompt.ShowDialog<bool?>(this);
        return result == true;
    }

    private async Task EnsurePublicUsernameAsync()
    {
        if (!string.IsNullOrWhiteSpace(_settings.PublicProfileUsername))
            return;

        var prompt = new PublicUsernamePromptWindow();
        var result = await prompt.ShowDialog<string?>(this);
        var username = (result ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username))
        {
            _vm.StatusMessage = "Tip: Add a public username to personalize shared profiles.";
            return;
        }

        _settings.PublicProfileUsername = username;
        _settings.Save();
        _vm.StatusMessage = $"Public username set to {username}.";
    }

    private void TrySetWindowIcon()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "UI", "Assets", "app.ico");
        if (!File.Exists(iconPath))
            iconPath = Path.Combine(AppContext.BaseDirectory, "UI", "Assets", "icon.jpg");

        if (!File.Exists(iconPath))
            return;

        try
        {
            Icon = new WindowIcon(iconPath);
        }
        catch
        {
            // Ignore icon loading errors to avoid blocking app startup.
        }
    }
}
