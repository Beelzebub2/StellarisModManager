using Avalonia.Controls;
using System.IO;
using System.Threading.Tasks;
using StellarisModManager.Core.Services;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class MainWindow : Window
{
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
        };

        DataContext = vm;
    }

    private async Task<(bool goToSettings, bool skipVersion)> ShowUpdatePromptAsync(string versionMsg)
    {
        var prompt = new UpdateAvailablePromptWindow(versionMsg);
        var result = await prompt.ShowDialog<(bool goToSettings, bool skipVersion)?>(this);
        return result ?? (false, false);
    }

    private async Task<(bool proceed, bool skipPrompt)> ShowRestartConfirmationAsync()
    {
        var prompt = new RestartGamePromptWindow();
        var result = await prompt.ShowDialog<(bool proceed, bool skipPrompt)?>(this);
        return result ?? (false, false);
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
