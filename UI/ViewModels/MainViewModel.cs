using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    // Currently active view model (Browser, Library, or Settings)
    [ObservableProperty] private ViewModelBase _activeView = null!;

    public bool IsBrowserActive => ReferenceEquals(ActiveView, BrowserViewModel);
    public bool IsLibraryActive => ReferenceEquals(ActiveView, LibraryViewModel);
    public bool IsSettingsActive => ReferenceEquals(ActiveView, SettingsViewModel);

    // The three navigation items
    public BrowserViewModel BrowserViewModel { get; }
    public LibraryViewModel LibraryViewModel { get; }
    public SettingsViewModel SettingsViewModel { get; }

    // Status bar
    [ObservableProperty] private string _statusMessage = "Ready";
    [ObservableProperty] private int _downloadProgress = 0;
    [ObservableProperty] private bool _isDownloading = false;

    // App version
    public string AppVersion => "v1.0.0";

    public MainViewModel(
        ModDatabase db,
        AppSettings settings,
        WorkshopDownloader downloader,
        ModInstaller installer,
        ModUpdateChecker updateChecker)
    {
        BrowserViewModel = new BrowserViewModel();
        LibraryViewModel = new LibraryViewModel(db, updateChecker, installer, downloader, settings);
        SettingsViewModel = new SettingsViewModel(settings, new Core.Services.GameDetector(), downloader);

        // Wire browser install requests to download + install flow
        BrowserViewModel.InstallModRequested += async (_, workshopId) =>
        {
            await HandleInstallRequestAsync(workshopId, db, settings, downloader, installer);
        };

        // Wire downloader progress to status bar
        downloader.ProgressChanged += (_, e) =>
        {
            StatusMessage = e.StatusMessage;
            if (e.ProgressPercent >= 0)
                DownloadProgress = e.ProgressPercent;
            IsDownloading = true;
        };

        downloader.DownloadComplete += async (_, e) =>
        {
            IsDownloading = false;
            DownloadProgress = 0;
            if (e.Success)
            {
                StatusMessage = $"Mod {e.ModId} installed successfully";
                await LibraryViewModel.RefreshAsync();
            }
            else
            {
                StatusMessage = $"Install failed: {e.ErrorMessage}";
            }
        };

        // Start on BrowserView
        ActiveView = BrowserViewModel;

        // Initialize DB and load settings asynchronously
        _ = InitializeAsync(db, settings);
    }

    private async Task InitializeAsync(ModDatabase db, AppSettings settings)
    {
        await db.InitializeAsync();
        await LibraryViewModel.LoadModsAsync();

        // Auto-detect on first run if no game path is set
        if (settings.AutoDetectGame && string.IsNullOrWhiteSpace(settings.GamePath))
        {
            var detector = new Core.Services.GameDetector();
            var detected = detector.DetectGamePath();
            if (detected is not null)
            {
                settings.GamePath = detected;
                settings.ModsPath ??= detector.GetDefaultModsPath();
                settings.Save();
            }
        }

        StatusMessage = "Ready";
    }

    private async Task HandleInstallRequestAsync(
        string workshopId,
        ModDatabase db,
        AppSettings settings,
        WorkshopDownloader downloader,
        ModInstaller installer)
    {
        if (string.IsNullOrWhiteSpace(settings.SteamCmdPath) ||
            !downloader.IsSteamCmdAvailable(settings.SteamCmdPath))
        {
            StatusMessage = "SteamCMD not configured. Please go to Settings.";
            ActiveView = SettingsViewModel;
            return;
        }

        var modsPath = settings.ModsPath ?? new Core.Services.GameDetector().GetDefaultModsPath();
        var downloadPath = settings.SteamCmdDownloadPath ?? modsPath;

        StatusMessage = $"Downloading mod {workshopId}...";
        IsDownloading = true;

        var downloadedPath = await downloader.DownloadModAsync(
            workshopId,
            settings.SteamCmdPath,
            downloadPath);

        if (downloadedPath is null)
        {
            StatusMessage = $"Download failed for mod {workshopId}";
            IsDownloading = false;
            return;
        }

        var modInfo = await downloader.GetModInfoAsync(workshopId);
        var mod = await installer.InstallModAsync(workshopId, downloadedPath, modsPath, modInfo);
        await db.AddModAsync(mod);

        IsDownloading = false;
        StatusMessage = $"Installed: {mod.Name}";
        await LibraryViewModel.RefreshAsync();
    }

    [RelayCommand]
    private void NavigateToBrowser() => ActiveView = BrowserViewModel;

    [RelayCommand]
    private void NavigateToLibrary() => ActiveView = LibraryViewModel;

    [RelayCommand]
    private void NavigateToSettings() => ActiveView = SettingsViewModel;

    partial void OnActiveViewChanged(ViewModelBase value)
    {
        OnPropertyChanged(nameof(IsBrowserActive));
        OnPropertyChanged(nameof(IsLibraryActive));
        OnPropertyChanged(nameof(IsSettingsActive));
    }
}
