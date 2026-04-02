using Avalonia.Controls;
using System.IO;
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

        DataContext = new MainViewModel(db, settings, downloader, installer, updateChecker);
    }

    private void TrySetWindowIcon()
    {
        var iconPath = Path.Combine(AppContext.BaseDirectory, "UI", "Assets", "icon.jpg");
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
