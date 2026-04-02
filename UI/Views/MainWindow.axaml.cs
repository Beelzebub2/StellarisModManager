using Avalonia.Controls;
using StellarisModManager.Core.Services;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        var db = new ModDatabase();
        var settings = AppSettings.Load();
        var downloader = new WorkshopDownloader();
        var installer = new ModInstaller();
        var updateChecker = new ModUpdateChecker();

        DataContext = new MainViewModel(db, settings, downloader, installer, updateChecker);
    }
}
