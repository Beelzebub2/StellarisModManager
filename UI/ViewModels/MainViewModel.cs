using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private readonly AppSettings _settings;
    private readonly ModDatabase _db;
    private readonly WorkshopDownloader _downloader;
    private readonly ModInstaller _installer;

    private readonly object _installQueueLock = new();
    private readonly Queue<string> _installQueue = new();
    private readonly HashSet<string> _queuedOrInstallingIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _overlayModStates = new(StringComparer.Ordinal);

    private bool _isInstallQueueRunning;
    private int _installQueueTotal;
    private int _installQueueCompleted;
    private int _currentInstallQueueIndex;
    private int _currentInstallPercent;

    // Currently active view model (Workshop, Library, or Settings)
    [ObservableProperty] private ViewModelBase _activeView = null!;

    public bool IsWorkshopActive => ReferenceEquals(ActiveView, WorkshopViewModel);
    public bool IsLibraryActive => ReferenceEquals(ActiveView, LibraryViewModel);
    public bool IsSettingsActive => ReferenceEquals(ActiveView, SettingsViewModel);
    public bool IsVersionBrowserActive => ReferenceEquals(ActiveView, VersionBrowserViewModel);

    // The four navigation items
    public WorkshopViewModel WorkshopViewModel { get; }
    public LibraryViewModel LibraryViewModel { get; }
    public SettingsViewModel SettingsViewModel { get; }
    public VersionBrowserViewModel VersionBrowserViewModel { get; }

    // Status bar
    [ObservableProperty] private string _statusMessage = "Ready";
    [ObservableProperty] private int _downloadProgress = 0;
    [ObservableProperty] private bool _isDownloading = false;
    [ObservableProperty] private string _queueProgressText = "";

    // App version
    public string AppVersion => "v1.0.0";

    public MainViewModel(
        ModDatabase db,
        AppSettings settings,
        WorkshopDownloader downloader,
        ModInstaller installer,
        ModUpdateChecker updateChecker)
    {
        _settings = settings;
        _db = db;
        _downloader = downloader;
        _installer = installer;

        WorkshopViewModel = new WorkshopViewModel();
        LibraryViewModel = new LibraryViewModel(db, updateChecker, installer, downloader, settings);
        SettingsViewModel = new SettingsViewModel(settings, new Core.Services.GameDetector(), downloader);
        VersionBrowserViewModel = new VersionBrowserViewModel(downloader);

        // Wire workshop install requests to download + install flow
        WorkshopViewModel.InstallModRequested += (_, workshopId) =>
        {
            EnqueueInstallRequest(workshopId);
        };

        WorkshopViewModel.UninstallModRequested += async (_, workshopId) =>
        {
            await HandleUninstallRequestAsync(workshopId);
        };

        VersionBrowserViewModel.InstallModRequested += (_, workshopId) =>
        {
            EnqueueInstallRequest(workshopId);
        };

        VersionBrowserViewModel.UninstallModRequested += async (_, workshopId) =>
        {
            await HandleUninstallRequestAsync(workshopId);
        };

        // Wire downloader progress to status bar
        downloader.ProgressChanged += (_, e) =>
        {
            OnDownloadProgressChanged(e.StatusMessage, e.ProgressPercent);
        };

        downloader.DownloadComplete += async (_, e) =>
        {
            var handledByQueue = false;
            lock (_installQueueLock)
            {
                handledByQueue = _queuedOrInstallingIds.Contains(e.ModId) || _isInstallQueueRunning;
            }

            if (handledByQueue)
                return;

            RunOnUiThread(() =>
            {
                IsDownloading = false;
                DownloadProgress = 0;
                QueueProgressText = string.Empty;
            });

            if (e.Success)
            {
                await LibraryViewModel.RefreshAsync();
                UpdateWorkshopOverlayState();
                RunOnUiThread(() => StatusMessage = $"Mod {e.ModId} installed successfully");
            }
            else
            {
                RunOnUiThread(() => StatusMessage = $"Install failed: {e.ErrorMessage}");
            }
        };

        // Start on LibraryView to avoid WebView2 cold-start cost at app launch.
        ActiveView = LibraryViewModel;

        // Initialize DB and load settings asynchronously
        _ = InitializeAsync(db, settings);
    }

    private async Task InitializeAsync(ModDatabase db, AppSettings settings)
    {
        await db.InitializeAsync();
        await LibraryViewModel.LoadModsAsync();
        UpdateWorkshopOverlayState();

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
        _ = TryWarmUpSteamCmdAsync(settings);
    }

    private async Task TryWarmUpSteamCmdAsync(AppSettings settings)
    {
        if (string.IsNullOrWhiteSpace(settings.SteamCmdPath) ||
            !_downloader.IsSteamCmdAvailable(settings.SteamCmdPath))
        {
            return;
        }

        var modsPath = settings.ModsPath ?? new Core.Services.GameDetector().GetDefaultModsPath();
        var downloadPath = settings.SteamCmdDownloadPath ?? modsPath;

        _downloader.PublishDiagnostic($"[startup] Prewarming SteamCMD using '{downloadPath}'");
        await _downloader.WarmUpSteamCmdAsync(settings.SteamCmdPath, downloadPath);
    }

    private void EnqueueInstallRequest(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        workshopId = workshopId.Trim();

        var startWorker = false;
        var queueText = string.Empty;

        lock (_installQueueLock)
        {
            if (LibraryViewModel.GetInstalledWorkshopIds().Contains(workshopId, StringComparer.Ordinal))
            {
                SetOverlayModState(workshopId, "installed");
                RunOnUiThread(() => StatusMessage = $"Mod {workshopId} is already installed.");
                return;
            }

            if (_queuedOrInstallingIds.Contains(workshopId))
            {
                RunOnUiThread(() => StatusMessage = $"Mod {workshopId} is already queued.");
                return;
            }

            _installQueue.Enqueue(workshopId);
            _queuedOrInstallingIds.Add(workshopId);
            _installQueueTotal++;
            _overlayModStates[workshopId] = "queued";

            queueText = _currentInstallQueueIndex > 0
                ? $"{_currentInstallQueueIndex}/{_installQueueTotal}"
                : $"0/{_installQueueTotal}";

            if (!_isInstallQueueRunning)
            {
                _isInstallQueueRunning = true;
                startWorker = true;
            }
        }

        RunOnUiThread(() =>
        {
            IsDownloading = true;
            QueueProgressText = queueText;
            DownloadProgress = CalculateQueueOverallPercent();
            StatusMessage = $"Queued mod {workshopId}";
        });

        UpdateWorkshopOverlayState();

        if (startWorker)
            _ = ProcessInstallQueueAsync();
    }

    private async Task ProcessInstallQueueAsync()
    {
        while (true)
        {
            string workshopId;
            int queueIndex;
            int queueTotal;
            int queueCompleted;

            lock (_installQueueLock)
            {
                if (_installQueue.Count == 0)
                {
                    _isInstallQueueRunning = false;
                    _installQueueTotal = 0;
                    _installQueueCompleted = 0;
                    _currentInstallQueueIndex = 0;
                    _currentInstallPercent = 0;
                    break;
                }

                workshopId = _installQueue.Dequeue();
                _currentInstallQueueIndex = _installQueueCompleted + 1;
                _currentInstallPercent = 0;
                _overlayModStates[workshopId] = "installing";

                queueIndex = _currentInstallQueueIndex;
                queueTotal = _installQueueTotal;
                queueCompleted = _installQueueCompleted;
            }

            RunOnUiThread(() =>
            {
                IsDownloading = true;
                QueueProgressText = $"{queueIndex}/{queueTotal}";
                DownloadProgress = CalculateQueueOverallPercent(queueCompleted, queueTotal, 0);
                StatusMessage = $"Starting mod {workshopId} ({QueueProgressText})";
            });

            UpdateWorkshopOverlayState();

            var success = await InstallSingleModAsync(workshopId);

            lock (_installQueueLock)
            {
                _installQueueCompleted++;
                _queuedOrInstallingIds.Remove(workshopId);
                _currentInstallPercent = 100;

                if (!success)
                    _overlayModStates[workshopId] = "error";
            }

            if (!success)
                UpdateWorkshopOverlayState();

            if (!success)
                continue;
        }

        RunOnUiThread(() =>
        {
            IsDownloading = false;
            DownloadProgress = 0;
            QueueProgressText = string.Empty;

            if (StatusMessage.StartsWith("Installed", StringComparison.OrdinalIgnoreCase) ||
                StatusMessage.StartsWith("Skipped", StringComparison.OrdinalIgnoreCase))
            {
                StatusMessage = "Install queue complete";
            }
        });
    }

    private async Task<bool> InstallSingleModAsync(string workshopId)
    {
        if (LibraryViewModel.GetInstalledWorkshopIds().Contains(workshopId, StringComparer.Ordinal))
        {
            SetOverlayModState(workshopId, "installed");
            RunOnUiThread(() => StatusMessage = $"Skipped {workshopId}: already installed");
            return true;
        }

        if (string.IsNullOrWhiteSpace(_settings.SteamCmdPath) ||
            !_downloader.IsSteamCmdAvailable(_settings.SteamCmdPath))
        {
            SetOverlayModState(workshopId, "error");
            RunOnUiThread(() =>
            {
                StatusMessage = "SteamCMD not configured. Please go to Settings.";
                ActiveView = SettingsViewModel;
            });
            return false;
        }

        var modsPath = _settings.ModsPath ?? new Core.Services.GameDetector().GetDefaultModsPath();
        var downloadPath = _settings.SteamCmdDownloadPath ?? modsPath;
        _downloader.PublishDiagnostic($"[install:{workshopId}] Starting install pipeline. downloadPath='{downloadPath}', modsPath='{modsPath}'");

        var downloadedPath = await _downloader.DownloadModAsync(
            workshopId,
            _settings.SteamCmdPath,
            downloadPath);

        if (downloadedPath is null)
        {
            _downloader.PublishDiagnostic($"[install:{workshopId}] Download step failed.");
            SetOverlayModState(workshopId, "error");
            RunOnUiThread(() => StatusMessage = $"Download failed for mod {workshopId}");
            return false;
        }

        try
        {
            _downloader.PublishDiagnostic($"[install:{workshopId}] Download step succeeded. downloadedPath='{downloadedPath}'");
            var modInfo = await _downloader.GetModInfoAsync(workshopId);
            var mod = await _installer.InstallModAsync(workshopId, downloadedPath, modsPath, modInfo);
            _downloader.PublishDiagnostic($"[install:{workshopId}] File install step succeeded. Registering in database...");
            await _db.AddModAsync(mod);

            await LibraryViewModel.RefreshAsync();
            SetOverlayModState(workshopId, "installed");
            UpdateWorkshopOverlayState();
            _downloader.PublishDiagnostic($"[install:{workshopId}] Completed successfully as '{mod.Name}'.");

            RunOnUiThread(() => StatusMessage = $"Installed: {mod.Name}");
            return true;
        }
        catch (Exception ex)
        {
            _downloader.PublishDiagnostic($"[install:{workshopId}] Failed after download: {ex.Message}");
            SetOverlayModState(workshopId, "error");
            RunOnUiThread(() => StatusMessage = $"Install failed for {workshopId}: {ex.Message}");
            return false;
        }
    }

    private void OnDownloadProgressChanged(string statusMessage, int progressPercent)
    {
        var isQueueMode = false;
        var queueText = string.Empty;
        var overallPercent = 0;

        lock (_installQueueLock)
        {
            if (_isInstallQueueRunning && _installQueueTotal > 0)
            {
                if (progressPercent >= 0)
                    _currentInstallPercent = Math.Clamp(progressPercent, 0, 100);

                queueText = $"{Math.Max(_currentInstallQueueIndex, 1)}/{_installQueueTotal}";
                overallPercent = CalculateQueueOverallPercent();
                isQueueMode = true;
            }
        }

        RunOnUiThread(() =>
        {
            IsDownloading = true;

            if (isQueueMode)
            {
                QueueProgressText = queueText;
                DownloadProgress = overallPercent;
                StatusMessage = $"{statusMessage} ({queueText})";
                return;
            }

            QueueProgressText = string.Empty;
            if (progressPercent >= 0)
                DownloadProgress = progressPercent;
            StatusMessage = statusMessage;
        });
    }

    private async Task HandleUninstallRequestAsync(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        SetOverlayModState(workshopId, "uninstalling");

        var removed = await LibraryViewModel.UninstallByWorkshopIdAsync(workshopId);
        StatusMessage = removed
            ? $"Uninstalled mod {workshopId}"
            : $"Mod {workshopId} is not installed";

        if (removed)
            RemoveOverlayModState(workshopId);
        else
            SetOverlayModState(workshopId, "installed");

        UpdateWorkshopOverlayState();
    }

    private void UpdateWorkshopOverlayState()
    {
        Dictionary<string, string> snapshot;
        lock (_installQueueLock)
        {
            snapshot = new Dictionary<string, string>(_overlayModStates, StringComparer.Ordinal);
        }

        RunOnUiThread(() =>
        {
            var installedIds = LibraryViewModel.GetInstalledWorkshopIds();
            var installedSet = new HashSet<string>(installedIds, StringComparer.Ordinal);

            foreach (var id in installedSet)
            {
                if (!snapshot.TryGetValue(id, out var state) ||
                    string.Equals(state, "error", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(state, "not-installed", StringComparison.OrdinalIgnoreCase))
                {
                    snapshot[id] = "installed";
                }
            }

            var keys = snapshot.Keys.ToList();
            foreach (var key in keys)
            {
                if (string.Equals(snapshot[key], "installed", StringComparison.OrdinalIgnoreCase) && !installedSet.Contains(key))
                    snapshot[key] = "not-installed";
            }

            WorkshopViewModel.SetInstalledWorkshopIds(installedIds);
            WorkshopViewModel.SetModStates(snapshot);
            VersionBrowserViewModel.SetInstalledWorkshopIds(installedIds);
            VersionBrowserViewModel.SetModStates(snapshot);
        });
    }

    private void SetOverlayModState(string workshopId, string state)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        lock (_installQueueLock)
        {
            _overlayModStates[workshopId] = state;
        }

        UpdateWorkshopOverlayState();
    }

    private void RemoveOverlayModState(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        lock (_installQueueLock)
        {
            _overlayModStates.Remove(workshopId);
        }
    }

    private int CalculateQueueOverallPercent()
    {
        lock (_installQueueLock)
        {
            return CalculateQueueOverallPercent(_installQueueCompleted, _installQueueTotal, _currentInstallPercent);
        }
    }

    private static int CalculateQueueOverallPercent(int completed, int total, int currentPercent)
    {
        if (total <= 0)
            return 0;

        var progress = (completed + (Math.Clamp(currentPercent, 0, 100) / 100.0)) / total;
        return (int)Math.Round(progress * 100, MidpointRounding.AwayFromZero);
    }

    private static void RunOnUiThread(Action action)
    {
        if (Dispatcher.UIThread.CheckAccess())
            action();
        else
            Dispatcher.UIThread.Post(action);
    }

    [RelayCommand]
    private void NavigateToWorkshop() => ActiveView = WorkshopViewModel;

    [RelayCommand]
    private void NavigateToLibrary() => ActiveView = LibraryViewModel;

    [RelayCommand]
    private void NavigateToSettings() => ActiveView = SettingsViewModel;

    [RelayCommand]
    private async Task NavigateToVersionBrowser()
    {
        ActiveView = VersionBrowserViewModel;
        await VersionBrowserViewModel.LoadAsync();
    }

    [RelayCommand]
    private void LaunchGame()
    {
        var gamePath = _settings.GamePath;
        if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
        {
            StatusMessage = "Set a valid game path in Settings first.";
            ActiveView = SettingsViewModel;
            return;
        }

        var candidates = new[]
        {
            Path.Combine(gamePath, "stellaris.exe"),
            Path.Combine(gamePath, "Stellaris.exe"),
            Path.Combine(gamePath, "dowser.exe"),
        };

        string? executable = null;
        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                executable = candidate;
                break;
            }
        }

        if (executable is null)
        {
            StatusMessage = "Could not find Stellaris executable in the configured game path.";
            ActiveView = SettingsViewModel;
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = Path.GetDirectoryName(executable) ?? gamePath,
                UseShellExecute = true,
            });

            StatusMessage = "Launching Stellaris...";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Launch failed: {ex.Message}";
        }
    }

    partial void OnActiveViewChanged(ViewModelBase value)
    {
        OnPropertyChanged(nameof(IsWorkshopActive));
        OnPropertyChanged(nameof(IsLibraryActive));
        OnPropertyChanged(nameof(IsSettingsActive));
        OnPropertyChanged(nameof(IsVersionBrowserActive));
    }
}
