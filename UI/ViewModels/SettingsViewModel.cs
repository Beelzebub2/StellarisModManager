using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
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
    private bool _isRefreshingRuntimePreference;

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

    public ObservableCollection<string> PaletteOptions { get; } = new();

    public bool IsSteamCmdConfigured => _downloader.IsSteamCmdAvailable(SteamCmdPath);

    public SettingsViewModel(AppSettings settings, GameDetector detector, WorkshopDownloader downloader, ModDatabase db)
    {
        _settings = settings;
        _detector = detector;
        _downloader = downloader;
        _db = db;

        // Load current settings into VM
        GamePath = settings.GamePath ?? "";
        ModsPath = settings.ModsPath ?? "";
        SteamCmdPath = settings.SteamCmdPath ?? "";
        SteamCmdDownloadPath = settings.SteamCmdDownloadPath ?? "";
        AutoDetectGame = settings.AutoDetectGame;
        DeveloperMode = settings.DeveloperMode;
        WarnBeforeRestartGame = settings.WarnBeforeRestartGame;
        SelectedPalette = string.IsNullOrWhiteSpace(settings.ThemePalette)
            ? "Obsidian Ember"
            : settings.ThemePalette;

        foreach (var palette in ThemePaletteService.GetPaletteNames())
            PaletteOptions.Add(palette);

        GameVersion = !string.IsNullOrWhiteSpace(GamePath)
            ? _detector.DetectGameVersion(GamePath) ?? ""
            : "";

        if (!string.IsNullOrWhiteSpace(GameVersion))
            _settings.LastDetectedGameVersion = GameVersion;

        _downloader.LogLine += OnDownloaderLogLine;
        _downloader.ProgressChanged += OnDownloaderProgressChanged;
        _downloader.DownloadComplete += OnDownloaderDownloadComplete;
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
    partial void OnSelectedPaletteChanged(string value) => HasUnsavedChanges = true;

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
        // Folder picker will be wired in Settings view code-behind (Task 7)
        StatusMessage = "Use the file browser to select the Stellaris game folder.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private Task BrowseModsPathAsync()
    {
        // Folder picker will be wired in Settings view code-behind (Task 7)
        StatusMessage = "Use the file browser to select the Stellaris mods folder.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private Task BrowseSteamCmdPathAsync()
    {
        // File picker will be wired in Settings view code-behind (Task 7)
        StatusMessage = "Use the file browser to locate steamcmd.exe.";
        return Task.CompletedTask;
    }

    [RelayCommand]
    private async Task DownloadSteamCmdAsync()
    {
        StatusMessage = "Downloading SteamCMD...";
        try
        {
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
        {
            StatusMessage = "Paths validated.";
        }
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
