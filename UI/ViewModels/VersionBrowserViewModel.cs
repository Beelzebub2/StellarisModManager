using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Services;
using StellarisModManager.Core.Utils;

namespace StellarisModManager.UI.ViewModels;

public partial class VersionBrowserViewModel : ViewModelBase
{
    private readonly ModDatabase _db;
    private Dictionary<string, List<Mod>> _versionGroups = new();

    public ObservableCollection<VersionDropdownItem> VersionItems { get; } = new();
    public ObservableCollection<VersionModCard> DisplayedMods { get; } = new();

    [ObservableProperty] private VersionDropdownItem? _selectedVersion;
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private bool _showOlderVersions;
    [ObservableProperty] private int _displayedModCount;

    public VersionBrowserViewModel(ModDatabase db)
    {
        _db = db;
    }

    partial void OnSelectedVersionChanged(VersionDropdownItem? value) => ApplyFilter();
    partial void OnSearchTextChanged(string value) => ApplyFilter();
    partial void OnShowOlderVersionsChanged(bool value) => RebuildDropdown();

    [RelayCommand]
    private async Task LoadModsAsync()
    {
        var mods = await _db.GetAllModsAsync();
        GroupByVersion(mods);
        RebuildDropdown();
    }

    private void GroupByVersion(List<Mod> mods)
    {
        _versionGroups = new Dictionary<string, List<Mod>>();

        foreach (var mod in mods)
        {
            var key = StellarisVersions.Normalize(mod.GameVersion)
                   ?? StellarisVersions.ExtractFromText(mod.Tags)
                   ?? StellarisVersions.ExtractFromText(mod.Description)
                   ?? "Unknown";

            if (!_versionGroups.TryGetValue(key, out var list))
            {
                list = new List<Mod>();
                _versionGroups[key] = list;
            }

            list.Add(mod);
        }
    }

    private void RebuildDropdown()
    {
        var previousVersion = SelectedVersion?.Version;

        VersionItems.Clear();

        // Sort non-"Unknown" keys descending by version number
        var versionKeys = _versionGroups.Keys
            .Where(k => k != "Unknown")
            .OrderByDescending(k => k, VersionComparer.Instance)
            .ToList();

        // Filter to recent unless ShowOlderVersions is enabled
        if (!ShowOlderVersions)
            versionKeys = versionKeys.Where(StellarisVersions.IsRecent).ToList();

        foreach (var key in versionKeys)
        {
            VersionItems.Add(new VersionDropdownItem
            {
                Version = key,
                DisplayName = StellarisVersions.GetDisplayName(key),
                ModCount = _versionGroups[key].Count
            });
        }

        // Append "Unknown" at the end if present
        if (_versionGroups.TryGetValue("Unknown", out var unknownMods))
        {
            VersionItems.Add(new VersionDropdownItem
            {
                Version = "Unknown",
                DisplayName = "Unknown",
                ModCount = unknownMods.Count
            });
        }

        // Restore previous selection, or pick the version with most mods
        var restored = previousVersion is not null
            ? VersionItems.FirstOrDefault(v => v.Version == previousVersion)
            : null;

        if (restored is not null)
        {
            SelectedVersion = restored;
        }
        else
        {
            SelectedVersion = VersionItems
                .OrderByDescending(v => v.ModCount)
                .FirstOrDefault();
        }
    }

    private void ApplyFilter()
    {
        DisplayedMods.Clear();

        if (SelectedVersion is null || !_versionGroups.TryGetValue(SelectedVersion.Version, out var mods))
        {
            DisplayedModCount = 0;
            return;
        }

        IEnumerable<Mod> filtered = mods;

        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            var lower = SearchText.ToLowerInvariant();
            filtered = filtered.Where(m => m.Name.ToLowerInvariant().Contains(lower));
        }

        foreach (var mod in filtered.OrderBy(m => m.Name))
            DisplayedMods.Add(new VersionModCard(mod));

        DisplayedModCount = DisplayedMods.Count;
    }

    // -------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------

    private sealed class VersionComparer : IComparer<string>
    {
        public static readonly VersionComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            if (x is null && y is null) return 0;
            if (x is null) return -1;
            if (y is null) return 1;
            return StellarisVersions.CompareVersions(x, y);
        }
    }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

public sealed class VersionDropdownItem
{
    public string Version { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public int ModCount { get; init; }

    public string DropdownText => $"{DisplayName} ({ModCount})";
}

public sealed class VersionModCard
{
    private readonly Mod _mod;

    public VersionModCard(Mod mod)
    {
        _mod = mod;
    }

    public string Name => _mod.Name;
    public string? ThumbnailUrl => _mod.ThumbnailUrl;
    public string GameVersionBadge => string.IsNullOrWhiteSpace(_mod.GameVersion) ? "Unknown" : _mod.GameVersion;
    public bool HasThumbnail => !string.IsNullOrWhiteSpace(_mod.ThumbnailUrl);
    public string PlaceholderLetter => string.IsNullOrWhiteSpace(_mod.Name) ? "?" : _mod.Name[0].ToString().ToUpperInvariant();
}
