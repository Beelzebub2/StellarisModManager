using System;
using System.IO;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class SettingsViewModel : ViewModelBase
{
    private readonly AppSettings _settings;
    private readonly GameDetector _detector;
    private readonly WorkshopDownloader _downloader;

    [ObservableProperty] private string _gamePath = "";
    [ObservableProperty] private string _modsPath = "";
    [ObservableProperty] private string _steamCmdPath = "";
    [ObservableProperty] private string _steamCmdDownloadPath = "";
    [ObservableProperty] private bool _autoDetectGame = true;
    [ObservableProperty] private string _statusMessage = "";

    public SettingsViewModel(AppSettings settings, GameDetector detector, WorkshopDownloader downloader)
    {
        _settings = settings;
        _detector = detector;
        _downloader = downloader;

        // Load current settings into VM
        GamePath = settings.GamePath ?? "";
        ModsPath = settings.ModsPath ?? "";
        SteamCmdPath = settings.SteamCmdPath ?? "";
        SteamCmdDownloadPath = settings.SteamCmdDownloadPath ?? "";
        AutoDetectGame = settings.AutoDetectGame;
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
        }
        catch (Exception ex)
        {
            StatusMessage = $"Detection failed: {ex.Message}";
        }
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
    private void SaveSettings()
    {
        _settings.GamePath = string.IsNullOrWhiteSpace(GamePath) ? null : GamePath;
        _settings.ModsPath = string.IsNullOrWhiteSpace(ModsPath) ? null : ModsPath;
        _settings.SteamCmdPath = string.IsNullOrWhiteSpace(SteamCmdPath) ? null : SteamCmdPath;
        _settings.SteamCmdDownloadPath = string.IsNullOrWhiteSpace(SteamCmdDownloadPath) ? null : SteamCmdDownloadPath;
        _settings.AutoDetectGame = AutoDetectGame;
        _settings.Save();
        StatusMessage = "Settings saved.";
    }
}
