using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Serilog;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class LibraryViewModel : ViewModelBase
{
    private static readonly Serilog.ILogger _log = Log.ForContext<LibraryViewModel>();
    private static readonly HttpClient _stellarisyncHttp = new() { Timeout = TimeSpan.FromSeconds(20) };
    private const string StellarisyncBaseUrl = "https://stellarisync.rrmtools.uk";

    private bool _isLoadingProfiles;
    private bool _isApplyingProfileSelection;
    private int? _currentActiveProfileId;

    private readonly ModDatabase _db;
    private readonly ModUpdateChecker _updateChecker;
    private readonly ModInstaller _installer;
    private readonly WorkshopDownloader _downloader;
    private readonly AppSettings _settings;
    private readonly ModExportImport _exportImport;
    private readonly StellarisLauncherSyncService _launcherSync;

    // All installed mods
    public ObservableCollection<ModViewModel> Mods { get; } = new();

    // Filtered/displayed mods
    public ObservableCollection<ModViewModel> FilteredMods { get; } = new();

    // Filter options
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private bool _showEnabledOnly = false;

    // Selected mod for detail panel
    [ObservableProperty] private ModViewModel? _selectedMod;

    // Profiles
    public ObservableCollection<ModProfile> Profiles { get; } = new();
    [ObservableProperty] private ModProfile? _activeProfile;
    [ObservableProperty] private string _profileNameDraft = string.Empty;
    [ObservableProperty] private string _sharedProfileId = string.Empty;
    [ObservableProperty] private bool _isRenamingProfile;

    // Status
    [ObservableProperty] private string _statusMessage = "";
    [ObservableProperty] private bool _isCheckingUpdates = false;
    [ObservableProperty] private int _updatesAvailable = 0;
    public bool HasUpdatesAvailable => UpdatesAvailable > 0;

    public event EventHandler<string>? ShareIdCopiedRequested;

    // Status bar computed values
    public int TotalMods => Mods.Count;
    public int ActiveMods => Mods.Count(m => m.IsEnabled);

    public LibraryViewModel(
        ModDatabase db,
        ModUpdateChecker updateChecker,
        ModInstaller installer,
        WorkshopDownloader downloader,
        AppSettings settings)
    {
        _db = db;
        _updateChecker = updateChecker;
        _installer = installer;
        _downloader = downloader;
        _settings = settings;
        _exportImport = new ModExportImport();
        _launcherSync = new StellarisLauncherSyncService();
    }

    partial void OnUpdatesAvailableChanged(int value) => OnPropertyChanged(nameof(HasUpdatesAvailable));
    partial void OnActiveProfileChanged(ModProfile? value)
    {
        if (value is null)
        {
            if (!_isLoadingProfiles && !_isApplyingProfileSelection)
            {
                if (_currentActiveProfileId.HasValue)
                {
                    var fallback = Profiles.FirstOrDefault(p => p.Id == _currentActiveProfileId.Value);
                    if (fallback is not null)
                    {
                        ActiveProfile = fallback;
                        return;
                    }
                }

                ProfileNameDraft = string.Empty;
            }

            IsRenamingProfile = false;
            return;
        }

        ProfileNameDraft = value.Name;
        IsRenamingProfile = false;

        if (_isLoadingProfiles || _isApplyingProfileSelection)
            return;

        if (_currentActiveProfileId.HasValue && value.Id == _currentActiveProfileId.Value)
            return;

        _ = ActivateProfileBySelectionAsync(value);
    }

    private async Task ActivateProfileBySelectionAsync(ModProfile profile)
    {
        _isApplyingProfileSelection = true;
        try
        {
            await SaveCurrentlyActiveProfileBeforeSwitchAsync(profile.Id);
            await _db.ActivateProfileAsync(profile.Id);
            _currentActiveProfileId = profile.Id;
            await LoadModsAsync();

            // Rebind to the refreshed collection instance so ComboBox selection stays stable.
            var refreshed = Profiles.FirstOrDefault(p => p.Id == profile.Id);
            if (refreshed is not null && !ReferenceEquals(ActiveProfile, refreshed))
                ActiveProfile = refreshed;

            StatusMessage = $"Activated profile: {profile.Name}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Failed to activate profile: {ex.Message}";
        }
        finally
        {
            _isApplyingProfileSelection = false;
        }
    }

    partial void OnSearchTextChanged(string value) => ApplyFilter();
    partial void OnShowEnabledOnlyChanged(bool value) => ApplyFilter();

    private void ApplyFilter()
    {
        FilteredMods.Clear();

        var filtered = Mods.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            var lower = SearchText.ToLowerInvariant();
            filtered = filtered.Where(m =>
                m.Name.ToLowerInvariant().Contains(lower) ||
                m.WorkshopId.Contains(lower));
        }

        if (ShowEnabledOnly)
            filtered = filtered.Where(m => m.IsEnabled);

        foreach (var mod in filtered.OrderBy(m => m.LoadOrder).ThenBy(m => m.Name))
            FilteredMods.Add(mod);

        OnPropertyChanged(nameof(TotalMods));
        OnPropertyChanged(nameof(ActiveMods));
    }

    private List<ModViewModel> GetLoadOrderSortedMods()
    {
        return Mods.OrderBy(m => m.LoadOrder).ThenBy(m => m.Name).ToList();
    }

    private async Task SaveProfileSnapshotIfActiveAsync()
    {
        if (_currentActiveProfileId is null)
            return;

        await SaveCurrentStateToProfileAsync(_currentActiveProfileId.Value);
    }

    private async Task SaveCurrentStateToProfileAsync(int profileId)
    {
        var snapshot = GetLoadOrderSortedMods()
            .Select((m, i) => (m.Model.Id, m.IsEnabled, i))
            .ToList();

        await _db.SaveProfileEntriesAsync(profileId, snapshot);
    }

    private async Task SaveCurrentlyActiveProfileBeforeSwitchAsync(int? targetProfileId = null)
    {
        if (_currentActiveProfileId is null)
            return;

        if (targetProfileId.HasValue && _currentActiveProfileId.Value == targetProfileId.Value)
            return;

        await SaveCurrentStateToProfileAsync(_currentActiveProfileId.Value);
    }

    private async Task PersistEnabledStateAsync(ModViewModel mod)
    {
        await _db.SetModEnabledAsync(mod.Model.Id, mod.IsEnabled);
        await SaveProfileSnapshotIfActiveAsync();
        await SyncLauncherStateAsync();
        OnPropertyChanged(nameof(ActiveMods));
    }

    // Load order drag-drop support
    [RelayCommand]
    private void MoveModUp(ModViewModel mod)
    {
        var ordered = GetLoadOrderSortedMods();
        var idx = ordered.IndexOf(mod);
        if (idx <= 0) return;

        var prev = ordered[idx - 1];
        (mod.LoadOrder, prev.LoadOrder) = (prev.LoadOrder, mod.LoadOrder);
        ApplyFilter();
        _ = SaveLoadOrderAsync();
    }

    [RelayCommand]
    private void MoveModDown(ModViewModel mod)
    {
        var ordered = GetLoadOrderSortedMods();
        var idx = ordered.IndexOf(mod);
        if (idx < 0 || idx >= ordered.Count - 1) return;

        var next = ordered[idx + 1];
        (mod.LoadOrder, next.LoadOrder) = (next.LoadOrder, mod.LoadOrder);
        ApplyFilter();
        _ = SaveLoadOrderAsync();
    }

    private async Task SaveLoadOrderAsync()
    {
        var ordered = GetLoadOrderSortedMods();
        for (var i = 0; i < ordered.Count; i++)
            ordered[i].LoadOrder = i;

        var updates = ordered
            .Select((m, i) => (m.Model.Id, i))
            .ToList();

        await _db.UpdateLoadOrderAsync(updates);
        await SaveProfileSnapshotIfActiveAsync();
        await SyncLauncherStateAsync();
    }

    private string ResolveModsPath()
    {
        if (!string.IsNullOrWhiteSpace(_settings.ModsPath))
            return _settings.ModsPath;

        return new GameDetector().GetDefaultModsPath();
    }

    private async Task SyncLauncherStateAsync()
    {
        try
        {
            var modsPath = ResolveModsPath();
            var models = Mods.Select(m => m.Model).ToList();
            await _launcherSync.SyncAsync(modsPath, models);
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "Failed to sync Stellaris launcher mod state");
        }
    }

    [RelayCommand]
    private async Task CheckForUpdatesAsync()
    {
        if (IsCheckingUpdates) return;

        IsCheckingUpdates = true;
        StatusMessage = "Checking for updates...";

        try
        {
            var mods = Mods.Select(m => m.Model).ToList();
            var updates = await _updateChecker.CheckForUpdatesAsync(mods);

            // Reset all update flags
            foreach (var mod in Mods)
                mod.HasUpdate = false;

            // Apply update flags
            foreach (var update in updates)
            {
                var modVm = Mods.FirstOrDefault(m => m.WorkshopId == update.Mod.SteamWorkshopId);
                if (modVm is not null)
                    modVm.HasUpdate = true;
            }

            UpdatesAvailable = updates.Count;
            StatusMessage = updates.Count > 0
                ? $"{updates.Count} update(s) available"
                : "All mods are up to date";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Update check failed: {ex.Message}";
        }
        finally
        {
            IsCheckingUpdates = false;
        }
    }

    [RelayCommand]
    private async Task UpdateModAsync(ModViewModel mod)
    {
        if (string.IsNullOrWhiteSpace(_settings.SteamCmdPath) ||
            !_downloader.IsSteamCmdAvailable(_settings.SteamCmdPath))
        {
            StatusMessage = "SteamCMD not configured. Set it in Settings first.";
            return;
        }

        var modsPath = _settings.ModsPath;
        if (string.IsNullOrWhiteSpace(modsPath))
            modsPath = new GameDetector().GetDefaultModsPath();

        var downloadBasePath = _settings.SteamCmdDownloadPath;
        if (string.IsNullOrWhiteSpace(downloadBasePath))
            downloadBasePath = Path.GetDirectoryName(_settings.SteamCmdPath) ?? modsPath;

        StatusMessage = $"Updating {mod.Name}...";

        try
        {
            var downloadedPath = await _downloader.DownloadModAsync(
                mod.WorkshopId,
                _settings.SteamCmdPath,
                downloadBasePath);

            if (downloadedPath is null)
            {
                StatusMessage = $"Update failed for {mod.Name}";
                return;
            }

            var modInfo = await _downloader.GetModInfoAsync(mod.WorkshopId);
            var updated = await _installer.InstallModAsync(mod.WorkshopId, downloadedPath, modsPath, modInfo);

            updated.Id = mod.Model.Id;
            updated.IsEnabled = mod.IsEnabled;
            updated.LoadOrder = mod.LoadOrder;
            updated.InstalledAt = mod.Model.InstalledAt;

            await _db.UpdateModAsync(updated);
            await LoadModsAsync();

            SelectedMod = FilteredMods.FirstOrDefault(m => m.WorkshopId == mod.WorkshopId);
            StatusMessage = $"Updated {updated.Name}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Update failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task UninstallModAsync(ModViewModel mod)
    {
        await UninstallModCoreAsync(mod);
    }

    public IReadOnlyList<string> GetInstalledWorkshopIds()
    {
        return Mods
            .Select(m => m.WorkshopId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    public async Task<bool> UninstallByWorkshopIdAsync(string workshopId)
    {
        var mod = Mods.FirstOrDefault(m => string.Equals(m.WorkshopId, workshopId, StringComparison.Ordinal));
        if (mod is null)
            return false;

        await UninstallModCoreAsync(mod);
        return true;
    }

    private async Task UninstallModCoreAsync(ModViewModel mod)
    {
        StatusMessage = $"Uninstalling {mod.Name}...";
        try
        {
            await _installer.UninstallModAsync(mod.Model);
            await _db.DeleteModAsync(mod.Model.Id);
            Mods.Remove(mod);
            ApplyFilter();
            await SaveProfileSnapshotIfActiveAsync();
            await SyncLauncherStateAsync();
            StatusMessage = $"{mod.Name} uninstalled";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Uninstall failed: {ex.Message}. Close Stellaris/Paradox Launcher or cloud sync tools and retry.";
        }
    }

    [RelayCommand]
    private async Task ExportModListAsync()
    {
        // File dialog will be implemented in the View code-behind (Task 6)
        // This placeholder writes to a default path
        try
        {
            var mods = Mods.Select(m => m.Model).ToList();
            var defaultPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "stellaris-mods-export.json");
            await _exportImport.ExportModListAsync(mods, defaultPath);
            StatusMessage = $"Exported to {defaultPath}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Export failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task ImportModListAsync()
    {
        // File dialog will be implemented in the View code-behind (Task 6)
        StatusMessage = "Import: use Settings to configure mod list import path";
        await Task.CompletedTask;
    }

    [RelayCommand]
    private async Task CreateProfileAsync()
    {
        var name = Profiles.Count == 0 ? "Default" : $"Profile {Profiles.Count + 1}";

        // Preserve current active profile before activating a new empty one.
        await SaveCurrentlyActiveProfileBeforeSwitchAsync();

        var profile = await _db.CreateProfileAsync(name);
        Profiles.Add(profile);

        // New profiles start empty; activating one clears enabled mods in the live list.
        await _db.ActivateProfileAsync(profile.Id);
        _currentActiveProfileId = profile.Id;
        ActiveProfile = profile;
        await LoadModsAsync();
        StatusMessage = $"Created empty profile: {name}";
    }

    [RelayCommand]
    private async Task RenameProfileAsync(ModProfile? profile)
    {
        if (profile is null)
        {
            StatusMessage = "Select a profile to rename.";
            return;
        }

        var newName = ProfileNameDraft.Trim();
        if (string.IsNullOrWhiteSpace(newName))
        {
            StatusMessage = "Profile name cannot be empty.";
            return;
        }

        var duplicate = Profiles.Any(p => p.Id != profile.Id &&
            string.Equals(p.Name, newName, StringComparison.OrdinalIgnoreCase));
        if (duplicate)
        {
            StatusMessage = $"A profile named '{newName}' already exists.";
            return;
        }

        await _db.RenameProfileAsync(profile.Id, newName);
        profile.Name = newName;

        var idx = Profiles.IndexOf(profile);
        if (idx >= 0)
        {
            Profiles.RemoveAt(idx);
            Profiles.Insert(idx, profile);
            ActiveProfile = profile;
        }

        IsRenamingProfile = false;
        StatusMessage = $"Renamed profile to: {newName}";
    }

    [RelayCommand]
    private void BeginRenameProfile()
    {
        if (ActiveProfile is null)
        {
            StatusMessage = "Select a profile to rename.";
            return;
        }

        ProfileNameDraft = ActiveProfile.Name;
        IsRenamingProfile = true;
    }

    [RelayCommand]
    private async Task ShareProfileAsync(ModProfile? profile)
    {
        if (profile is null)
        {
            StatusMessage = "Select a profile to share.";
            return;
        }

        if (_currentActiveProfileId == profile.Id)
            await SaveCurrentStateToProfileAsync(profile.Id);

        if (!string.IsNullOrWhiteSpace(profile.SharedProfileId))
        {
            ShareIdCopiedRequested?.Invoke(this, profile.SharedProfileId);
            StatusMessage = $"Copied existing profile ID: {profile.SharedProfileId}";
            return;
        }

        var workshopIds = await _db.GetEnabledWorkshopIdsForProfileAsync(profile.Id);
        if (workshopIds.Count == 0)
        {
            StatusMessage = "Cannot share an empty profile. Enable mods first.";
            return;
        }

        var baseUrl = Environment.GetEnvironmentVariable("STELLARISYNC_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = StellarisyncBaseUrl;

        var requestUrl = $"{baseUrl.TrimEnd('/')}/profiles";
        var payload = JsonSerializer.Serialize(new
        {
            name = profile.Name,
            creator = Environment.UserName,
            mods = workshopIds,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, requestUrl)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };

        var apiKey = Environment.GetEnvironmentVariable("STELLARISYNC_API_KEY");
        if (!string.IsNullOrWhiteSpace(apiKey))
            request.Headers.TryAddWithoutValidation("X-Stellarisync-Key", apiKey);

        try
        {
            using var response = await _stellarisyncHttp.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                StatusMessage = $"Share failed ({(int)response.StatusCode}): {responseBody}";
                return;
            }

            using var doc = JsonDocument.Parse(responseBody);
            var id = doc.RootElement.TryGetProperty("id", out var idEl)
                ? idEl.GetString()
                : null;

            if (string.IsNullOrWhiteSpace(id))
            {
                StatusMessage = "Profile shared, but response did not include an ID.";
                return;
            }

            await _db.SetProfileSharedIdAsync(profile.Id, id);
            profile.SharedProfileId = id;
            ShareIdCopiedRequested?.Invoke(this, id);
            StatusMessage = $"Shared profile '{profile.Name}'. ID copied: {id}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Share failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task UseSharedProfileIdAsync()
    {
        var id = SharedProfileId.Trim();
        if (string.IsNullOrWhiteSpace(id))
        {
            StatusMessage = "Enter a shared profile ID first.";
            return;
        }

        var baseUrl = Environment.GetEnvironmentVariable("STELLARISYNC_BASE_URL");
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = StellarisyncBaseUrl;

        var url = $"{baseUrl.TrimEnd('/')}/profiles/{Uri.EscapeDataString(id)}/sync-check";
        var installed = Mods
            .Select(m => m.WorkshopId)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        var payload = JsonSerializer.Serialize(new { installedMods = installed });

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };

            using var response = await _stellarisyncHttp.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                StatusMessage = $"Profile ID check failed ({(int)response.StatusCode}): {body}";
                return;
            }

            using var doc = JsonDocument.Parse(body);
            var prompt = doc.RootElement.TryGetProperty("prompt", out var promptEl) ? promptEl.GetString() : null;
            var shouldPromptInstall = doc.RootElement.TryGetProperty("shouldPromptInstall", out var installEl) && installEl.GetBoolean();
            var profileName = doc.RootElement.TryGetProperty("profileName", out var nameEl) ? nameEl.GetString() : id;

            if (shouldPromptInstall)
            {
                if (!string.IsNullOrWhiteSpace(prompt))
                {
                    StatusMessage = prompt;
                    return;
                }

                var missing = doc.RootElement.TryGetProperty("missingMods", out var missingEl) && missingEl.ValueKind == JsonValueKind.Array
                    ? missingEl.GetArrayLength()
                    : 0;
                StatusMessage = $"Profile '{profileName}' has {missing} missing mod(s).";
                return;
            }

            StatusMessage = $"Profile '{profileName}' matches your installed mods.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Profile ID check failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task DeleteProfileAsync(ModProfile? profile)
    {
        if (profile is null)
        {
            StatusMessage = "Select a profile to delete.";
            return;
        }

        await _db.DeleteProfileAsync(profile.Id);
        Profiles.Remove(profile);
        if (ActiveProfile?.Id == profile.Id)
        {
            ActiveProfile = null;
            _currentActiveProfileId = null;
        }

        StatusMessage = $"Deleted profile: {profile.Name}";
    }

    [RelayCommand]
    private async Task ActivateProfileAsync(ModProfile? profile)
    {
        if (profile is null)
        {
            StatusMessage = "Select a profile to activate.";
            return;
        }

        await ActivateProfileBySelectionAsync(profile);
    }

    // Load mods from DB
    public async Task LoadModsAsync()
    {
        Mods.Clear();
        FilteredMods.Clear();

        var duplicatesRemoved = await _db.NormalizeDuplicateWorkshopModsAsync();

        var mods = await _db.GetAllModsAsync();
        foreach (var mod in mods)
        {
            var vm = new ModViewModel(mod, _db);
            vm.PropertyChanged += OnModPropertyChanged;
            Mods.Add(vm);
        }

        var profiles = await _db.GetProfilesAsync();

        if (profiles.Count == 0)
        {
            var defaultProfile = await _db.CreateProfileAsync("Default");
            await SaveCurrentStateToProfileAsync(defaultProfile.Id);
            await _db.ActivateProfileAsync(defaultProfile.Id);
            profiles = await _db.GetProfilesAsync();
        }

        _isLoadingProfiles = true;

        Profiles.Clear();
        foreach (var p in profiles)
            Profiles.Add(p);

        var preferredActiveProfileId = ActiveProfile?.Id ?? _currentActiveProfileId;
        var activeByTrackedId = preferredActiveProfileId.HasValue
            ? profiles.FirstOrDefault(p => p.Id == preferredActiveProfileId.Value)
            : null;
        var resolvedActive = activeByTrackedId ?? profiles.FirstOrDefault(p => p.IsActive) ?? profiles.FirstOrDefault();
        _currentActiveProfileId = resolvedActive?.Id;
        ActiveProfile = resolvedActive;
        _isLoadingProfiles = false;

        ApplyFilter();
        _ = Task.Run(SyncLauncherStateAsync);

        if (duplicatesRemoved > 0)
            StatusMessage = $"Detected and merged {duplicatesRemoved} duplicate mod record(s).";
    }

    // Called when a new mod is installed
    public async Task RefreshAsync()
    {
        await LoadModsAsync();
    }

    private async void OnModPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is not ModViewModel mod)
            return;

        if (e.PropertyName == nameof(ModViewModel.IsEnabled))
            await PersistEnabledStateAsync(mod);
    }

    // Opens the Steam Workshop page for the given mod in the system browser
    [RelayCommand]
    private void OpenWorkshopPage(ModViewModel mod)
    {
        var url = mod.WorkshopUrl;
        if (string.IsNullOrWhiteSpace(url)) return;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            StatusMessage = $"Could not open browser: {ex.Message}";
        }
    }

    // Export with an explicit file path (called from code-behind after file dialog)
    public async Task ExportModListToPathAsync(string filePath)
    {
        try
        {
            var mods = Mods.Select(m => m.Model).ToList();
            await _exportImport.ExportModListAsync(mods, filePath);
            StatusMessage = $"Exported {mods.Count} mods to {Path.GetFileName(filePath)}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Export failed: {ex.Message}";
        }
    }

    // Import with an explicit file path (called from code-behind after file dialog)
    public async Task ImportModListFromPathAsync(string filePath)
    {
        try
        {
            var import = await _exportImport.ImportModListFullAsync(filePath);
            var byId = import.Mods
                .Where(m => !string.IsNullOrWhiteSpace(m.WorkshopId))
                .ToDictionary(m => m.WorkshopId, StringComparer.OrdinalIgnoreCase);

            var matched = 0;
            var loadOrderUpdates = new List<(int modId, int order)>();

            foreach (var vm in Mods)
            {
                if (!byId.TryGetValue(vm.WorkshopId, out var imported))
                    continue;

                matched++;
                vm.IsEnabled = imported.IsEnabled;
                vm.LoadOrder = imported.LoadOrder;
                loadOrderUpdates.Add((vm.Model.Id, imported.LoadOrder));
                await _db.SetModEnabledAsync(vm.Model.Id, imported.IsEnabled);
            }

            if (loadOrderUpdates.Count > 0)
                await _db.UpdateLoadOrderAsync(loadOrderUpdates);

            await SaveProfileSnapshotIfActiveAsync();
            await SyncLauncherStateAsync();
            ApplyFilter();

            var missing = byId.Count - matched;
            StatusMessage = $"Imported list: matched {matched}, missing {missing}.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Import failed: {ex.Message}";
        }
    }
}
