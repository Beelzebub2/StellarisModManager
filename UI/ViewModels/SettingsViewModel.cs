using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class SettingsViewModel : ViewModelBase
{
    private const int MaxDeveloperLogLines = 500;

    private readonly AppSettings _settings;
    private readonly GameDetector _detector;
    private readonly WorkshopDownloader _downloader;
    private readonly ModDatabase _db;
    private readonly StellarisLauncherSyncService _launcherSync = new();
    private readonly Queue<string> _developerLogLines = new();
    private readonly AppUpdateService _appUpdateService;
    private readonly DispatcherTimer _appUpdateTimer = new() { Interval = TimeSpan.FromHours(24) };

    private bool _isRefreshingRuntimePreference;
    private AppReleaseInfo? _availableAppRelease;

    public event EventHandler<AppReleaseInfo>? UpdateAvailableNotificationRequested;

    [ObservableProperty] private string _gamePath = "";
    [ObservableProperty] private string _modsPath = "";
    [ObservableProperty] private string _steamCmdPath = "";
    [ObservableProperty] private string _steamCmdDownloadPath = "";
    [ObservableProperty] private bool _autoDetectGame = true;
    [ObservableProperty] private string _gameVersion = "";
    [ObservableProperty] private string _selectedPalette = "Obsidian Ember";
    [ObservableProperty] private bool _hasUnsavedChanges = false;
    [ObservableProperty] private string _statusMessage = "";
    [ObservableProperty] private bool _developerMode = false;
    [ObservableProperty] private bool _warnBeforeRestartGame = true;
    [ObservableProperty] private string _developerLogText = "";

    [ObservableProperty] private bool _autoCheckAppUpdates = true;
    [ObservableProperty] private string _appVersion = "";
    [ObservableProperty] private string _appLatestVersion = "";
    [ObservableProperty] private string _appUpdateStep = "Idle";
    [ObservableProperty] private string _appUpdateDetails = "No update check yet.";
    [ObservableProperty] private string _lastAppUpdateCheckText = "Never";
    [ObservableProperty] private int _appUpdateProgressPercent = 0;
    [ObservableProperty] private bool _hasAppUpdateAvailable = false;
    [ObservableProperty] private bool _isCheckingAppUpdates = false;
    [ObservableProperty] private bool _isDownloadingAppUpdate = false;
    [ObservableProperty] private bool _isApplyingAppUpdate = false;
    [ObservableProperty] private bool _isAppUpdateCritical = false;

    public ObservableCollection<string> PaletteOptions { get; } = new();

    public bool IsSteamCmdConfigured => _downloader.IsSteamCmdAvailable(SteamCmdPath);
    public bool IsAppUpdateBusy => IsCheckingAppUpdates || IsDownloadingAppUpdate || IsApplyingAppUpdate;

    public SettingsViewModel(AppSettings settings, GameDetector detector, WorkshopDownloader downloader, ModDatabase db)
    {
        _settings = settings;
        _detector = detector;
        _downloader = downloader;
        _db = db;
        _appUpdateService = new AppUpdateService(settings);

        // Load current settings into VM
        GamePath = settings.GamePath ?? "";
        ModsPath = settings.ModsPath ?? "";
        SteamCmdPath = settings.SteamCmdPath ?? "";
        SteamCmdDownloadPath = settings.SteamCmdDownloadPath ?? "";
        AutoDetectGame = settings.AutoDetectGame;
        DeveloperMode = settings.DeveloperMode;
        WarnBeforeRestartGame = settings.WarnBeforeRestartGame;
        AutoCheckAppUpdates = settings.AutoCheckAppUpdates;
        SelectedPalette = string.IsNullOrWhiteSpace(settings.ThemePalette)
            ? "Obsidian Ember"
            : settings.ThemePalette;

        AppVersion = _appUpdateService.CurrentVersionDisplay;

        foreach (var palette in ThemePaletteService.GetPaletteNames())
            PaletteOptions.Add(palette);

        GameVersion = !string.IsNullOrWhiteSpace(GamePath)
            ? _detector.DetectGameVersion(GamePath) ?? ""
            : "";

        if (!string.IsNullOrWhiteSpace(GameVersion))
            _settings.LastDetectedGameVersion = GameVersion;

        UpdateLastCheckText();
        LoadLastBackgroundUpdateStatus();

        _downloader.LogLine += OnDownloaderLogLine;
        _downloader.ProgressChanged += OnDownloaderProgressChanged;
        _downloader.DownloadComplete += OnDownloaderDownloadComplete;

        _appUpdateTimer.Tick += (_, _) => _ = CheckForAppUpdatesCoreAsync(false);
        RefreshAutoUpdateTimer();
        _ = RunStartupAppUpdateCheckAsync();
    }

    partial void OnGamePathChanged(string value)
    {
        _settings.GamePath = string.IsNullOrWhiteSpace(value) ? null : value;

        HasUnsavedChanges = true;
        GameVersion = Directory.Exists(value)
            ? _detector.DetectGameVersion(value) ?? ""
            : "";

        if (!string.IsNullOrWhiteSpace(GameVersion))
            _settings.LastDetectedGameVersion = GameVersion;
    }

    partial void OnGameVersionChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            _settings.LastDetectedGameVersion = value;
    }

    partial void OnModsPathChanged(string value) => HasUnsavedChanges = true;
    partial void OnSteamCmdPathChanged(string value)
    {
        HasUnsavedChanges = true;
        OnPropertyChanged(nameof(IsSteamCmdConfigured));
    }

    partial void OnSteamCmdDownloadPathChanged(string value) => HasUnsavedChanges = true;
    partial void OnAutoDetectGameChanged(bool value) => HasUnsavedChanges = true;
    partial void OnDeveloperModeChanged(bool value) => HasUnsavedChanges = true;
    partial void OnWarnBeforeRestartGameChanged(bool value)
    {
        if (_isRefreshingRuntimePreference)
            return;

        HasUnsavedChanges = true;
    }

    partial void OnAutoCheckAppUpdatesChanged(bool value)
    {
        HasUnsavedChanges = true;
        RefreshAutoUpdateTimer();
    }

    partial void OnSelectedPaletteChanged(string value) => HasUnsavedChanges = true;
    partial void OnIsCheckingAppUpdatesChanged(bool value) => OnPropertyChanged(nameof(IsAppUpdateBusy));
    partial void OnIsDownloadingAppUpdateChanged(bool value) => OnPropertyChanged(nameof(IsAppUpdateBusy));
    partial void OnIsApplyingAppUpdateChanged(bool value) => OnPropertyChanged(nameof(IsAppUpdateBusy));

    public void RefreshRestartWarningPreference()
    {
        _isRefreshingRuntimePreference = true;
        try
        {
            WarnBeforeRestartGame = _settings.WarnBeforeRestartGame;
        }
        finally
        {
            _isRefreshingRuntimePreference = false;
        }
    }

    [RelayCommand]
    private void ClearDeveloperLogs()
    {
        _developerLogLines.Clear();
        DeveloperLogText = string.Empty;
        StatusMessage = "Developer logs cleared.";
    }

    [RelayCommand]
    private void AutoDetect()
    {
        StatusMessage = "Detecting game installation...";
        try
        {
            var detected = _detector.DetectGamePath();
            if (detected is not null)
            {
                GamePath = detected;
                StatusMessage = $"Detected: {detected}";
            }
            else
            {
                StatusMessage = "Could not auto-detect Stellaris. Please set path manually.";
            }

            if (string.IsNullOrWhiteSpace(ModsPath))
                ModsPath = _detector.GetDefaultModsPath();

            var steamCmd = _detector.DetectSteamCmdPath();
            if (steamCmd is not null)
                SteamCmdPath = steamCmd;

            if (!string.IsNullOrWhiteSpace(GamePath))
            {
                GameVersion = _detector.DetectGameVersion(GamePath) ?? "";
                if (!string.IsNullOrWhiteSpace(GameVersion))
                    _settings.LastDetectedGameVersion = GameVersion;
            }
        }
        catch (Exception ex)
        {
            StatusMessage = $"Detection failed: {ex.Message}";
        }
    }

    public void SetGamePath(string path)
    {
        if (!string.IsNullOrWhiteSpace(path))
            GamePath = path;
    }

    public void SetModsPath(string path)
    {
        if (!string.IsNullOrWhiteSpace(path))
            ModsPath = path;
    }

    public void SetSteamCmdPath(string path)
    {
        if (!string.IsNullOrWhiteSpace(path))
            SteamCmdPath = path;
    }

    public void SetSteamCmdDownloadPath(string path)
    {
        if (!string.IsNullOrWhiteSpace(path))
            SteamCmdDownloadPath = path;
    }

    [RelayCommand]
    private Task BrowseGamePathAsync()
    {
        StatusMessage = "Use the file browser to select the Stellaris game folder.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private Task BrowseModsPathAsync()
    {
        StatusMessage = "Use the file browser to select the Stellaris mods folder.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private Task BrowseSteamCmdPathAsync()
    {
        StatusMessage = "Use the file browser to locate steamcmd.exe.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private async Task DownloadSteamCmdAsync()
    {
        try
        {
            if (_downloader.IsSteamCmdAvailable(SteamCmdPath))
            {
                StatusMessage = "SteamCMD is already installed.";
                return;
            }

            var detectedSteamCmd = _detector.DetectSteamCmdPath();
            if (!string.IsNullOrWhiteSpace(detectedSteamCmd) && File.Exists(detectedSteamCmd))
            {
                SteamCmdPath = detectedSteamCmd;

                if (string.IsNullOrWhiteSpace(SteamCmdDownloadPath))
                {
                    var detectedDir = Path.GetDirectoryName(detectedSteamCmd);
                    if (!string.IsNullOrWhiteSpace(detectedDir))
                        SteamCmdDownloadPath = detectedDir;
                }

                SaveSettings();
                StatusMessage = "SteamCMD is already installed. Using detected path.";
                return;
            }

            StatusMessage = "Downloading SteamCMD...";

            var targetDir = string.IsNullOrWhiteSpace(SteamCmdDownloadPath)
                ? Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "StellarisModManager", "steamcmd")
                : SteamCmdDownloadPath;

            var progress = new Progress<int>(p => StatusMessage = $"Downloading SteamCMD... {p}%");
            var exePath = await _downloader.DownloadSteamCmdAsync(targetDir, progress);
            SteamCmdPath = exePath;
            SteamCmdDownloadPath = targetDir;
            StatusMessage = "SteamCMD downloaded successfully.";
            SaveSettings();
        }
        catch (Exception ex)
        {
            StatusMessage = $"Download failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private void ValidatePaths()
    {
        var errors = 0;

        if (!string.IsNullOrWhiteSpace(GamePath) && !Directory.Exists(GamePath))
        {
            StatusMessage = "Game path does not exist.";
            errors++;
        }

        if (!string.IsNullOrWhiteSpace(ModsPath) && !Directory.Exists(ModsPath))
        {
            try
            {
                Directory.CreateDirectory(ModsPath);
            }
            catch
            {
                StatusMessage = "Mods path does not exist and could not be created.";
                errors++;
            }
        }

        if (!string.IsNullOrWhiteSpace(SteamCmdPath) && !File.Exists(SteamCmdPath))
        {
            StatusMessage = "SteamCMD executable not found at selected path.";
            errors++;
        }

        if (errors == 0)
            StatusMessage = "Paths validated.";
    }

    [RelayCommand]
    private async Task CheckForAppUpdatesAsync()
    {
        await CheckForAppUpdatesCoreAsync(true);
    }

    [RelayCommand]
    private async Task InstallAppUpdateAsync()
    {
        if (_availableAppRelease is null || !HasAppUpdateAvailable)
        {
            AppUpdateDetails = "No pending update to install.";
            return;
        }

        if (IsAppUpdateBusy)
            return;

        IsDownloadingAppUpdate = false;
        IsApplyingAppUpdate = true;
        AppUpdateStep = "Preparing install";
        AppUpdateProgressPercent = 0;
        AppUpdateDetails = $"Starting updater for v{_availableAppRelease.Version}...";

        try
        {
            _appUpdateService.ClearSkippedVersion();

            var started = await StartBackgroundUpdaterAsync(_availableAppRelease);
            if (!started)
            {
                IsApplyingAppUpdate = false;
                AppUpdateStep = "Failed";
                AppUpdateDetails = "Could not start Python updater process.";
                return;
            }

            AppUpdateStep = "Closing app";
            AppUpdateProgressPercent = 5;
            AppUpdateDetails = "Updater is running in background. App will close now.";
            StatusMessage = "Applying app update in background...";

            await Task.Delay(750);
            RequestApplicationShutdown();
        }
        catch (Exception ex)
        {
            IsDownloadingAppUpdate = false;
            IsApplyingAppUpdate = false;
            AppUpdateStep = "Failed";
            AppUpdateDetails = $"Update install failed: {ex.Message}";
            StatusMessage = AppUpdateDetails;
        }
    }

    [RelayCommand]
    private void SkipAppUpdate()
    {
        if (_availableAppRelease is null)
            return;

        _appUpdateService.MarkVersionSkipped(_availableAppRelease.Version);
        HasAppUpdateAvailable = false;
        AppUpdateDetails = $"Skipped v{_availableAppRelease.Version}.";
    }

    [RelayCommand]
    private void SaveSettings()
    {
        _settings.GamePath = string.IsNullOrWhiteSpace(GamePath) ? null : GamePath;
        _settings.ModsPath = string.IsNullOrWhiteSpace(ModsPath) ? null : ModsPath;
        _settings.SteamCmdPath = string.IsNullOrWhiteSpace(SteamCmdPath) ? null : SteamCmdPath;
        _settings.SteamCmdDownloadPath = string.IsNullOrWhiteSpace(SteamCmdDownloadPath) ? null : SteamCmdDownloadPath;
        _settings.AutoDetectGame = AutoDetectGame;
        _settings.DeveloperMode = DeveloperMode;
        _settings.WarnBeforeRestartGame = WarnBeforeRestartGame;
        _settings.AutoCheckAppUpdates = AutoCheckAppUpdates;
        _settings.LastDetectedGameVersion = string.IsNullOrWhiteSpace(GameVersion) ? null : GameVersion;
        _settings.ThemePalette = string.IsNullOrWhiteSpace(SelectedPalette)
            ? "Obsidian Ember"
            : SelectedPalette;

        _settings.Save();
        ThemePaletteService.ApplyPalette(_settings.ThemePalette);
        HasUnsavedChanges = false;
        OnPropertyChanged(nameof(IsSteamCmdConfigured));
        StatusMessage = "Settings saved.";
    }

    [RelayCommand]
    private void ApplyPalette()
    {
        var palette = string.IsNullOrWhiteSpace(SelectedPalette)
            ? "Obsidian Ember"
            : SelectedPalette;

        ThemePaletteService.ApplyPalette(palette);
        StatusMessage = $"Applied palette: {palette}";
    }

    [RelayCommand]
    private async Task LaunchGame()
    {
        if (string.IsNullOrWhiteSpace(GamePath) || !Directory.Exists(GamePath))
        {
            StatusMessage = "Set a valid game path before launching.";
            return;
        }

        var modsPath = string.IsNullOrWhiteSpace(ModsPath)
            ? _detector.GetDefaultModsPath()
            : ModsPath;

        try
        {
            var mods = await _db.GetAllModsAsync();
            await _launcherSync.SyncAsync(modsPath, mods);
        }
        catch (Exception ex)
        {
            StatusMessage = $"Could not sync mod load order before launch: {ex.Message}";
            return;
        }

        var candidates = new[]
        {
            Path.Combine(GamePath, "stellaris.exe"),
            Path.Combine(GamePath, "Stellaris.exe"),
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
            StatusMessage = "Could not find Stellaris executable in the selected path.";
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = Path.GetDirectoryName(executable) ?? GamePath,
                Arguments = "--skiplauncher",
                UseShellExecute = true,
            });

            StatusMessage = "Launching Stellaris directly (launcher bypass enabled)...";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Launch failed: {ex.Message}";
        }
    }

    private async Task CheckForAppUpdatesCoreAsync(bool manual)
    {
        if (IsAppUpdateBusy)
            return;

        IsCheckingAppUpdates = true;
        AppUpdateStep = "Checking";
        AppUpdateDetails = "Checking for app updates...";

        try
        {
            var result = await _appUpdateService.CheckForUpdatesAsync(manual);
            UpdateLastCheckText();

            if (result.Release is null)
            {
                HasAppUpdateAvailable = false;
                AppLatestVersion = string.Empty;
                IsAppUpdateCritical = false;
                AppUpdateStep = "Idle";
                AppUpdateDetails = result.Message;
                if (manual)
                    StatusMessage = result.Message;
                return;
            }

            _availableAppRelease = result.Release;
            AppLatestVersion = $"v{result.Release.Version}";
            IsAppUpdateCritical = result.Release.Critical;

            if (result.IsUpdateAvailable)
            {
                HasAppUpdateAvailable = true;
                AppUpdateStep = "Ready";
                AppUpdateDetails = result.Release.Critical
                    ? $"Critical update available from {result.Release.Source}."
                    : $"Update available from {result.Release.Source}.";
                StatusMessage = result.Message;

                if (!manual)
                {
                    UpdateAvailableNotificationRequested?.Invoke(this, result.Release);
                }
            }
            else
            {
                HasAppUpdateAvailable = false;
                AppUpdateStep = "Idle";
                AppUpdateDetails = result.Message;
                if (manual)
                    StatusMessage = result.Message;
            }
        }
        catch (Exception ex)
        {
            AppUpdateStep = "Failed";
            AppUpdateDetails = $"Update check failed: {ex.Message}";
            if (manual)
                StatusMessage = AppUpdateDetails;
        }
        finally
        {
            IsCheckingAppUpdates = false;
        }
    }

    private void LoadLastBackgroundUpdateStatus()
    {
        var status = AppUpdateStatusStore.TryRead();
        if (status is null)
            return;

        if (status.Success)
        {
            AppUpdateStep = "Completed";
            AppUpdateDetails = status.Message;
            StatusMessage = status.Message;
            HasAppUpdateAvailable = false;
            _availableAppRelease = null;
            AppLatestVersion = string.Empty;
        }
        else if (!string.IsNullOrWhiteSpace(status.Message))
        {
            AppUpdateStep = "Failed";
            AppUpdateDetails = status.Message;
        }
    }

    private void RefreshAutoUpdateTimer()
    {
        if (AutoCheckAppUpdates)
        {
            if (!_appUpdateTimer.IsEnabled)
                _appUpdateTimer.Start();
        }
        else
        {
            if (_appUpdateTimer.IsEnabled)
                _appUpdateTimer.Stop();
        }
    }

    private async Task RunStartupAppUpdateCheckAsync()
    {
        if (!AutoCheckAppUpdates)
            return;

        await Task.Delay(1200);
        await CheckForAppUpdatesCoreAsync(false);
    }

    private bool ShouldRunAutomaticUpdateCheck()
    {
        if (string.IsNullOrWhiteSpace(_settings.LastAppUpdateCheckUtc))
            return true;

        if (!DateTime.TryParse(_settings.LastAppUpdateCheckUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var last))
            return true;

        return DateTime.UtcNow - last.ToUniversalTime() >= TimeSpan.FromHours(24);
    }

    private void UpdateLastCheckText()
    {
        if (string.IsNullOrWhiteSpace(_settings.LastAppUpdateCheckUtc))
        {
            LastAppUpdateCheckText = "Never";
            return;
        }

        if (!DateTime.TryParse(_settings.LastAppUpdateCheckUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
        {
            LastAppUpdateCheckText = "Unknown";
            return;
        }

        LastAppUpdateCheckText = parsed.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    }

    private async Task<bool> StartBackgroundUpdaterAsync(AppReleaseInfo release)
    {
        var currentExe = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(currentExe) || !File.Exists(currentExe))
            return false;

        var appDir = Path.GetDirectoryName(currentExe);
        if (string.IsNullOrWhiteSpace(appDir))
            return false;

        var updaterSourcePath = Path.Combine(appDir, "Updater", "python_updater.py");
        if (!File.Exists(updaterSourcePath))
            updaterSourcePath = Path.Combine(appDir, "python_updater.py");

        if (!File.Exists(updaterSourcePath))
            return false;

        var tempRoot = Path.Combine(
            Path.GetTempPath(),
            "StellarisModManager",
            "updater",
            Guid.NewGuid().ToString("N"));

        var tempUpdaterDir = Path.Combine(tempRoot, "Updater");
        Directory.CreateDirectory(tempUpdaterDir);

        var updaterScriptPath = Path.Combine(tempUpdaterDir, "python_updater.py");
        File.Copy(updaterSourcePath, updaterScriptPath, true);

        var startupSignalPath = Path.Combine(tempRoot, "updater-started.signal");
        if (File.Exists(startupSignalPath))
        {
            try
            {
                File.Delete(startupSignalPath);
            }
            catch
            {
                // Best-effort cleanup of stale signal files.
            }
        }

        AppUpdateStatusStore.Write(new AppUpdateApplyStatus
        {
            Step = "launching",
            Success = false,
            TargetVersion = release.Version,
            Message = $"Starting python updater for v{release.Version}."
        });

        var process = TryStartPythonUpdaterProcess(
            tempRoot,
            updaterScriptPath,
            currentExe,
            release,
            startupSignalPath,
            tempRoot);

        if (process is null)
            return false;

        var started = await WaitForUpdaterStartupSignalAsync(process, startupSignalPath, TimeSpan.FromSeconds(6));
        if (started)
            return true;

        try
        {
            if (!process.HasExited)
                process.Kill(true);
        }
        catch
        {
            // Best-effort process cleanup.
        }

        return false;
    }

    private static Process? TryStartPythonUpdaterProcess(
        string workingDirectory,
        string scriptPath,
        string appExePath,
        AppReleaseInfo release,
        string startupSignalPath,
        string cleanupRoot)
    {
        var parentPid = Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture);

        foreach (var (executable, prefixArgs) in EnumeratePythonLaunchCandidates())
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = executable,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = workingDirectory,
            };

            foreach (var prefixArg in prefixArgs)
                startInfo.ArgumentList.Add(prefixArg);

            startInfo.ArgumentList.Add(scriptPath);
            startInfo.ArgumentList.Add("--apply-update");
            startInfo.ArgumentList.Add("--parent-pid");
            startInfo.ArgumentList.Add(parentPid);
            startInfo.ArgumentList.Add("--app-exe");
            startInfo.ArgumentList.Add(appExePath);
            startInfo.ArgumentList.Add("--download-url");
            startInfo.ArgumentList.Add(release.DownloadUrl);
            startInfo.ArgumentList.Add("--release-url");
            startInfo.ArgumentList.Add(release.ReleaseUrl);
            startInfo.ArgumentList.Add("--target-version");
            startInfo.ArgumentList.Add(release.Version);
            startInfo.ArgumentList.Add("--startup-signal");
            startInfo.ArgumentList.Add(startupSignalPath);
            startInfo.ArgumentList.Add("--cleanup-root");
            startInfo.ArgumentList.Add(cleanupRoot);

            var apiBase = Environment.GetEnvironmentVariable("STELLARISYNC_BASE_URL");
            if (!string.IsNullOrWhiteSpace(apiBase))
            {
                startInfo.ArgumentList.Add("--api-base");
                startInfo.ArgumentList.Add(apiBase);
            }

            try
            {
                var process = Process.Start(startInfo);
                if (process is not null)
                    return process;
            }
            catch
            {
                // Try next Python launcher candidate.
            }
        }

        return null;
    }

    private static IEnumerable<(string Executable, string[] PrefixArgs)> EnumeratePythonLaunchCandidates()
    {
        yield return ("pythonw.exe", Array.Empty<string>());
        yield return ("python.exe", Array.Empty<string>());
        yield return ("py.exe", new[] { "-3" });
        yield return ("py.exe", Array.Empty<string>());
    }

    private static async Task<bool> WaitForUpdaterStartupSignalAsync(Process process, string signalPath, TimeSpan timeout)
    {
        var startedAt = DateTime.UtcNow;

        while (DateTime.UtcNow - startedAt < timeout)
        {
            if (File.Exists(signalPath))
                return true;

            if (process.HasExited)
                return false;

            await Task.Delay(120);
        }

        return File.Exists(signalPath);
    }

    private static void RequestApplicationShutdown()
    {
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.Shutdown();
            return;
        }

        Environment.Exit(0);
    }

    private void OnDownloaderLogLine(object? sender, string line)
    {
        AppendDeveloperLog(line);
    }

    private void OnDownloaderProgressChanged(object? sender, DownloadProgressEventArgs e)
    {
        var mod = string.IsNullOrWhiteSpace(e.ModId) ? "-" : e.ModId;
        AppendDeveloperLog($"[progress:{mod}] {e.StatusMessage}");
    }

    private void OnDownloaderDownloadComplete(object? sender, DownloadCompleteEventArgs e)
    {
        var outcome = e.Success ? "success" : "failed";
        var details = e.Success
            ? e.DownloadedPath ?? "(path unknown)"
            : e.ErrorMessage ?? "(no error details)";

        AppendDeveloperLog($"[complete:{e.ModId}] {outcome} - {details}");
    }

    private void AppendDeveloperLog(string line)
    {
        var entry = $"[{DateTime.Now:HH:mm:ss}] {line}";

        void Update()
        {
            _developerLogLines.Enqueue(entry);
            while (_developerLogLines.Count > MaxDeveloperLogLines)
                _developerLogLines.Dequeue();

            DeveloperLogText = string.Join(Environment.NewLine, _developerLogLines);
        }

        if (Dispatcher.UIThread.CheckAccess())
            Update();
        else
            Dispatcher.UIThread.Post(Update);
    }
}
