using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Serilog;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Services;
using StellarisModManager.Core.Utils;

namespace StellarisModManager.UI.ViewModels;

public partial class LibraryViewModel : ViewModelBase
{
    private sealed class SharedProfileSyncContext
    {
        public required int LocalProfileId { get; init; }
        public required string LocalProfileName { get; init; }
        public required List<string> OrderedWorkshopIds { get; init; }
        public required HashSet<string> WorkshopIdSet { get; init; }
    }

    private static readonly Regex VersionTokenPattern = new(@"(?<!\d)\d+\.\d+(?:\.\d+)?(?!\d)", RegexOptions.Compiled);
    private static readonly Serilog.ILogger _log = Log.ForContext<LibraryViewModel>();
    private static readonly HttpClient _stellarisyncHttp = new() { Timeout = TimeSpan.FromSeconds(20) };
    private const string StellarisyncBaseUrl = "https://stellarisync.rrmtools.uk";

    private bool _isLoadingProfiles;
    private bool _isApplyingProfileSelection;
    private int? _currentActiveProfileId;
    private SharedProfileSyncContext? _sharedProfileSyncContext;

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
    [ObservableProperty] private bool _isSubmittingCompatibilityReport = false;
    [ObservableProperty] private string _compatibilityReportSummary = "";
    [ObservableProperty] private int _updatesAvailable = 0;
    public bool HasUpdatesAvailable => UpdatesAvailable > 0;
    public bool CanSubmitCompatibilityReport => SelectedMod is not null && !IsSubmittingCompatibilityReport;

    public event EventHandler<string>? ShareIdCopiedRequested;
    public event EventHandler<string>? OpenWorkshopInAppRequested;
    public Func<string, Task<bool>>? RequestSharedProfileInstallConfirmationAsync { get; set; }
    public Func<IReadOnlyList<string>, Task>? QueueSharedProfileMissingModsAsync { get; set; }

    // Status bar computed values
    public int TotalMods => Mods.Count;
    public int ActiveMods => Mods.Count(m => m.IsEnabled);
    public bool CanDeleteProfiles => Profiles.Count > 1;

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
        if (_sharedProfileSyncContext is not null && (value is null || value.Id != _sharedProfileSyncContext.LocalProfileId))
            _sharedProfileSyncContext = null;

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
    partial void OnSelectedModChanged(ModViewModel? value)
    {
        OnPropertyChanged(nameof(CanSubmitCompatibilityReport));

        if (value is null)
        {
            CompatibilityReportSummary = string.Empty;
            return;
        }

        RefreshCompatibilityReportSummary(value);

        if (value.Model.TotalSubscribers is > 0)
            return;

        _ = HydrateSubscribersAsync(value);
    }

