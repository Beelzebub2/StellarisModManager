using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

public partial class LibraryViewModel : ViewModelBase
{
    private readonly ModDatabase _db;
    private readonly ModUpdateChecker _updateChecker;
    private readonly ModInstaller _installer;
    private readonly ModExportImport _exportImport;

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

    // Status
    [ObservableProperty] private string _statusMessage = "";
    [ObservableProperty] private bool _isCheckingUpdates = false;
    [ObservableProperty] private int _updatesAvailable = 0;

    public LibraryViewModel(ModDatabase db, ModUpdateChecker updateChecker, ModInstaller installer)
    {
        _db = db;
        _updateChecker = updateChecker;
        _installer = installer;
        _exportImport = new ModExportImport();
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
    }

    // Load order drag-drop support
    [RelayCommand]
    private void MoveModUp(ModViewModel mod)
    {
        var idx = FilteredMods.IndexOf(mod);
        if (idx <= 0) return;

        var prev = FilteredMods[idx - 1];
        (mod.LoadOrder, prev.LoadOrder) = (prev.LoadOrder, mod.LoadOrder);
        FilteredMods.Move(idx, idx - 1);
        _ = SaveLoadOrderAsync();
    }

    [RelayCommand]
    private void MoveModDown(ModViewModel mod)
    {
        var idx = FilteredMods.IndexOf(mod);
        if (idx < 0 || idx >= FilteredMods.Count - 1) return;

        var next = FilteredMods[idx + 1];
        (mod.LoadOrder, next.LoadOrder) = (next.LoadOrder, mod.LoadOrder);
        FilteredMods.Move(idx, idx + 1);
        _ = SaveLoadOrderAsync();
    }

    private async Task SaveLoadOrderAsync()
    {
        var updates = FilteredMods
            .Select((m, i) => (m.Model.Id, i))
            .ToList();
        await _db.UpdateLoadOrderAsync(updates);
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
        StatusMessage = $"Updating {mod.Name}...";
        // Full update flow is implemented in Task 5 (BrowserView / downloader wiring)
        // Placeholder: just refresh mod info
        await Task.Delay(100);
        StatusMessage = $"Update for {mod.Name} requires SteamCMD (configure in Settings)";
    }

    [RelayCommand]
    private async Task UninstallModAsync(ModViewModel mod)
    {
        StatusMessage = $"Uninstalling {mod.Name}...";
        try
        {
            await _installer.UninstallModAsync(mod.Model);
            await _db.DeleteModAsync(mod.Model.Id);
            Mods.Remove(mod);
            ApplyFilter();
            StatusMessage = $"{mod.Name} uninstalled";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Uninstall failed: {ex.Message}";
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
        var name = $"Profile {Profiles.Count + 1}";
        var profile = await _db.CreateProfileAsync(name);
        Profiles.Add(profile);
        StatusMessage = $"Created profile: {name}";
    }

    [RelayCommand]
    private async Task DeleteProfileAsync(ModProfile profile)
    {
        await _db.DeleteProfileAsync(profile.Id);
        Profiles.Remove(profile);
        if (ActiveProfile?.Id == profile.Id)
            ActiveProfile = null;
        StatusMessage = $"Deleted profile: {profile.Name}";
    }

    [RelayCommand]
    private async Task ActivateProfileAsync(ModProfile profile)
    {
        await _db.ActivateProfileAsync(profile.Id);
        ActiveProfile = profile;
        await LoadModsAsync();
        StatusMessage = $"Activated profile: {profile.Name}";
    }

    // Load mods from DB
    public async Task LoadModsAsync()
    {
        Mods.Clear();
        FilteredMods.Clear();

        var mods = await _db.GetAllModsAsync();
        foreach (var mod in mods)
            Mods.Add(new ModViewModel(mod, _db));

        var profiles = await _db.GetProfilesAsync();
        Profiles.Clear();
        foreach (var p in profiles)
            Profiles.Add(p);

        ActiveProfile = profiles.FirstOrDefault(p => p.IsActive);

        ApplyFilter();
    }

    // Called when a new mod is installed
    public async Task RefreshAsync()
    {
        await LoadModsAsync();
    }
}
