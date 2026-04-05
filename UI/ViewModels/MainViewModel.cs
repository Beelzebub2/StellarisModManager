using System;
using System.Collections.ObjectModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private const int MaxConcurrentInstalls = 2;
    private static readonly TimeSpan ProgressUiUpdateThrottle = TimeSpan.FromMilliseconds(120);
    private const string DefaultStellarisyncBaseUrl = "https://stellarisync.rrmtools.uk";
    private static readonly HttpClient ServiceStatusHttp = new() { Timeout = TimeSpan.FromSeconds(4) };

    private readonly AppSettings _settings;
    private readonly ModDatabase _db;
    private readonly WorkshopDownloader _downloader;
    private readonly ModInstaller _installer;
    private readonly StellarisLauncherSyncService _launcherSync = new();
    private readonly DispatcherTimer _gameStateTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _serviceStatusTimer = new() { Interval = TimeSpan.FromMinutes(2) };

    private readonly object _installStateLock = new();
    private readonly Queue<string> _pendingInstallQueue = new();
    private readonly HashSet<string> _queuedOrInstallingIds = new(StringComparer.Ordinal);
    private readonly HashSet<string> _activeInstallIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _activeProgressByModId = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _overlayModStates = new(StringComparer.Ordinal);
    private readonly ObservableCollection<InstallQueueItemViewModel> _installQueueItems = new();
    private readonly Dictionary<string, InstallQueueItemViewModel> _installQueueItemsById = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CancellationTokenSource> _installCtsByModId = new(StringComparer.Ordinal);
    private readonly HashSet<string> _cancelRequestedInstallIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTime> _lastProgressUiUpdateByModId = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _lastProgressPercentByModId = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _lastProgressStageByModId = new(StringComparer.Ordinal);

    private int _serviceStatusRefreshGate;

    private int _installQueueTotal;
    private int _installQueueCompleted;

    private enum InstallRunResult
    {
        Success,
        Failed,
        Cancelled,
    }

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
    [ObservableProperty] private bool _isGameRunning;
    [ObservableProperty] private string _installQueueSummaryText = "Idle";
    [ObservableProperty] private string _stellarisyncConnectionStatus = "Checking...";
    [ObservableProperty] private bool _isStellarisyncOnline;

    public ObservableCollection<InstallQueueItemViewModel> InstallQueueItems => _installQueueItems;
    public bool HasInstallQueueItems => _installQueueItems.Count > 0;

    public string LaunchGameButtonText => IsGameRunning ? "Restart Game" : "Start Game";
    public string LaunchGameButtonIconGlyph => IsGameRunning ? "\uE72C" : "\uE768";
    public Func<Task<(bool proceed, bool skipPrompt)>>? RequestRestartConfirmationAsync { get; set; }
    public Func<string, Task<(bool installNow, bool skipVersion)>>? RequestUpdatePromptAsync { get; set; }
    public Func<string, Task<bool>>? RequestSharedProfileInstallConfirmationAsync { get; set; }

    // App version
    public string AppVersion => AppVersionInfo.GetDisplayVersion();

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

        _installQueueItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasInstallQueueItems));

        WorkshopViewModel = new WorkshopViewModel();
        LibraryViewModel = new LibraryViewModel(db, updateChecker, installer, downloader, settings);
        SettingsViewModel = new SettingsViewModel(settings, new Core.Services.GameDetector(), downloader, db);
        VersionBrowserViewModel = new VersionBrowserViewModel(downloader, settings, new Core.Services.GameDetector());

        SettingsViewModel.UpdateAvailableNotificationRequested += async (_, versionInfo) =>
        {
            if (RequestUpdatePromptAsync is null) return;
            var (installNow, skipVersion) = await RequestUpdatePromptAsync($"Version {versionInfo.Version} is available.");
            if (skipVersion)
            {
                SettingsViewModel.SkipAppUpdateCommand.Execute(null);
            }
            if (installNow && SettingsViewModel.InstallAppUpdateCommand.CanExecute(null))
            {
                SettingsViewModel.InstallAppUpdateCommand.Execute(null);
            }
        };

        LibraryViewModel.RequestSharedProfileInstallConfirmationAsync = async promptMessage =>
        {
            if (RequestSharedProfileInstallConfirmationAsync is null)
                return false;

            return await RequestSharedProfileInstallConfirmationAsync(promptMessage);
        };

        LibraryViewModel.QueueSharedProfileMissingModsAsync = QueueSharedProfileMissingModsForInstallAsync;

        LibraryViewModel.OpenWorkshopInAppRequested += (_, url) => OpenWorkshopUrlInApp(url);

        _gameStateTimer.Tick += (_, _) => RefreshGameRunningState();
        RefreshGameRunningState();
        _gameStateTimer.Start();

        _serviceStatusTimer.Tick += async (_, _) => await RefreshStellarisyncStatusAsync();
        _serviceStatusTimer.Start();

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
            OnDownloadProgressChanged(e.ModId, e.StatusMessage, e.ProgressPercent);
        };

        downloader.DownloadComplete += async (_, e) =>
        {
            var handledByQueue = false;
            lock (_installStateLock)
            {
                handledByQueue = _queuedOrInstallingIds.Contains(e.ModId);
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
                await LibraryViewModel.TryUpdateSharedSyncProfileAfterInstallAsync(e.ModId);
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
        RefreshGameRunningState();
        _ = RefreshStellarisyncStatusAsync();
        _ = TryWarmUpSteamCmdAsync(settings);
    }

    partial void OnIsGameRunningChanged(bool value)
    {
        OnPropertyChanged(nameof(LaunchGameButtonText));
        OnPropertyChanged(nameof(LaunchGameButtonIconGlyph));
    }

    private void RefreshGameRunningState()
    {
        IsGameRunning = IsStellarisRunning(_settings.GamePath);
    }

    private static bool IsStellarisRunning(string? gamePath)
    {
        var running = GetRunningStellarisProcesses(gamePath);
        foreach (var process in running)
            process.Dispose();

        return running.Count > 0;
    }

    private static List<Process> GetRunningStellarisProcesses(string? gamePath)
    {
        var matches = new List<Process>();
        var expectedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(gamePath))
        {
            expectedPaths.Add(Path.GetFullPath(Path.Combine(gamePath, "stellaris.exe")));
            expectedPaths.Add(Path.GetFullPath(Path.Combine(gamePath, "Stellaris.exe")));
        }

        foreach (var process in Process.GetProcessesByName("stellaris"))
        {
            var include = expectedPaths.Count == 0;

            if (!include)
            {
                try
                {
                    var path = process.MainModule?.FileName;
                    if (!string.IsNullOrWhiteSpace(path))
                        include = expectedPaths.Contains(Path.GetFullPath(path));
                    else
                        include = false;
                }
                catch
                {
                    include = false;
                }
            }

            if (include)
                matches.Add(process);
            else
                process.Dispose();
        }

        return matches;
    }

    private static bool SafeHasExited(Process process)
    {
        try
        {
            return process.HasExited;
        }
        catch
        {
            return true;
        }
    }

    private async Task<bool> EnsureReadyForLaunchAsync(string gamePath)
    {
        RefreshGameRunningState();
        if (!IsGameRunning)
            return true;

        if (_settings.WarnBeforeRestartGame)
        {
            if (RequestRestartConfirmationAsync is null)
            {
                StatusMessage = "Stellaris is already running. Close it before launching again.";
                return false;
            }

            var (proceed, skipPrompt) = await RequestRestartConfirmationAsync();
            if (!proceed)
            {
                StatusMessage = "Restart canceled.";
                return false;
            }

            if (skipPrompt)
            {
                _settings.WarnBeforeRestartGame = false;
                _settings.Save();
                SettingsViewModel.RefreshRestartWarningPreference();
            }
        }

        var runningProcesses = GetRunningStellarisProcesses(gamePath);
        if (runningProcesses.Count == 0)
        {
            RefreshGameRunningState();
            return true;
        }

        try
        {
            StatusMessage = "Closing running Stellaris process...";

            foreach (var process in runningProcesses)
            {
                try
                {
                    if (!SafeHasExited(process) && process.MainWindowHandle != IntPtr.Zero)
                        process.CloseMainWindow();
                }
                catch
                {
                    // Best-effort graceful close before hard kill.
                }
            }

            var closeDeadline = DateTime.UtcNow.AddSeconds(8);
            while (DateTime.UtcNow < closeDeadline)
            {
                if (runningProcesses.All(SafeHasExited))
                    break;

                await Task.Delay(250);
            }

            foreach (var process in runningProcesses)
            {
                try
                {
                    if (!SafeHasExited(process))
                        process.Kill(true);
                }
                catch
                {
                    // Process may already be gone or inaccessible.
                }
            }

            await Task.Delay(700);
            RefreshGameRunningState();
            var stillRunning = IsGameRunning;
            if (stillRunning)
            {
                StatusMessage = "Could not close running Stellaris process. Please close it manually.";
                return false;
            }
            return true;
        }
        finally
        {
            foreach (var process in runningProcesses)
                process.Dispose();
        }
    }

    private async Task TryWarmUpSteamCmdAsync(AppSettings settings)
    {
        if (settings.WorkshopDownloadRuntime != WorkshopDownloadRuntime.SteamCmd)
            return;

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

        lock (_installStateLock)
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

            if (_installQueueCompleted >= _installQueueTotal && _activeInstallIds.Count == 0 && _pendingInstallQueue.Count == 0)
            {
                _installQueueTotal = 0;
                _installQueueCompleted = 0;
                _activeProgressByModId.Clear();
            }

            _pendingInstallQueue.Enqueue(workshopId);
            _queuedOrInstallingIds.Add(workshopId);
            _installQueueTotal++;
            _overlayModStates[workshopId] = "queued";
        }

        UpsertInstallQueueItem(workshopId, item =>
        {
            item.Stage = "Queued";
            item.Progress = 0;
            item.IsActive = false;
            item.CanCancel = true;
        });

        RunOnUiThread(() =>
        {
            IsDownloading = true;
            StatusMessage = $"Queued mod {workshopId}";
        });

        UpdateWorkshopOverlayState();

        StartPendingInstalls();
        UpdateInstallUiFromState();
    }

    private Task QueueSharedProfileMissingModsForInstallAsync(IReadOnlyList<string> workshopIds)
    {
        foreach (var workshopId in workshopIds)
            EnqueueInstallRequest(workshopId);

        return Task.CompletedTask;
    }

    private void StartPendingInstalls()
    {
        var toStart = new List<string>();

        lock (_installStateLock)
        {
            while (_pendingInstallQueue.Count > 0 && _activeInstallIds.Count < MaxConcurrentInstalls)
            {
                var workshopId = _pendingInstallQueue.Dequeue();
                _activeInstallIds.Add(workshopId);
                _activeProgressByModId[workshopId] = 0;
                _overlayModStates[workshopId] = "installing";
                _installCtsByModId[workshopId] = new CancellationTokenSource();
                toStart.Add(workshopId);
            }
        }

        if (toStart.Count == 0)
            return;

        foreach (var workshopId in toStart)
        {
            CancellationToken token;
            lock (_installStateLock)
            {
                token = _installCtsByModId.TryGetValue(workshopId, out var cts)
                    ? cts.Token
                    : CancellationToken.None;
            }

            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Starting";
                item.IsActive = true;
                item.CanCancel = true;
            });
            _ = ProcessInstallRequestAsync(workshopId, token);
        }

        UpdateInstallUiFromState();
        UpdateWorkshopOverlayState();
    }

    private async Task ProcessInstallRequestAsync(string workshopId, CancellationToken cancellationToken)
    {
        RunOnUiThread(() => StatusMessage = $"Starting mod {workshopId}...");

        var result = await InstallSingleModAsync(workshopId, cancellationToken);
        var success = result == InstallRunResult.Success;
        var cancelled = result == InstallRunResult.Cancelled;

        var finishedBatch = false;
        lock (_installStateLock)
        {
            _installQueueCompleted++;
            _queuedOrInstallingIds.Remove(workshopId);
            _activeInstallIds.Remove(workshopId);
            _activeProgressByModId.Remove(workshopId);
            _lastProgressUiUpdateByModId.Remove(workshopId);
            _lastProgressPercentByModId.Remove(workshopId);
            _lastProgressStageByModId.Remove(workshopId);
            _cancelRequestedInstallIds.Remove(workshopId);

            if (_installCtsByModId.Remove(workshopId, out var cts))
            {
                cts.Dispose();
            }

            if (!success && !cancelled)
                _overlayModStates[workshopId] = "error";

            finishedBatch =
                _installQueueCompleted >= _installQueueTotal &&
                _activeInstallIds.Count == 0 &&
                _pendingInstallQueue.Count == 0;
        }

        if (!success && !cancelled)
            UpdateWorkshopOverlayState();

        MarkQueueItemFinished(workshopId, result);

        StartPendingInstalls();
        UpdateInstallUiFromState();

        if (finishedBatch)
        {
            RunOnUiThread(() =>
            {
                IsDownloading = false;
                DownloadProgress = 100;
                QueueProgressText = string.Empty;

                if (StatusMessage.StartsWith("Installed", StringComparison.OrdinalIgnoreCase) ||
                    StatusMessage.StartsWith("Skipped", StringComparison.OrdinalIgnoreCase))
                {
                    StatusMessage = "Install queue complete";
                }

                _ = Task.Run(async () =>
                {
                    await Task.Delay(600);
                    RunOnUiThread(() => DownloadProgress = 0);
                });
            });

            lock (_installStateLock)
            {
                _installQueueTotal = 0;
                _installQueueCompleted = 0;
                _activeProgressByModId.Clear();
            }
        }
    }

    private async Task<InstallRunResult> InstallSingleModAsync(string workshopId, CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
            return InstallRunResult.Cancelled;

        if (LibraryViewModel.GetInstalledWorkshopIds().Contains(workshopId, StringComparer.Ordinal))
        {
            SetOverlayModState(workshopId, "installed");
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Already installed";
                item.Progress = 100;
                item.CanCancel = false;
            });
            RunOnUiThread(() => StatusMessage = $"Skipped {workshopId}: already installed");
            return InstallRunResult.Success;
        }

        var selectedRuntime = _settings.WorkshopDownloadRuntime;

        if (selectedRuntime == WorkshopDownloadRuntime.SteamCmd &&
            (string.IsNullOrWhiteSpace(_settings.SteamCmdPath) ||
             !_downloader.IsSteamCmdAvailable(_settings.SteamCmdPath)))
        {
            SetOverlayModState(workshopId, "error");
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "SteamCMD missing";
                item.IsActive = false;
                item.CanCancel = false;
            });
            RunOnUiThread(() =>
            {
                StatusMessage = "SteamCMD runtime selected, but steamcmd.exe is not configured. Please go to Settings.";
                ActiveView = SettingsViewModel;
            });
            return InstallRunResult.Failed;
        }

        var modsPath = _settings.ModsPath ?? new Core.Services.GameDetector().GetDefaultModsPath();
        var downloadPath = _settings.SteamCmdDownloadPath ?? modsPath;
        _downloader.PublishDiagnostic($"[install:{workshopId}] Starting install pipeline. runtime='{selectedRuntime}', downloadPath='{downloadPath}', modsPath='{modsPath}'");

        var downloadedPath = await _downloader.DownloadModAsync(
            workshopId,
            _settings.SteamCmdPath,
            downloadPath,
            selectedRuntime,
            cancellationToken);

        if (cancellationToken.IsCancellationRequested)
        {
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Cancelled";
                item.IsActive = false;
                item.CanCancel = false;
            });
            RunOnUiThread(() => StatusMessage = $"Cancelled mod {workshopId}");
            SetOverlayModState(workshopId, "not-installed");
            return InstallRunResult.Cancelled;
        }

        if (downloadedPath is null)
        {
            _downloader.PublishDiagnostic($"[install:{workshopId}] Download step failed.");
            SetOverlayModState(workshopId, "error");
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Download failed";
                item.IsActive = false;
                item.CanCancel = false;
            });
            var hasFailureReason = _downloader.TryGetLastFailureReason(workshopId, out var failureReason);
            var message = hasFailureReason
                ? $"Download failed for mod {workshopId}: {failureReason}"
                : $"Download failed for mod {workshopId} using runtime {selectedRuntime}";
            RunOnUiThread(() => StatusMessage = message);
            return InstallRunResult.Failed;
        }

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            _downloader.PublishDiagnostic($"[install:{workshopId}] Download step succeeded. downloadedPath='{downloadedPath}'");
            var modInfo = await _downloader.GetModInfoAsync(workshopId);
            var mod = await _installer.InstallModAsync(workshopId, downloadedPath, modsPath, modInfo);
            UpsertInstallQueueItem(workshopId, item => item.DisplayName = mod.Name);
            _downloader.PublishDiagnostic($"[install:{workshopId}] File install step succeeded. Registering in database...");
            await _db.AddModAsync(mod);

            await LibraryViewModel.RefreshAsync();
            await LibraryViewModel.TryUpdateSharedSyncProfileAfterInstallAsync(workshopId);
            SetOverlayModState(workshopId, "installed");
            UpdateWorkshopOverlayState();
            _downloader.PublishDiagnostic($"[install:{workshopId}] Completed successfully as '{mod.Name}'.");

            RunOnUiThread(() => StatusMessage = $"Installed: {mod.Name}");
            return InstallRunResult.Success;
        }
        catch (OperationCanceledException)
        {
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Cancelled";
                item.IsActive = false;
                item.CanCancel = false;
            });
            SetOverlayModState(workshopId, "not-installed");
            RunOnUiThread(() => StatusMessage = $"Cancelled mod {workshopId}");
            return InstallRunResult.Cancelled;
        }
        catch (Exception ex)
        {
            _downloader.PublishDiagnostic($"[install:{workshopId}] Failed after download: {ex.Message}");
            SetOverlayModState(workshopId, "error");
            UpsertInstallQueueItem(workshopId, item =>
            {
                item.Stage = "Install failed";
                item.IsActive = false;
                item.CanCancel = false;
            });
            RunOnUiThread(() => StatusMessage = $"Install failed for {workshopId}: {ex.Message}");
            return InstallRunResult.Failed;
        }
    }

    private void OnDownloadProgressChanged(string modId, string statusMessage, int progressPercent)
    {
        var isQueueMode = false;
        var queueText = string.Empty;
        var overallPercent = 0;
        var shouldRenderUi = true;
        var compactStage = CompactInstallStage(statusMessage);

        lock (_installStateLock)
        {
            if (_installQueueTotal > 0 && !string.IsNullOrWhiteSpace(modId) && _queuedOrInstallingIds.Contains(modId))
            {
                if (_activeInstallIds.Contains(modId) && progressPercent >= 0)
                    _activeProgressByModId[modId] = Math.Clamp(progressPercent, 0, 100);

                var started = Math.Min(_installQueueTotal, _installQueueCompleted + _activeInstallIds.Count);
                queueText = _installQueueTotal > 0 ? $"{started}/{_installQueueTotal}" : string.Empty;
                overallPercent = CalculateOverallProgressPercent_NoLock();
                isQueueMode = true;
            }

            if (!string.IsNullOrWhiteSpace(modId) && _cancelRequestedInstallIds.Contains(modId))
            {
                shouldRenderUi = false;
            }
            else if (!string.IsNullOrWhiteSpace(modId))
            {
                var now = DateTime.UtcNow;
                _lastProgressUiUpdateByModId.TryGetValue(modId, out var lastUpdateUtc);
                _lastProgressPercentByModId.TryGetValue(modId, out var lastPercent);
                _lastProgressStageByModId.TryGetValue(modId, out var lastStage);

                var stageChanged = !string.Equals(lastStage, compactStage, StringComparison.OrdinalIgnoreCase);
                var progressChanged = progressPercent >= 0 && progressPercent != lastPercent;
                var dueByTime = lastUpdateUtc == default || now - lastUpdateUtc >= ProgressUiUpdateThrottle;
                var isTerminalProgress = progressPercent is >= 99 or 0;

                shouldRenderUi = stageChanged || isTerminalProgress || (progressChanged && dueByTime) || dueByTime;

                if (shouldRenderUi)
                {
                    _lastProgressUiUpdateByModId[modId] = now;
                    if (progressPercent >= 0)
                        _lastProgressPercentByModId[modId] = progressPercent;
                    _lastProgressStageByModId[modId] = compactStage;
                }
            }
        }

        if (!shouldRenderUi)
            return;

        RunOnUiThread(() =>
        {
            IsDownloading = true;

            if (!string.IsNullOrWhiteSpace(modId))
            {
                UpsertInstallQueueItem(modId, item =>
                {
                    item.Stage = compactStage;
                    item.IsActive = true;
                    item.CanCancel = true;
                    if (progressPercent >= 0)
                        item.Progress = Math.Clamp(progressPercent, 0, 100);
                });
            }

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
        var stillInstalled = LibraryViewModel
            .GetInstalledWorkshopIds()
            .Contains(workshopId, StringComparer.Ordinal);

        if (removed)
        {
            StatusMessage = $"Uninstalled mod {workshopId}";
            RemoveOverlayModState(workshopId);
        }
        else
        {
            StatusMessage = stillInstalled
                ? $"Could not uninstall mod {workshopId}."
                : $"Mod {workshopId} is not installed";

            if (stillInstalled)
                SetOverlayModState(workshopId, "installed");
            else
                SetOverlayModState(workshopId, "not-installed");
        }

        UpdateWorkshopOverlayState();
    }

    private void UpdateWorkshopOverlayState()
    {
        Dictionary<string, string> snapshot;
        lock (_installStateLock)
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

        lock (_installStateLock)
        {
            _overlayModStates[workshopId] = state;
        }

        UpdateWorkshopOverlayState();
    }

    private void RemoveOverlayModState(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        lock (_installStateLock)
        {
            _overlayModStates.Remove(workshopId);
        }
    }

    private void CancelInstallRequest(string modId)
    {
        if (string.IsNullOrWhiteSpace(modId))
            return;

        var trimmed = modId.Trim();
        var cancelledPending = false;
        var cancellingActive = false;

        lock (_installStateLock)
        {
            cancelledPending = RemovePendingInstall_NoLock(trimmed);
            if (cancelledPending)
            {
                _queuedOrInstallingIds.Remove(trimmed);
                _overlayModStates[trimmed] = "not-installed";
                if (_installQueueTotal > 0)
                    _installQueueTotal--;
            }
            else if (_activeInstallIds.Contains(trimmed))
            {
                cancellingActive = true;
                _cancelRequestedInstallIds.Add(trimmed);
                if (_installCtsByModId.TryGetValue(trimmed, out var cts) && !cts.IsCancellationRequested)
                    cts.Cancel();
            }
        }

        if (cancelledPending)
        {
            UpsertInstallQueueItem(trimmed, item =>
            {
                item.Stage = "Cancelled";
                item.IsActive = false;
                item.CanCancel = false;
                item.Progress = 0;
            });

            _ = Task.Run(async () =>
            {
                await Task.Delay(1400);
                RunOnUiThread(() => RemoveInstallQueueItem(trimmed));
            });

            RunOnUiThread(() => StatusMessage = $"Cancelled queued mod {trimmed}");
            StartPendingInstalls();
            UpdateInstallUiFromState();
            UpdateWorkshopOverlayState();
            return;
        }

        if (cancellingActive)
        {
            UpsertInstallQueueItem(trimmed, item =>
            {
                item.Stage = "Cancelling...";
                item.IsActive = true;
                item.CanCancel = false;
            });

            RunOnUiThread(() => StatusMessage = $"Cancelling mod {trimmed}...");
        }
    }

    private bool RemovePendingInstall_NoLock(string workshopId)
    {
        if (_pendingInstallQueue.Count == 0)
            return false;

        var removed = false;
        var rebuilt = new Queue<string>(_pendingInstallQueue.Count);

        while (_pendingInstallQueue.Count > 0)
        {
            var current = _pendingInstallQueue.Dequeue();
            if (!removed && string.Equals(current, workshopId, StringComparison.Ordinal))
            {
                removed = true;
                continue;
            }

            rebuilt.Enqueue(current);
        }

        while (rebuilt.Count > 0)
            _pendingInstallQueue.Enqueue(rebuilt.Dequeue());

        return removed;
    }

    private void UpdateInstallUiFromState()
    {
        int total;
        int completed;
        int active;
        int pending;
        int overallPercent;
        string queueText;

        lock (_installStateLock)
        {
            total = _installQueueTotal;
            completed = _installQueueCompleted;
            active = _activeInstallIds.Count;
            pending = _pendingInstallQueue.Count;
            overallPercent = CalculateOverallProgressPercent_NoLock();

            var started = Math.Min(total, completed + active);
            queueText = total > 0 ? $"{started}/{total}" : string.Empty;
        }

        RunOnUiThread(() =>
        {
            IsDownloading = total > 0 && (completed < total || active > 0);
            QueueProgressText = queueText;
            DownloadProgress = IsDownloading ? overallPercent : 0;
            InstallQueueSummaryText = IsDownloading
                ? $"{active} active  |  {pending} queued"
                : "Idle";
        });
    }

    private void UpsertInstallQueueItem(string modId, Action<InstallQueueItemViewModel> update)
    {
        if (string.IsNullOrWhiteSpace(modId))
            return;

        void Apply()
        {
            if (!_installQueueItemsById.TryGetValue(modId, out var item))
            {
                item = new InstallQueueItemViewModel(modId, CancelInstallRequest);
                _installQueueItemsById[modId] = item;
                _installQueueItems.Add(item);
            }

            update(item);
        }

        if (Dispatcher.UIThread.CheckAccess())
            Apply();
        else
            Dispatcher.UIThread.Post(Apply);
    }

    private void MarkQueueItemFinished(string modId, InstallRunResult result)
    {
        if (string.IsNullOrWhiteSpace(modId))
            return;

        UpsertInstallQueueItem(modId, item =>
        {
            item.Stage = result switch
            {
                InstallRunResult.Success => "Installed",
                InstallRunResult.Cancelled => "Cancelled",
                _ => "Failed",
            };
            item.Progress = result == InstallRunResult.Success ? 100 : item.Progress;
            item.IsActive = false;
            item.CanCancel = false;
        });

        _ = Task.Run(async () =>
        {
            var delayMs = result switch
            {
                InstallRunResult.Success => 1200,
                InstallRunResult.Cancelled => 1700,
                _ => 4000,
            };
            await Task.Delay(delayMs);
            RunOnUiThread(() => RemoveInstallQueueItem(modId));
        });
    }

    private void RemoveInstallQueueItem(string modId)
    {
        lock (_installStateLock)
        {
            _lastProgressUiUpdateByModId.Remove(modId);
            _lastProgressPercentByModId.Remove(modId);
            _lastProgressStageByModId.Remove(modId);
            _cancelRequestedInstallIds.Remove(modId);
        }

        if (!_installQueueItemsById.TryGetValue(modId, out var item))
            return;

        _installQueueItemsById.Remove(modId);
        _installQueueItems.Remove(item);
    }

    private static string CompactInstallStage(string statusMessage)
    {
        if (string.IsNullOrWhiteSpace(statusMessage))
            return "Working";

        if (statusMessage.Contains("queue", StringComparison.OrdinalIgnoreCase))
            return "Queued";

        if (statusMessage.Contains("download", StringComparison.OrdinalIgnoreCase))
            return "Downloading";

        if (statusMessage.Contains("metadata", StringComparison.OrdinalIgnoreCase) ||
            statusMessage.Contains("manifest", StringComparison.OrdinalIgnoreCase))
            return "Preparing metadata";

        if (statusMessage.Contains("install", StringComparison.OrdinalIgnoreCase) ||
            statusMessage.Contains("extract", StringComparison.OrdinalIgnoreCase))
            return "Installing";

        if (statusMessage.Contains("final", StringComparison.OrdinalIgnoreCase) ||
            statusMessage.Contains("validat", StringComparison.OrdinalIgnoreCase))
            return "Finalizing";

        return statusMessage.Length > 36 ? statusMessage[..36] + "..." : statusMessage;
    }

    private async Task RefreshStellarisyncStatusAsync()
    {
        if (Interlocked.Exchange(ref _serviceStatusRefreshGate, 1) == 1)
            return;

        try
        {
            var baseUrl = Environment.GetEnvironmentVariable("STELLARISYNC_BASE_URL");
            if (string.IsNullOrWhiteSpace(baseUrl))
                baseUrl = DefaultStellarisyncBaseUrl;

            using var request = new HttpRequestMessage(HttpMethod.Head, baseUrl);
            using var response = await ServiceStatusHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);

            var isOnline = (int)response.StatusCode < 500;
            RunOnUiThread(() =>
            {
                IsStellarisyncOnline = isOnline;
                StellarisyncConnectionStatus = isOnline ? "Stellarisync online" : "Stellarisync degraded";
            });
        }
        catch
        {
            RunOnUiThread(() =>
            {
                IsStellarisyncOnline = false;
                StellarisyncConnectionStatus = "Stellarisync offline";
            });
        }
        finally
        {
            Interlocked.Exchange(ref _serviceStatusRefreshGate, 0);
        }
    }

    private int CalculateOverallProgressPercent_NoLock()
    {
        if (_installQueueTotal <= 0)
            return 0;

        var activeProgress = _activeProgressByModId.Values
            .Select(v => Math.Clamp(v, 0, 100) / 100.0)
            .Sum();

        var progress = (_installQueueCompleted + activeProgress) / _installQueueTotal;
        return (int)Math.Round(progress * 100, MidpointRounding.AwayFromZero);
    }

    private static void RunOnUiThread(Action action)
    {
        if (Dispatcher.UIThread.CheckAccess())
            action();
        else
            Dispatcher.UIThread.Post(action);
    }

    private void OpenWorkshopUrlInApp(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return;

        RunOnUiThread(() =>
        {
            WorkshopViewModel.RequestNavigateToUrl(url);
            ActiveView = WorkshopViewModel;
            StatusMessage = "Opened workshop page in-app.";
        });
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
        try
        {
            ActiveView = VersionBrowserViewModel;
            await VersionBrowserViewModel.LoadAsync();
        }
        catch (Exception ex)
        {
            StatusMessage = $"By Version failed: {ex.Message}";
            ActiveView = LibraryViewModel;
        }
    }

    [RelayCommand]
    private async Task LaunchGame()
    {
        var gamePath = _settings.GamePath;
        if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
        {
            StatusMessage = "Set a valid game path in Settings first.";
            ActiveView = SettingsViewModel;
            return;
        }

        var wasRunning = IsStellarisRunning(gamePath);
        IsGameRunning = wasRunning;

        if (!await EnsureReadyForLaunchAsync(gamePath))
            return;

        var modsPath = _settings.ModsPath ?? new Core.Services.GameDetector().GetDefaultModsPath();

        try
        {
            var mods = await _db.GetAllModsAsync();
            await _launcherSync.SyncAsync(modsPath, mods);
        }
        catch (Exception ex)
        {
            StatusMessage = $"Could not sync mod load order before launch: {ex.Message}";
            ActiveView = SettingsViewModel;
            return;
        }

        var candidates = new[]
        {
            Path.Combine(gamePath, "stellaris.exe"),
            Path.Combine(gamePath, "Stellaris.exe"),
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
                Arguments = "--skiplauncher",
                UseShellExecute = true,
            });

            StatusMessage = wasRunning
                ? "Restarting Stellaris directly (launcher bypass enabled)..."
                : "Launching Stellaris directly (launcher bypass enabled)...";

            _ = Task.Run(async () =>
            {
                await Task.Delay(1200);
                RunOnUiThread(RefreshGameRunningState);
            });
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