    partial void OnIsSubmittingCompatibilityReportChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSubmitCompatibilityReport));
    }

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

    private async Task HydrateSubscribersAsync(ModViewModel mod)
    {
        try
        {
            var info = await _downloader.GetModInfoAsync(mod.WorkshopId);
            if (info?.TotalSubscribers is not > 0)
                return;

            mod.SetTotalSubscribers(info.TotalSubscribers);
            mod.Model.LastUpdatedAt = DateTime.UtcNow;
            await _db.UpdateModAsync(mod.Model);
        }
        catch
        {
            // Best-effort metadata enrichment for the details panel.
        }
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
        var selectedRuntime = _settings.WorkshopDownloadRuntime;

        if (selectedRuntime == WorkshopDownloadRuntime.SteamCmd &&
            (string.IsNullOrWhiteSpace(_settings.SteamCmdPath) ||
             !_downloader.IsSteamCmdAvailable(_settings.SteamCmdPath)))
        {
            StatusMessage = "SteamCMD runtime selected, but steamcmd.exe is not configured. Set it in Settings first.";
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
                downloadBasePath,
                selectedRuntime);

            if (downloadedPath is null)
            {
                var hasFailureReason = _downloader.TryGetLastFailureReason(mod.WorkshopId, out var failureReason);
                StatusMessage = hasFailureReason
                    ? $"Update failed for {mod.Name}: {failureReason}"
                    : $"Update failed for {mod.Name}";
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

        return await UninstallModCoreAsync(mod);
    }

    private async Task<bool> UninstallModCoreAsync(ModViewModel mod)
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
            return true;
        }
        catch (Exception ex)
        {
            StatusMessage = $"Uninstall failed: {ex.Message}. Close Stellaris/Paradox Launcher or cloud sync tools and retry.";
            return false;
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
        OnPropertyChanged(nameof(CanDeleteProfiles));
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

        try
        {
            var (remoteProfileName, profileWorkshopIds) = await FetchSharedProfileDefinitionAsync(baseUrl, id);
            if (profileWorkshopIds.Count == 0)
            {
                StatusMessage = $"Profile '{remoteProfileName}' has no mods to sync.";
                return;
            }

            var desiredSet = new HashSet<string>(profileWorkshopIds, StringComparer.Ordinal);
            var installedSet = new HashSet<string>(
                Mods.Select(m => m.WorkshopId)
                    .Where(x => !string.IsNullOrWhiteSpace(x)),
                StringComparer.Ordinal);

            var missingMods = profileWorkshopIds
                .Where(workshopId => !installedSet.Contains(workshopId))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            var shouldQueueMissing = false;
            if (missingMods.Count > 0)
            {
                var promptMessage =
                    $"Profile '{remoteProfileName}' is not fully synced on this PC. " +
                    $"Queue {missingMods.Count} missing mod(s) now?";

                if (RequestSharedProfileInstallConfirmationAsync is null)
                {
                    StatusMessage = promptMessage;
                    return;
                }

                shouldQueueMissing = await RequestSharedProfileInstallConfirmationAsync(promptMessage);
            }

            var localProfile = await CreateAndActivateSharedSyncProfileAsync(remoteProfileName, id, profileWorkshopIds, desiredSet);

            if (missingMods.Count == 0)
            {
                StatusMessage = $"Profile synced: created '{localProfile.Name}' with {desiredSet.Count} mod(s).";
                return;
            }

            if (!shouldQueueMissing)
            {
                StatusMessage =
                    $"Profile synced as '{localProfile.Name}'. " +
                    $"{missingMods.Count} mod(s) are still missing and can be installed later.";
                return;
            }

            if (QueueSharedProfileMissingModsAsync is null)
            {
                StatusMessage =
                    $"Profile synced as '{localProfile.Name}', but install queue is unavailable right now.";
                return;
            }

            await QueueSharedProfileMissingModsAsync(missingMods);
            StatusMessage =
                $"Syncing profile '{localProfile.Name}': queued {missingMods.Count} missing mod(s).";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Profile sync failed: {ex.Message}";
        }
    }

    public async Task TryUpdateSharedSyncProfileAfterInstallAsync(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        var context = _sharedProfileSyncContext;
        if (context is null)
            return;

        if (_currentActiveProfileId != context.LocalProfileId)
            return;

        if (!context.WorkshopIdSet.Contains(workshopId))
            return;

        await ApplySharedSyncProfileStateAsync(context.LocalProfileId, context.OrderedWorkshopIds, context.WorkshopIdSet, context.LocalProfileName);
    }

    private async Task<(string ProfileName, List<string> WorkshopIds)> FetchSharedProfileDefinitionAsync(string baseUrl, string sharedProfileId)
    {
        var profileUrl = $"{baseUrl.TrimEnd('/')}/profiles/{Uri.EscapeDataString(sharedProfileId)}";
        using var response = await _stellarisyncHttp.GetAsync(profileUrl);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Shared profile lookup failed ({(int)response.StatusCode}): {body}");

        using var doc = JsonDocument.Parse(body);
        var profileName = doc.RootElement.TryGetProperty("name", out var nameEl)
            ? nameEl.GetString()
            : null;

        var workshopIds = new List<string>();
        if (doc.RootElement.TryGetProperty("mods", out var modsEl) && modsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var modEl in modsEl.EnumerateArray())
            {
                var workshopId = modEl.ValueKind switch
                {
                    JsonValueKind.String => modEl.GetString(),
                    JsonValueKind.Number => modEl.GetRawText(),
                    _ => null,
                };

                workshopId = workshopId?.Trim();
                if (!string.IsNullOrWhiteSpace(workshopId))
                    workshopIds.Add(workshopId);
            }
        }

        if (workshopIds.Count > 1)
            workshopIds = workshopIds.Distinct(StringComparer.Ordinal).ToList();

        return (string.IsNullOrWhiteSpace(profileName) ? sharedProfileId : profileName.Trim(), workshopIds);
    }

    private async Task<ModProfile> CreateAndActivateSharedSyncProfileAsync(
        string remoteProfileName,
        string sharedProfileId,
        IReadOnlyList<string> orderedWorkshopIds,
        HashSet<string> desiredWorkshopIds)
    {
        await SaveCurrentlyActiveProfileBeforeSwitchAsync();

        var localProfileName = BuildUniqueSharedSyncProfileName(remoteProfileName);
        var profile = await _db.CreateProfileAsync(localProfileName);
        await _db.SetProfileSharedIdAsync(profile.Id, sharedProfileId);

        profile.SharedProfileId = sharedProfileId;

        await ApplySharedSyncProfileStateAsync(profile.Id, orderedWorkshopIds, desiredWorkshopIds, localProfileName);
        return profile;
    }

    private async Task ApplySharedSyncProfileStateAsync(
        int profileId,
        IReadOnlyList<string> orderedWorkshopIds,
        HashSet<string> desiredWorkshopIds,
        string localProfileName)
    {
        var orderByWorkshopId = orderedWorkshopIds
            .Select((id, index) => (id, index))
            .ToDictionary(x => x.id, x => x.index, StringComparer.Ordinal);

        var enabledMods = Mods
            .Where(mod => desiredWorkshopIds.Contains(mod.WorkshopId))
            .OrderBy(mod => orderByWorkshopId.TryGetValue(mod.WorkshopId, out var order) ? order : int.MaxValue)
            .ThenBy(mod => mod.Name)
            .ToList();

        // Keep only enabled shared mods in profile entries so disabled mods do not consume load-order positions.
        var entries = new List<(int modId, bool isEnabled, int loadOrder)>(enabledMods.Count);
        var nextOrder = 0;

        foreach (var mod in enabledMods)
            entries.Add((mod.Model.Id, true, nextOrder++));

        await _db.SaveProfileEntriesAsync(profileId, entries);
        await _db.ActivateProfileAsync(profileId);

        _currentActiveProfileId = profileId;
        _sharedProfileSyncContext = new SharedProfileSyncContext
        {
            LocalProfileId = profileId,
            LocalProfileName = localProfileName,
            OrderedWorkshopIds = orderedWorkshopIds.ToList(),
            WorkshopIdSet = new HashSet<string>(desiredWorkshopIds, StringComparer.Ordinal),
        };

        await LoadModsAsync();
    }

    private string BuildUniqueSharedSyncProfileName(string remoteProfileName)
    {
        var baseName = $"Synced - {remoteProfileName}";
        if (string.IsNullOrWhiteSpace(remoteProfileName))
            baseName = "Synced Profile";

        var candidate = baseName;
        var suffix = 2;

        while (Profiles.Any(p => string.Equals(p.Name, candidate, StringComparison.OrdinalIgnoreCase)))
        {
            candidate = $"{baseName} ({suffix})";
            suffix++;
        }

        return candidate;
    }

    [RelayCommand]
    private async Task DeleteProfileAsync(ModProfile? profile)
    {
        if (profile is null)
        {
            StatusMessage = "Select a profile to delete.";
            return;
        }

        if (Profiles.Count <= 1)
        {
            StatusMessage = "Cannot delete the only remaining profile.";
            return;
        }

        var deletedIndex = Profiles.IndexOf(profile);
        var deletedWasActive = ActiveProfile?.Id == profile.Id;

        await _db.DeleteProfileAsync(profile.Id);
        Profiles.Remove(profile);
        if (_sharedProfileSyncContext is not null && _sharedProfileSyncContext.LocalProfileId == profile.Id)
            _sharedProfileSyncContext = null;
        OnPropertyChanged(nameof(CanDeleteProfiles));

        if (deletedWasActive)
        {
            var fallbackIndex = Math.Clamp(deletedIndex, 0, Profiles.Count - 1);
            var nextProfile = Profiles.Count > 0 ? Profiles[fallbackIndex] : null;

            if (nextProfile is not null)
            {
                _currentActiveProfileId = null;
                await _db.ActivateProfileAsync(nextProfile.Id);
                _currentActiveProfileId = nextProfile.Id;
                ActiveProfile = nextProfile;
                await LoadModsAsync();
                StatusMessage = $"Deleted profile: {profile.Name}. Activated {nextProfile.Name}.";
                return;
            }

            ActiveProfile = null;
            _currentActiveProfileId = null;
        }

        StatusMessage = $"Deleted profile: {profile.Name}";
    }

    [RelayCommand]
    private void OpenFileLocation(ModViewModel? mod)
    {
        if (mod is null)
        {
            StatusMessage = "Select a mod first.";
            return;
        }

        try
        {
            var descriptorPath = mod.Model.DescriptorPath;
            if (!string.IsNullOrWhiteSpace(descriptorPath) && File.Exists(descriptorPath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"/select,\"{descriptorPath}\"",
                    UseShellExecute = true
                });
                StatusMessage = "Opened file location.";
                return;
            }

            var installedPath = mod.Model.InstalledPath;
            if (!string.IsNullOrWhiteSpace(installedPath) && Directory.Exists(installedPath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"\"{installedPath}\"",
                    UseShellExecute = true
                });
                StatusMessage = "Opened file location.";
                return;
            }

            StatusMessage = "Mod files were not found on disk.";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Could not open file location: {ex.Message}";
        }
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

        await StellarisyncClient.FetchCommunityCompatibilityAsync();

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

        // Remove profiles that no longer exist.
        var incomingIds = profiles.Select(p => p.Id).ToHashSet();
        for (var i = Profiles.Count - 1; i >= 0; i--)
        {
            if (!incomingIds.Contains(Profiles[i].Id))
                Profiles.RemoveAt(i);
        }

        // Update existing entries in place to preserve ComboBox item references,
        // or add new profiles when needed.
        foreach (var p in profiles)
        {
            var existing = Profiles.FirstOrDefault(x => x.Id == p.Id);
            if (existing is not null)
            {
                existing.Name = p.Name;
                existing.IsActive = p.IsActive;
                existing.SharedProfileId = p.SharedProfileId;
            }
            else
            {
                Profiles.Add(p);
            }
        }

        var preferredActiveProfileId = ActiveProfile?.Id ?? _currentActiveProfileId;
        var activeByTrackedId = preferredActiveProfileId.HasValue
            ? Profiles.FirstOrDefault(p => p.Id == preferredActiveProfileId.Value)
            : null;
        var resolvedActive = activeByTrackedId ?? Profiles.FirstOrDefault(p => p.IsActive) ?? Profiles.FirstOrDefault();
        _currentActiveProfileId = resolvedActive?.Id;
        ActiveProfile = resolvedActive;
        _isLoadingProfiles = false;
        OnPropertyChanged(nameof(CanDeleteProfiles));

        ApplyFilter();
        _ = Task.Run(SyncLauncherStateAsync);

        RefreshCompatibilityReportSummary();

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

    // Opens the Steam Workshop page in the app's Workshop tab.
    [RelayCommand]
    private void OpenWorkshopPage(ModViewModel mod)
    {
        var url = mod.WorkshopUrl;
        if (string.IsNullOrWhiteSpace(url)) return;
        OpenWorkshopInAppRequested?.Invoke(this, url);
        StatusMessage = $"Opened {mod.Name} in Workshop tab.";
    }

    [RelayCommand]
    private async Task ReportWorkedOnMyVersionAsync(ModViewModel? mod)
    {
        await ReportCompatibilityOnMyVersionAsync(mod, worked: true);
    }

    [RelayCommand]
    private async Task ReportNotWorkedOnMyVersionAsync(ModViewModel? mod)
    {
        await ReportCompatibilityOnMyVersionAsync(mod, worked: false);
    }

    private async Task ReportCompatibilityOnMyVersionAsync(ModViewModel? mod, bool worked)
    {
        var target = mod ?? SelectedMod;
        if (target is null)
        {
            StatusMessage = "Select a mod first.";
            return;
        }

        var gameVersion = ResolveCurrentGameVersionForReport();
        if (string.IsNullOrWhiteSpace(gameVersion))
        {
            StatusMessage = "Could not determine your Stellaris version. Open Settings and detect game version first.";
            return;
        }

        IsSubmittingCompatibilityReport = true;
        try
        {
            var reporterId = GetOrCreateCompatibilityReporterId();
            var reported = await StellarisyncClient.ReportCompatibilityOnVersionAsync(
                target.WorkshopId,
                gameVersion,
                worked,
                reporterId);

            if (!reported)
            {
                StatusMessage = $"Could not submit compatibility report for {target.Name}.";
                return;
            }

            await StellarisyncClient.FetchCommunityCompatibilityAsync();
            RefreshCompatibilityReportSummary(target);
            StatusMessage = worked
                ? $"Thanks! Marked {target.Name} as working on {gameVersion}."
                : $"Thanks! Marked {target.Name} as not working on {gameVersion}.";
        }
        finally
        {
            IsSubmittingCompatibilityReport = false;
        }
    }

    private string GetOrCreateCompatibilityReporterId()
    {
        var existing = _settings.CompatibilityReporterId?.Trim();
        if (Guid.TryParse(existing, out var parsed) && parsed != Guid.Empty)
            return parsed.ToString("D");

        var created = Guid.NewGuid().ToString("D");
        _settings.CompatibilityReporterId = created;
        _settings.Save();
        return created;
    }

    private void RefreshCompatibilityReportSummary(ModViewModel? mod = null)
    {
        var target = mod ?? SelectedMod;
        if (target is null)
        {
            CompatibilityReportSummary = string.Empty;
            return;
        }

        var gameVersion = ResolveCurrentGameVersionForReport();
        if (string.IsNullOrWhiteSpace(gameVersion))
        {
            CompatibilityReportSummary = "Detect your Stellaris version in Settings to view community compatibility.";
            return;
        }

        var stats = StellarisyncClient.GetCommunityCompatibilityStats(target.WorkshopId, gameVersion);
        if (stats.TotalReports <= 0)
        {
            CompatibilityReportSummary = $"No community reports yet for your {gameVersion} version.";
            return;
        }

        CompatibilityReportSummary = $"This mod is reported to work by {stats.WorksPercentage}% of users for your {gameVersion} version ({stats.WorkedCount} worked, {stats.NotWorkedCount} not worked).";
    }

    private string? ResolveCurrentGameVersionForReport()
    {
        var fromSettings = NormalizeVersionForReport(_settings.LastDetectedGameVersion);
        if (!string.IsNullOrWhiteSpace(fromSettings))
            return fromSettings;

        try
        {
            var detector = new GameDetector();
            var gamePath = _settings.GamePath;
            if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
                gamePath = detector.DetectGamePath();

            if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
                return null;

            var detected = detector.DetectGameVersion(gamePath);
            var normalized = NormalizeVersionForReport(detected);
            if (!string.IsNullOrWhiteSpace(normalized))
            {
                _settings.LastDetectedGameVersion = normalized;
                _settings.Save();
            }

            return normalized;
        }
        catch
        {
            return null;
        }
    }

    private static string? NormalizeVersionForReport(string? version)
    {
        if (string.IsNullOrWhiteSpace(version))
            return null;

        var trimmed = version.Trim();
        var tokenMatch = VersionTokenPattern.Match(trimmed);
        if (tokenMatch.Success)
            return tokenMatch.Value;

        return StellarisVersions.Normalize(trimmed) ?? trimmed;
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
