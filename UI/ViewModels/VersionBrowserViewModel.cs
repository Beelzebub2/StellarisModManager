using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Services;
using StellarisModManager.Core.Utils;

namespace StellarisModManager.UI.ViewModels;

public partial class VersionBrowserViewModel : ViewModelBase
{
    private const string CacheSchemaVersion = "5";
    private const int DefaultFetchLimit = 64;
    private const int ScanMoreStep = 32;
    private const int MetadataResolveConcurrency = 8;
    private const int SearchBackgroundPageLimit = 40;
    private const int SearchCacheFlushBatchSize = 48;
    private const int MaxCachedCardsPerQuery = 1500;
    private const int ResultPageSize = ScanMoreStep;
    private static readonly Regex AnyVersionRegex = new(@"(?<!\d)\d+\.\d+(?:\.\d+)?(?!\d)", RegexOptions.Compiled);
    private static readonly HttpClient WorkshopHttp = BuildWorkshopHttpClient();
    private static readonly Regex WorkshopIdRegex = new(@"sharedfiles/filedetails/\?id=(?<id>\d+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly IReadOnlyList<string> RelevanceBrowseSorts = new[] { "trend", "totaluniquesubscribers" };
    private static readonly IReadOnlyList<string> MostSubscribedBrowseSorts = new[] { "totaluniquesubscribers", "trend" };
    private static readonly IReadOnlyList<string> MostPopularBrowseSorts = new[] { "trend", "totaluniquesubscribers" };
    private static readonly string ThumbnailCacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StellarisModManager",
        "cache",
        "version-thumbnails");
    private static readonly string ResultCacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StellarisModManager",
        "cache",
        "version-results");
    private static readonly string CacheVersionFilePath = Path.Combine(ResultCacheDir, "cache.schema");
    private static readonly TimeSpan ResultCacheTtl = TimeSpan.FromMinutes(30);

    private readonly WorkshopDownloader _downloader;
    private readonly AppSettings _settings;
    private readonly GameDetector _detector;
    private readonly List<VersionModCard> _fetchedMods = new();
    private readonly Dictionary<string, string> _modStates = new(StringComparer.Ordinal);
    private readonly HashSet<string> _installedWorkshopIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CachedVersionResult> _versionResultCache = new(StringComparer.OrdinalIgnoreCase);

    private bool _loadedOnce;
    private int _releaseCutoffExcludedCount;
    private CancellationTokenSource? _refreshCts;
    private CancellationTokenSource? _thumbnailWarmCts;
    private CancellationTokenSource? _searchDebounceCts;
    private List<VersionModCard> _orderedFilteredMods = new();

    public ObservableCollection<VersionDropdownItem> VersionItems { get; } = new();
    public ObservableCollection<VersionSortModeItem> SortModes { get; } = new();
    public ObservableCollection<VersionModCard> DisplayedMods { get; } = new();

    [ObservableProperty] private VersionDropdownItem? _selectedVersion;
    [ObservableProperty] private VersionSortModeItem? _selectedSortMode;
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private bool _showOlderVersions;
    [ObservableProperty] private int _fetchLimit = DefaultFetchLimit;
    [ObservableProperty] private int _displayedModCount;
    [ObservableProperty] private bool _isLoading;
    [ObservableProperty] private bool _isScanningMore;
    [ObservableProperty] private bool _hasNoMods;
    [ObservableProperty] private string _statusText = "Select a Stellaris version to load workshop mods.";
    [ObservableProperty] private int _currentResultPage = 1;
    [ObservableProperty] private int _totalResultPages = 1;
    [ObservableProperty] private int _overlayStateVersion;

    public bool ShowNoModsState => !IsLoading && HasNoMods && DisplayedModCount == 0;
    public bool ShowFilteredEmptyState => !IsLoading && !HasNoMods && DisplayedModCount == 0;
    public bool HasResults => DisplayedModCount > 0;
    public bool ShowLoadingState => IsLoading && DisplayedModCount == 0;
    public bool CanScanMore => !IsLoading && !IsScanningMore;
    public bool CanGoToPreviousPage => !IsLoading && CurrentResultPage > 1;
    public bool CanGoToNextPage => !IsLoading && !IsScanningMore && (CurrentResultPage < TotalResultPages || CanScanMore);
    public string ResultPageText => $"Page {CurrentResultPage} of {TotalResultPages}";
    public string NextPageButtonText => IsScanningMore
        ? "Scanning..."
        : CurrentResultPage < TotalResultPages
            ? $"Next page ({CurrentResultPage + 1})"
            : "Scan next page";

    public event EventHandler<string>? InstallModRequested;
    public event EventHandler<string>? UninstallModRequested;

    public VersionBrowserViewModel(WorkshopDownloader downloader, AppSettings settings, GameDetector detector)
    {
        _downloader = downloader;
        _settings = settings;
        _detector = detector;
        BuildSortModes();
        Directory.CreateDirectory(ThumbnailCacheDir);
        Directory.CreateDirectory(ResultCacheDir);
        InitializeCaches();
    }

    private static IReadOnlyList<string> ResolvePreferredVersionCandidates(AppSettings settings, GameDetector detector)
    {
        var result = new List<string>();

        var hintedVersion = settings.LastDetectedGameVersion?.Trim();
        if (!string.IsNullOrWhiteSpace(hintedVersion))
        {
            var hintedMatch = AnyVersionRegex.Match(hintedVersion);
            if (hintedMatch.Success)
            {
                var hintedToken = hintedMatch.Value;
                if (!string.IsNullOrWhiteSpace(hintedToken) &&
                    !result.Contains(hintedToken, StringComparer.OrdinalIgnoreCase))
                {
                    result.Add(hintedToken);
                }
            }

            var hintedNoSuffix = hintedVersion.Split('-', 2, StringSplitOptions.TrimEntries)[0];
            if (!string.IsNullOrWhiteSpace(hintedNoSuffix) &&
                !result.Contains(hintedNoSuffix, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(hintedNoSuffix);
            }

            var hintedNormalized = StellarisVersions.Normalize(hintedVersion);
            if (!string.IsNullOrWhiteSpace(hintedNormalized) &&
                !result.Contains(hintedNormalized, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(hintedNormalized);
            }
        }

        var gamePath = settings.GamePath;
        if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
            gamePath = detector.DetectGamePath();

        if (string.IsNullOrWhiteSpace(gamePath) || !Directory.Exists(gamePath))
            return result;

        try
        {
            var detected = detector.DetectGameVersion(gamePath);
            if (string.IsNullOrWhiteSpace(detected))
                return result;

            var exact = detected.Trim();
            var match = AnyVersionRegex.Match(exact);
            if (match.Success)
            {
                var extracted = match.Value;
                if (!string.IsNullOrWhiteSpace(extracted))
                    result.Add(extracted);
            }

            // Also handle forms like "4.2.4 - Corvus" by trimming suffix text.
            var withoutSuffix = exact.Split('-', 2, StringSplitOptions.TrimEntries)[0];
            if (!string.IsNullOrWhiteSpace(withoutSuffix) &&
                !result.Contains(withoutSuffix, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(withoutSuffix);
            }

            var normalized = StellarisVersions.Normalize(exact);
            if (!string.IsNullOrWhiteSpace(normalized) &&
                !result.Contains(normalized, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(normalized);
            }

            if (result.Count == 0 && !string.IsNullOrWhiteSpace(exact))
                result.Add(exact);

            return result;
        }
        catch
        {
            return result;
        }
    }

    private static string GetConfirmedGameVersionBadge(string workshopId, string selectedVersion)
    {
        var confirmed = StellarisyncClient.GetConfirmedVersion(workshopId);
        if (!string.IsNullOrWhiteSpace(confirmed))
        {
            var display = StellarisVersions.Normalize(confirmed) ?? confirmed.Replace(".*", "");
            return $"✅ {display}";
        }

        var selectedDisplay = StellarisVersions.Normalize(selectedVersion) ?? selectedVersion;
        return selectedDisplay;
    }

    private static int GetCommunityWorksCount(string workshopId, string selectedVersion)
    {
        return StellarisyncClient.GetCommunityWorksCount(workshopId, selectedVersion);
    }

    private static int GetCommunityNotWorksCount(string workshopId, string selectedVersion)
    {
        return StellarisyncClient.GetCommunityNotWorksCount(workshopId, selectedVersion);
    }

    private static void InitializeCaches()
    {
        try
        {
            var existingVersion = File.Exists(CacheVersionFilePath)
                ? File.ReadAllText(CacheVersionFilePath).Trim()
                : string.Empty;

            if (string.Equals(existingVersion, CacheSchemaVersion, StringComparison.Ordinal))
                return;

            ClearDirectoryFiles(ThumbnailCacheDir);
            ClearDirectoryFiles(ResultCacheDir);
            File.WriteAllText(CacheVersionFilePath, CacheSchemaVersion);
        }
        catch
        {
            // Cache init is best-effort only.
        }
    }

    private static void ClearDirectoryFiles(string dir)
    {
        if (!Directory.Exists(dir))
            return;

        foreach (var file in Directory.GetFiles(dir))
        {
            try
            {
                File.Delete(file);
            }
            catch
            {
                // Best-effort cache cleanup.
            }
        }
    }

    partial void OnSelectedVersionChanged(VersionDropdownItem? value)
    {
        CurrentResultPage = 1;

        if (_loadedOnce)
            _ = RefreshFromWorkshopAsync(ignoreCache: !string.IsNullOrWhiteSpace(SearchText));
    }

    partial void OnSearchTextChanged(string value)
    {
        CurrentResultPage = 1;

        if (!_loadedOnce)
        {
            ApplyFilter();
            return;
        }

        // Immediately show cached/local matches while remote search continues.
        ApplyFilter();

        QueueSearchRefresh();
    }

    partial void OnSelectedSortModeChanged(VersionSortModeItem? value)
    {
        CurrentResultPage = 1;
        ApplyFilter();

        if (_loadedOnce)
            QueueSearchRefresh();
    }

    partial void OnShowOlderVersionsChanged(bool value)
    {
        if (!_loadedOnce)
            return;

        CurrentResultPage = 1;
        BuildVersionDropdown();
        _ = RefreshFromWorkshopAsync(ignoreCache: !string.IsNullOrWhiteSpace(SearchText));
    }

    private void QueueSearchRefresh()
    {
        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _searchDebounceCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        _ = DebouncedSearchRefreshAsync(cts);
    }

    private async Task DebouncedSearchRefreshAsync(CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(350, cts.Token);
            if (cts.IsCancellationRequested)
                return;

            await RefreshFromWorkshopAsync(ignoreCache: true);
        }
        catch (OperationCanceledException)
        {
            // Ignore canceled search refreshes while user is typing.
        }
        finally
        {
            if (ReferenceEquals(_searchDebounceCts, cts))
                _searchDebounceCts = null;

            cts.Dispose();
        }
    }

    partial void OnIsLoadingChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowLoadingState));
        OnPropertyChanged(nameof(ShowNoModsState));
        OnPropertyChanged(nameof(ShowFilteredEmptyState));
        OnPropertyChanged(nameof(HasResults));
        OnPropertyChanged(nameof(CanScanMore));
        OnPropertyChanged(nameof(CanGoToPreviousPage));
        OnPropertyChanged(nameof(CanGoToNextPage));
    }

    partial void OnIsScanningMoreChanged(bool value)
    {
        OnPropertyChanged(nameof(CanScanMore));
        OnPropertyChanged(nameof(CanGoToNextPage));
        OnPropertyChanged(nameof(NextPageButtonText));
    }

    partial void OnFetchLimitChanged(int value)
    {
        OnPropertyChanged(nameof(NextPageButtonText));
    }

    partial void OnCurrentResultPageChanged(int value)
    {
        OnPropertyChanged(nameof(ResultPageText));
        OnPropertyChanged(nameof(CanGoToPreviousPage));
        OnPropertyChanged(nameof(CanGoToNextPage));
        OnPropertyChanged(nameof(NextPageButtonText));
    }

    partial void OnTotalResultPagesChanged(int value)
    {
        OnPropertyChanged(nameof(ResultPageText));
        OnPropertyChanged(nameof(CanGoToPreviousPage));
        OnPropertyChanged(nameof(CanGoToNextPage));
        OnPropertyChanged(nameof(NextPageButtonText));
    }

    partial void OnHasNoModsChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowNoModsState));
        OnPropertyChanged(nameof(ShowFilteredEmptyState));
    }

    partial void OnDisplayedModCountChanged(int value)
    {
        OnPropertyChanged(nameof(ShowLoadingState));
        OnPropertyChanged(nameof(ShowNoModsState));
        OnPropertyChanged(nameof(ShowFilteredEmptyState));
        OnPropertyChanged(nameof(HasResults));
    }

    public Task LoadAsync() => LoadModsAsync();

    public void SetInstalledWorkshopIds(IEnumerable<string> workshopIds)
    {
        _installedWorkshopIds.Clear();

        foreach (var id in workshopIds)
        {
            if (!string.IsNullOrWhiteSpace(id))
                _installedWorkshopIds.Add(id.Trim());
        }

        ApplyModStateToCards();
        NotifyOverlayStateChanged();
    }

    public void SetModStates(IReadOnlyDictionary<string, string> modStates)
    {
        _modStates.Clear();

        foreach (var pair in modStates)
        {
            if (string.IsNullOrWhiteSpace(pair.Key))
                continue;

            _modStates[pair.Key.Trim()] = NormalizeState(pair.Value);
        }

        ApplyModStateToCards();
        NotifyOverlayStateChanged();
    }

    public IReadOnlyList<string> GetInstalledWorkshopIdsSnapshot()
    {
        return _installedWorkshopIds.ToList();
    }

    public IReadOnlyDictionary<string, string> GetModStatesSnapshot()
    {
        return _modStates.ToDictionary(kvp => kvp.Key, kvp => kvp.Value, StringComparer.Ordinal);
    }

    public void RequestInstallFromOverlay(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        var normalizedId = workshopId.Trim();
        var card = _fetchedMods.FirstOrDefault(m => string.Equals(m.WorkshopId, normalizedId, StringComparison.Ordinal));
        var state = card is not null ? NormalizeState(card.ActionState) : GetEffectiveState(normalizedId);
        if (state is "queued" or "installing" or "uninstalling" or "installed")
            return;

        if (card is not null)
            card.ActionState = "queued";

        StatusText = string.IsNullOrWhiteSpace(card?.Name)
            ? $"Queued workshop mod {normalizedId}"
            : $"Queued {card.Name}";
        NotifyOverlayStateChanged();
        InstallModRequested?.Invoke(this, normalizedId);
    }

    public void RequestUninstallFromOverlay(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return;

        var normalizedId = workshopId.Trim();
        var card = _fetchedMods.FirstOrDefault(m => string.Equals(m.WorkshopId, normalizedId, StringComparison.Ordinal));
        var state = card is not null ? NormalizeState(card.ActionState) : GetEffectiveState(normalizedId);
        if (state is "queued" or "installing" or "uninstalling")
            return;

        if (state != "installed")
            return;

        if (card is not null)
            card.ActionState = "uninstalling";

        StatusText = string.IsNullOrWhiteSpace(card?.Name)
            ? $"Uninstalling workshop mod {normalizedId}..."
            : $"Uninstalling {card.Name}...";
        NotifyOverlayStateChanged();
        UninstallModRequested?.Invoke(this, normalizedId);
    }

    [RelayCommand]
    private void ToggleInstall(VersionModCard? card)
    {
        if (card is null || string.IsNullOrWhiteSpace(card.WorkshopId))
            return;

        var state = NormalizeState(card.ActionState);
        if (state is "queued" or "installing" or "uninstalling")
            return;

        if (state == "installed")
        {
            card.ActionState = "uninstalling";
            StatusText = $"Uninstalling {card.Name}...";
            NotifyOverlayStateChanged();
            UninstallModRequested?.Invoke(this, card.WorkshopId);
            return;
        }

        card.ActionState = "queued";
        StatusText = $"Queued {card.Name}";
        NotifyOverlayStateChanged();
        InstallModRequested?.Invoke(this, card.WorkshopId);
    }

    [RelayCommand]
    private async Task LoadModsAsync()
    {
        if (!_loadedOnce)
        {
            BuildVersionDropdown();
            if (SelectedVersion is null)
                SelectedVersion = VersionItems.FirstOrDefault();
            _loadedOnce = true;
        }

        await StellarisyncClient.FetchConfirmedVersionsAsync();
        await StellarisyncClient.FetchCommunityCompatibilityAsync();

        await RefreshFromWorkshopAsync();
    }

    [RelayCommand]
    private async Task NextPageAsync()
    {
        if (IsLoading || IsScanningMore)
            return;

        if (CurrentResultPage < TotalResultPages)
        {
            CurrentResultPage++;
            ApplyPagedResults();
            return;
        }

        var requestedPage = CurrentResultPage + 1;
        await ScanMoreAsync();

        if (TotalResultPages >= requestedPage)
        {
            CurrentResultPage = requestedPage;
            ApplyPagedResults();
        }
    }

    [RelayCommand]
    private void PreviousPage()
    {
        if (IsLoading || CurrentResultPage <= 1)
            return;

        CurrentResultPage--;
        ApplyPagedResults();
    }

    private async Task ScanMoreAsync()
    {
        if (IsLoading || IsScanningMore)
            return;

        FetchLimit += ScanMoreStep;
        StatusText = $"Scanning page {TotalResultPages + 1} for more mods...";
        await AppendMoreModsInBackgroundAsync();
    }

    private async Task AppendMoreModsInBackgroundAsync()
    {
        var versionQuery = SelectedVersion?.Version;
        if (string.IsNullOrWhiteSpace(versionQuery))
            return;

        _releaseCutoffExcludedCount = 0;

        var searchText = SearchText.Trim();
        var hasSearchText = !string.IsNullOrWhiteSpace(searchText);
        var cacheQueryKey = hasSearchText ? searchText : null;

        var targetCount = Math.Max(FetchLimit, 1);

        var refreshCts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _refreshCts, refreshCts);
        previous?.Cancel();
        previous?.Dispose();
        var cancellationToken = refreshCts.Token;

        IsScanningMore = true;

        try
        {
            if (!hasSearchText)
                await TryAppendCachedCardsAsync(versionQuery, targetCount, cancellationToken, cacheQueryKey);

            if (_fetchedMods.Count < targetCount)
            {
                var searchQueries = GetWorkshopSearchQueries(versionQuery, searchText);
                var ids = await FetchCandidateWorkshopIdsAsync(searchQueries, cancellationToken, targetCount);
                cancellationToken.ThrowIfCancellationRequested();

                var existingIds = new HashSet<string>(_fetchedMods.Select(m => m.WorkshopId), StringComparer.Ordinal);
                var missingIds = ids.Where(id => !existingIds.Contains(id)).ToList();

                if (missingIds.Count > 0)
                {
                    var needCount = Math.Max(targetCount - _fetchedMods.Count, 1);
                    var newCards = await ResolveWorkshopCardsAsync(versionQuery, missingIds, cancellationToken, needCount);
                    cancellationToken.ThrowIfCancellationRequested();

                    var appended = AppendCards(newCards, targetCount);
                    if (appended.Count > 0)
                    {
                        ApplyModStateToCards();
                        ApplyFilter();
                        QueueThumbnailWarm(appended);
                        await SaveCachedVersionCardsAsync(versionQuery, _fetchedMods, cancellationToken, cacheQueryKey);
                    }
                }
            }

            HasNoMods = _fetchedMods.Count == 0;
            if (hasSearchText)
            {
                StatusText = WithReleaseCutoffHint(HasNoMods
                    ? $"No mods found for '{searchText}' in {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for '{searchText}' in {versionQuery}.", versionQuery);
            }
            else
            {
                StatusText = WithReleaseCutoffHint(HasNoMods
                    ? $"No workshop mods found for {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for {versionQuery}.", versionQuery);
            }
        }
        catch (OperationCanceledException)
        {
            // Ignore canceled background scan.
        }
        catch (Exception ex)
        {
            StatusText = $"Scan More failed: {ex.Message}";
        }
        finally
        {
            if (ReferenceEquals(_refreshCts, refreshCts))
                _refreshCts = null;

            IsScanningMore = false;
            refreshCts.Dispose();
        }
    }

    private async Task TryAppendCachedCardsAsync(
        string versionQuery,
        int targetCount,
        CancellationToken cancellationToken,
        string? searchText)
    {
        var cachedCards = await TryLoadCachedVersionCardsAsync(versionQuery, cancellationToken, searchText);
        if (cachedCards is null || cachedCards.Count == 0)
            return;

        var appended = AppendCards(cachedCards, targetCount);
        if (appended.Count == 0)
            return;

        ApplyModStateToCards();
        ApplyFilter();
        QueueThumbnailWarm(appended);
    }

    private List<VersionModCard> AppendCards(IEnumerable<VersionModCard> candidates, int? targetCount)
    {
        var appended = new List<VersionModCard>();
        if (targetCount.HasValue && _fetchedMods.Count >= targetCount.Value)
            return appended;

        var knownIds = new HashSet<string>(_fetchedMods.Select(m => m.WorkshopId), StringComparer.Ordinal);

        foreach (var card in candidates)
        {
            if (targetCount.HasValue && _fetchedMods.Count >= targetCount.Value)
                break;

            if (string.IsNullOrWhiteSpace(card.WorkshopId))
                continue;

            if (!knownIds.Add(card.WorkshopId))
                continue;

            _fetchedMods.Add(card);
            appended.Add(card);
        }

        return appended;
    }

    private void BuildVersionDropdown()
    {
        var currentSelection = SelectedVersion?.Version;

        VersionItems.Clear();
        foreach (var version in GetVersionQueries(ShowOlderVersions))
        {
            VersionItems.Add(new VersionDropdownItem
            {
                Version = version,
                DisplayName = GetDisplayName(version)
            });
        }

        var firstVersion = VersionItems.FirstOrDefault()?.Version;
        var hasCurrentSelection = !string.IsNullOrWhiteSpace(currentSelection);
        var isFallbackFirstSelection = hasCurrentSelection &&
            !string.IsNullOrWhiteSpace(firstVersion) &&
            string.Equals(currentSelection, firstVersion, StringComparison.OrdinalIgnoreCase);

        var preserveCurrentSelection = _loadedOnce && hasCurrentSelection && !isFallbackFirstSelection;
        if (preserveCurrentSelection)
        {
            SelectedVersion = VersionItems.FirstOrDefault(v => v.Version == currentSelection)
                ?? VersionItems.FirstOrDefault();
        }
        else
        {
            var preferredCandidates = ResolvePreferredVersionCandidates(_settings, _detector);
            SelectedVersion = ResolvePreferredVersionItem(preferredCandidates) ?? VersionItems.FirstOrDefault();
        }

        // Ensure our intended selection wins after ComboBox deferred auto-select.
        var targetSelection = SelectedVersion;
        Dispatcher.UIThread.Post(() =>
        {
            if (!ReferenceEquals(SelectedVersion, targetSelection))
                SelectedVersion = targetSelection;
        }, DispatcherPriority.Background);
    }

    private void BuildSortModes()
    {
        SortModes.Clear();
        SortModes.Add(new VersionSortModeItem(VersionSortMode.Relevance, "Relevance"));
        SortModes.Add(new VersionSortModeItem(VersionSortMode.MostSubscribed, "Most Subscribed"));
        SortModes.Add(new VersionSortModeItem(VersionSortMode.MostPopular, "Most Popular"));
        SelectedSortMode = SortModes.FirstOrDefault();
    }

    private VersionDropdownItem? ResolvePreferredVersionItem(IReadOnlyList<string> preferredVersionCandidates)
    {
        foreach (var candidate in preferredVersionCandidates)
        {
            var candidateToken = ExtractVersionToken(candidate);

            // If we only have major.minor, prefer newest patch variant (e.g. 4.2.4 over 4.2).
            if (!string.IsNullOrWhiteSpace(candidate) && Regex.IsMatch(candidate, @"^\d+\.\d+$"))
            {
                var patch = VersionItems.FirstOrDefault(v =>
                    v.Version.StartsWith(candidate + ".", StringComparison.OrdinalIgnoreCase));
                if (patch is not null)
                    return patch;
            }

            var exact = VersionItems.FirstOrDefault(v =>
                string.Equals(v.Version, candidate, StringComparison.OrdinalIgnoreCase));
            if (exact is not null)
                return exact;

            if (!string.IsNullOrWhiteSpace(candidateToken))
            {
                // Match against both the raw item version and display text while ignoring codename suffixes.
                var tokenMatch = VersionItems.FirstOrDefault(v =>
                {
                    var versionToken = ExtractVersionToken(v.Version);
                    if (string.Equals(versionToken, candidateToken, StringComparison.OrdinalIgnoreCase))
                        return true;

                    var displayToken = ExtractVersionToken(v.DisplayName);
                    return string.Equals(displayToken, candidateToken, StringComparison.OrdinalIgnoreCase);
                });

                if (tokenMatch is not null)
                    return tokenMatch;
            }

        }

        return null;
    }

    private static string? ExtractVersionToken(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var match = AnyVersionRegex.Match(value);
        return match.Success ? match.Value : value.Trim();
    }

    private async Task RefreshFromWorkshopAsync(bool ignoreCache = false)
    {
        var versionQuery = SelectedVersion?.Version;
        if (string.IsNullOrWhiteSpace(versionQuery))
        {
            HasNoMods = true;
            _fetchedMods.Clear();
            DisplayedMods.Clear();
            DisplayedModCount = 0;
            StatusText = "No version selected.";
            return;
        }

        var refreshCts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _refreshCts, refreshCts);
        previous?.Cancel();
        previous?.Dispose();

        var cancellationToken = refreshCts.Token;
        var searchText = SearchText.Trim();
        var hasSearchText = !string.IsNullOrWhiteSpace(searchText);
        var cacheQueryKey = hasSearchText ? searchText : null;
        var hadExistingResults = _fetchedMods.Count > 0 || DisplayedMods.Count > 0;
        _releaseCutoffExcludedCount = 0;

        IsLoading = true;
        StatusText = hasSearchText
            ? $"Searching Workshop for '{searchText}' in {versionQuery}..."
            : $"Searching Workshop for {versionQuery}...";

        try
        {
            var searchQueries = GetWorkshopSearchQueries(versionQuery, searchText);

            var allowCacheSeed = hasSearchText || !ignoreCache;
            var cachedCards = allowCacheSeed
                ? await TryLoadCachedVersionCardsAsync(versionQuery, cancellationToken, cacheQueryKey)
                : null;

            if (cachedCards is not null)
            {
                _fetchedMods.Clear();
                _fetchedMods.AddRange(cachedCards);

                HasNoMods = _fetchedMods.Count == 0;
                StatusText = WithReleaseCutoffHint(HasNoMods
                    ? $"No workshop mods found for {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for {versionQuery} (cached).", versionQuery);

                ApplyModStateToCards();
                ApplyFilter();
                QueueThumbnailWarm(_fetchedMods.ToList());

                if (!hasSearchText)
                    return;
            }

            if (hasSearchText)
            {
                await EnrichSearchResultsInBackgroundAsync(versionQuery, searchText, searchQueries, cancellationToken);
                return;
            }

            var ids = await FetchCandidateWorkshopIdsAsync(searchQueries, cancellationToken, Math.Max(FetchLimit, DefaultFetchLimit));
            cancellationToken.ThrowIfCancellationRequested();

            var cards = await ResolveWorkshopCardsAsync(versionQuery, ids, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            if (!hasSearchText)
                await SaveCachedVersionCardsAsync(versionQuery, cards, cancellationToken, cacheQueryKey);

            _fetchedMods.Clear();
            _fetchedMods.AddRange(cards);

            HasNoMods = _fetchedMods.Count == 0;
            if (hasSearchText)
            {
                StatusText = WithReleaseCutoffHint(HasNoMods
                    ? $"No mods found for '{searchText}' in {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for '{searchText}' in {versionQuery}.", versionQuery);
            }
            else
            {
                StatusText = WithReleaseCutoffHint(HasNoMods
                    ? $"No workshop mods found for {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for {versionQuery}.", versionQuery);
            }

            ApplyModStateToCards();
            ApplyFilter();
            QueueThumbnailWarm(_fetchedMods.ToList());
        }
        catch (OperationCanceledException)
        {
            // A newer selection canceled this request.
        }
        catch (Exception ex)
        {
            if (!hadExistingResults)
            {
                _fetchedMods.Clear();
                DisplayedMods.Clear();
                DisplayedModCount = 0;
                HasNoMods = true;
            }

            StatusText = $"Workshop search failed: {ex.Message}";
        }
        finally
        {
            if (ReferenceEquals(_refreshCts, refreshCts))
            {
                IsLoading = false;
                _refreshCts = null;
            }

            refreshCts.Dispose();
        }
    }

    private async Task EnrichSearchResultsInBackgroundAsync(
        string versionQuery,
        string searchText,
        IReadOnlyList<string> searchQueries,
        CancellationToken cancellationToken)
    {
        await AppendSearchMatchesAsync(versionQuery, searchText, searchQueries, cancellationToken);

        HasNoMods = _fetchedMods.Count == 0;
        StatusText = WithReleaseCutoffHint(DisplayedModCount == 0
            ? $"No mods found for '{searchText}' in {versionQuery}."
            : $"Loaded {DisplayedModCount} mods for '{searchText}' in {versionQuery}.", versionQuery);
    }

    private async Task AppendSearchMatchesAsync(
        string versionQuery,
        string searchText,
        IReadOnlyList<string> searchQueries,
        CancellationToken cancellationToken)
    {
        var knownIds = new HashSet<string>(_fetchedMods.Select(m => m.WorkshopId), StringComparer.Ordinal);
        var appendedSinceCacheSave = 0;
        var emptyPageStreak = 0;

        for (var page = 1; page <= SearchBackgroundPageLimit; page++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var pageIds = await FetchCandidateWorkshopIdsForPageAsync(searchQueries, cancellationToken, page, knownIds);
            cancellationToken.ThrowIfCancellationRequested();

            if (pageIds.Count == 0)
            {
                emptyPageStreak++;
                if (emptyPageStreak >= 3)
                    break;

                continue;
            }

            emptyPageStreak = 0;

            foreach (var chunk in pageIds.Chunk(24))
            {
                cancellationToken.ThrowIfCancellationRequested();

                var cards = await ResolveWorkshopCardsAsync(versionQuery, chunk.ToList(), cancellationToken, maxCount: null);
                cancellationToken.ThrowIfCancellationRequested();

                var appended = AppendCards(cards, targetCount: null);
                if (appended.Count == 0)
                    continue;

                appendedSinceCacheSave += appended.Count;
                ApplyModStateToCards();
                ApplyFilter();
                QueueThumbnailWarm(appended);

                if (appendedSinceCacheSave >= SearchCacheFlushBatchSize)
                {
                    await SaveCachedVersionCardsAsync(versionQuery, _fetchedMods, cancellationToken, searchText);
                    appendedSinceCacheSave = 0;
                }

                StatusText = WithReleaseCutoffHint(
                    $"Searching '{searchText}' in {versionQuery}... {DisplayedModCount} match(es), scanned page {page}/{SearchBackgroundPageLimit}",
                    versionQuery);
            }
        }

        await SaveCachedVersionCardsAsync(versionQuery, _fetchedMods, cancellationToken, searchText);
    }

    private async Task<List<string>> FetchCandidateWorkshopIdsForPageAsync(
        IReadOnlyList<string> searchQueries,
        CancellationToken cancellationToken,
        int page,
        HashSet<string> knownIds)
    {
        var found = new List<string>();

        foreach (var query in searchQueries)
        {
            foreach (var sort in GetWorkshopBrowseSorts())
            {
                var url = BuildWorkshopBrowseUrl(query, sort, page);
                var html = await WorkshopHttp.GetStringAsync(url, cancellationToken);

                foreach (Match match in WorkshopIdRegex.Matches(html))
                {
                    var id = match.Groups["id"].Value;
                    if (string.IsNullOrWhiteSpace(id))
                        continue;

                    if (!knownIds.Add(id))
                        continue;

                    found.Add(id);
                }
            }
        }

        return found;
    }

    private void QueueThumbnailWarm(IReadOnlyList<VersionModCard> cards)
    {
        var cts = new CancellationTokenSource();
        var previous = Interlocked.Exchange(ref _thumbnailWarmCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        _ = WarmCardThumbnailsAsync(cards, cts.Token)
            .ContinueWith(_ =>
            {
                if (ReferenceEquals(_thumbnailWarmCts, cts))
                    _thumbnailWarmCts = null;

                cts.Dispose();
            }, TaskScheduler.Default);
    }

    private async Task<List<string>> FetchCandidateWorkshopIdsAsync(IReadOnlyList<string> searchQueries, CancellationToken cancellationToken)
        => await FetchCandidateWorkshopIdsAsync(searchQueries, cancellationToken, Math.Max(DefaultFetchLimit, 24));

    private async Task<List<string>> FetchCandidateWorkshopIdsAsync(
        IReadOnlyList<string> searchQueries,
        CancellationToken cancellationToken,
        int desiredCount)
    {
        var dedupe = new HashSet<string>(StringComparer.Ordinal);
        var ordered = new List<string>();
        var targetCount = Math.Max(desiredCount, 24);
        var hardCap = Math.Max(targetCount * 2, targetCount);

        foreach (var query in searchQueries)
        {
            foreach (var sort in GetWorkshopBrowseSorts())
            {
                for (var page = 1; page <= 6; page++)
                {
                    var url = BuildWorkshopBrowseUrl(query, sort, page);
                    var html = await WorkshopHttp.GetStringAsync(url, cancellationToken);

                    foreach (Match match in WorkshopIdRegex.Matches(html))
                    {
                        var id = match.Groups["id"].Value;
                        if (string.IsNullOrWhiteSpace(id))
                            continue;

                        if (dedupe.Add(id))
                            ordered.Add(id);

                        if (ordered.Count >= hardCap)
                            return ordered;
                    }
                }
            }

            if (ordered.Count >= targetCount)
                return ordered;
        }

        return ordered;
    }

    private IReadOnlyList<string> GetWorkshopBrowseSorts()
    {
        return SelectedSortMode?.Mode switch
        {
            VersionSortMode.MostSubscribed => MostSubscribedBrowseSorts,
            VersionSortMode.MostPopular => MostPopularBrowseSorts,
            _ => RelevanceBrowseSorts,
        };
    }

    private async Task<List<VersionModCard>> ResolveWorkshopCardsAsync(
        string versionQuery,
        List<string> ids,
        CancellationToken cancellationToken,
        int? maxCount = null)
    {
        if (ids.Count == 0)
            return new List<VersionModCard>();

        var targetCount = maxCount is null ? int.MaxValue : Math.Max(maxCount.Value, 1);
        var topIds = maxCount is null
            ? ids
            : ids.Take(Math.Max(targetCount * 2, targetCount)).ToList();
        var semaphore = new SemaphoreSlim(MetadataResolveConcurrency);

        var tasks = topIds.Select(async (id, index) =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var info = await _downloader.GetModInfoAsync(id);
                var name = string.IsNullOrWhiteSpace(info?.Title) ? $"Workshop {id}" : info.Title;
                var previewImageUrl = NormalizePreviewUrl(info?.PreviewImageUrl);
                var versionEvidenceTokens = BuildVersionEvidenceTokens(info, name);

                var card = new VersionModCard
                {
                    WorkshopId = id,
                    Name = name,
                    VersionEvidenceTokens = versionEvidenceTokens,
                    PreviewImageUrl = previewImageUrl,
                    GameVersionBadge = GetConfirmedGameVersionBadge(id, versionQuery),
                    CommunityWorksCount = GetCommunityWorksCount(id, versionQuery),
                    CommunityNotWorksCount = GetCommunityNotWorksCount(id, versionQuery),
                    PublishedAtUnixSeconds = info?.TimeCreated ?? 0,
                    UpdatedAtUnixSeconds = info?.TimeUpdated ?? 0,
                    TotalSubscribers = info?.TotalSubscribers ?? 0,
                    PopularitySignal = ComputePopularitySignal(info),
                    ActionState = GetEffectiveState(id)
                };

                return new IndexedCard(index, card);
            }
            finally
            {
                semaphore.Release();
            }
        });

        var cards = await Task.WhenAll(tasks);
        var releaseCutoffExcludedInBatch = 0;
        var excludePatchPinned = ShouldExcludePatchPinnedForSelection(versionQuery);

        var filtered = cards
            .OrderBy(c => c.Index)
            .Select(c => c.Card)
            .Where(c => ShouldIncludeForSelectedVersion(versionQuery, c, excludePatchPinned, out var excludedByReleaseCutoff)
                ? true
                : CountReleaseCutoffExclusion(ref releaseCutoffExcludedInBatch, excludedByReleaseCutoff))
            .Take(maxCount ?? int.MaxValue)
            .ToList();

        _releaseCutoffExcludedCount += releaseCutoffExcludedInBatch;
        return filtered;
    }

    private async Task<List<VersionModCard>?> TryLoadCachedVersionCardsAsync(
        string versionQuery,
        CancellationToken cancellationToken,
        string? searchText = null)
    {
        var cacheKey = BuildResultCacheKey(versionQuery, searchText);
        if (_versionResultCache.TryGetValue(cacheKey, out var memoryCached))
        {
            if (DateTimeOffset.UtcNow - memoryCached.CachedAtUtc <= ResultCacheTtl)
                return await BuildCardsFromCachedEntriesAsync(
                    versionQuery,
                    memoryCached.Mods,
                    cancellationToken,
                    includeAll: !string.IsNullOrWhiteSpace(searchText));
        }

        var cachePath = GetResultCachePath(versionQuery, searchText);
        if (!File.Exists(cachePath))
            return null;

        try
        {
            var json = await File.ReadAllTextAsync(cachePath, cancellationToken);
            var diskCached = JsonSerializer.Deserialize<CachedVersionResult>(json);
            if (diskCached is null)
                return null;

            if (DateTimeOffset.UtcNow - diskCached.CachedAtUtc > ResultCacheTtl)
                return null;

            _versionResultCache[cacheKey] = diskCached;
            return await BuildCardsFromCachedEntriesAsync(
                versionQuery,
                diskCached.Mods,
                cancellationToken,
                includeAll: !string.IsNullOrWhiteSpace(searchText));
        }
        catch
        {
            try
            {
                File.Delete(cachePath);
            }
            catch
            {
                // Best-effort cleanup for malformed cache files.
            }

            return null;
        }
    }

    private async Task SaveCachedVersionCardsAsync(
        string versionQuery,
        IEnumerable<VersionModCard> cards,
        CancellationToken cancellationToken,
        string? searchText = null)
    {
        var cappedCards = cards.Take(MaxCachedCardsPerQuery).ToList();
        var cached = new CachedVersionResult
        {
            CachedAtUtc = DateTimeOffset.UtcNow,
            Mods = cappedCards.Select(c => new CachedVersionModEntry
            {
                WorkshopId = c.WorkshopId,
                Name = c.Name,
                VersionEvidenceTokens = c.VersionEvidenceTokens,
                PreviewImageUrl = c.PreviewImageUrl,
                PublishedAtUnixSeconds = c.PublishedAtUnixSeconds,
                UpdatedAtUnixSeconds = c.UpdatedAtUnixSeconds,
                TotalSubscribers = c.TotalSubscribers,
                PopularitySignal = c.PopularitySignal
            }).ToList()
        };

        var cacheKey = BuildResultCacheKey(versionQuery, searchText);
        _versionResultCache[cacheKey] = cached;

        try
        {
            var cachePath = GetResultCachePath(versionQuery, searchText);
            var json = JsonSerializer.Serialize(cached);

            // Write through temp file first to reduce chances of truncated cache files.
            var tempPath = cachePath + ".tmp";
            await File.WriteAllTextAsync(tempPath, json, CancellationToken.None);

            if (File.Exists(cachePath))
                File.Replace(tempPath, cachePath, null, true);
            else
                File.Move(tempPath, cachePath);
        }
        catch
        {
            // Best effort cache write.
        }
    }

    private async Task<List<VersionModCard>> BuildCardsFromCachedEntriesAsync(
        string versionQuery,
        List<CachedVersionModEntry> mods,
        CancellationToken cancellationToken,
        bool includeAll = false)
    {
        if (mods.Count == 0)
            return new List<VersionModCard>();

        var limited = includeAll ? mods : mods.Take(Math.Max(FetchLimit, 1)).ToList();
        var cards = limited
            .Select((item, index) => new IndexedCard(index, new VersionModCard
            {
                WorkshopId = item.WorkshopId,
                Name = string.IsNullOrWhiteSpace(item.Name) ? $"Workshop {item.WorkshopId}" : item.Name,
                VersionEvidenceTokens = item.VersionEvidenceTokens,
                PreviewImageUrl = item.PreviewImageUrl,
                GameVersionBadge = GetConfirmedGameVersionBadge(item.WorkshopId, versionQuery),
                CommunityWorksCount = GetCommunityWorksCount(item.WorkshopId, versionQuery),
                CommunityNotWorksCount = GetCommunityNotWorksCount(item.WorkshopId, versionQuery),
                PublishedAtUnixSeconds = item.PublishedAtUnixSeconds,
                UpdatedAtUnixSeconds = item.UpdatedAtUnixSeconds,
                TotalSubscribers = item.TotalSubscribers,
                PopularitySignal = item.PopularitySignal,
                ActionState = GetEffectiveState(item.WorkshopId)
            }))
            .ToList();

        await Task.CompletedTask;
        var releaseCutoffExcludedInBatch = 0;
        var excludePatchPinned = ShouldExcludePatchPinnedForSelection(versionQuery);

        var filtered = cards
            .OrderBy(c => c.Index)
            .Select(c => c.Card)
            .Where(c => ShouldIncludeForSelectedVersion(versionQuery, c, excludePatchPinned, out var excludedByReleaseCutoff)
                ? true
                : CountReleaseCutoffExclusion(ref releaseCutoffExcludedInBatch, excludedByReleaseCutoff))
            .ToList();

        _releaseCutoffExcludedCount += releaseCutoffExcludedInBatch;
        return filtered;
    }

    private async Task WarmCardThumbnailsAsync(IReadOnlyList<VersionModCard> cards, CancellationToken cancellationToken)
    {
        var semaphore = new SemaphoreSlim(2);

        var tasks = cards
            .Where(c => !string.IsNullOrWhiteSpace(c.PreviewImageUrl))
            .Select(async card =>
            {
                await semaphore.WaitAsync(cancellationToken);
                try
                {
                    if (cancellationToken.IsCancellationRequested)
                        return;

                    var bitmap = await LoadThumbnailBitmapAsync(card.WorkshopId, card.PreviewImageUrl, cancellationToken);
                    if (bitmap is null || cancellationToken.IsCancellationRequested)
                        return;

                    Dispatcher.UIThread.Post(() =>
                    {
                        card.ThumbnailImage = bitmap;
                    });
                }
                catch (OperationCanceledException)
                {
                    // Ignore canceled thumbnail work.
                }
                finally
                {
                    semaphore.Release();
                }
            });

        try
        {
            await Task.WhenAll(tasks);
        }
        catch (OperationCanceledException)
        {
            // Ignore canceled thumbnail work.
        }
    }

    private void ApplyFilter()
    {
        IEnumerable<VersionModCard> filtered = _fetchedMods;
        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            var lower = SearchText.ToLowerInvariant();
            filtered = filtered.Where(m => m.Name.ToLowerInvariant().Contains(lower));
        }

        _orderedFilteredMods = OrderFilteredMods(filtered, SearchText).ToList();

        var pages = _orderedFilteredMods.Count == 0
            ? 1
            : (int)Math.Ceiling((double)_orderedFilteredMods.Count / ResultPageSize);

        TotalResultPages = pages;

        if (CurrentResultPage > TotalResultPages)
            CurrentResultPage = TotalResultPages;
        else if (CurrentResultPage < 1)
            CurrentResultPage = 1;

        ApplyPagedResults();
    }

    private void ApplyPagedResults()
    {
        DisplayedMods.Clear();

        var skip = (CurrentResultPage - 1) * ResultPageSize;
        foreach (var mod in _orderedFilteredMods.Skip(skip).Take(ResultPageSize))
            DisplayedMods.Add(mod);

        DisplayedModCount = _orderedFilteredMods.Count;
    }

    private IEnumerable<VersionModCard> OrderFilteredMods(IEnumerable<VersionModCard> mods, string searchText)
    {
        var mode = SelectedSortMode?.Mode ?? VersionSortMode.Relevance;
        var trimmedSearch = searchText.Trim();
        var hasSearch = !string.IsNullOrWhiteSpace(trimmedSearch);

        return mode switch
        {
            VersionSortMode.MostSubscribed => mods
                .OrderByDescending(m => m.TotalSubscribers)
                .ThenByDescending(m => m.PopularitySignal)
                .ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(m => m.WorkshopId, StringComparer.Ordinal),
            VersionSortMode.MostPopular => mods
                .OrderByDescending(m => m.PopularitySignal)
                .ThenByDescending(m => m.TotalSubscribers)
                .ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(m => m.WorkshopId, StringComparer.Ordinal),
            _ when hasSearch => mods
                .OrderByDescending(m => ComputeRelevanceScore(m.Name, trimmedSearch))
                .ThenByDescending(m => m.PopularitySignal)
                .ThenByDescending(m => m.TotalSubscribers)
                .ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(m => m.WorkshopId, StringComparer.Ordinal),
            _ => mods
                .OrderByDescending(m => m.PopularitySignal)
                .ThenByDescending(m => m.TotalSubscribers)
                .ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(m => m.WorkshopId, StringComparer.Ordinal)
        };
    }

    private static int ComputeRelevanceScore(string name, string search)
    {
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(search))
            return 0;

        var nameLower = name.ToLowerInvariant();
        var searchLower = search.ToLowerInvariant();
        if (nameLower == searchLower)
            return 400;

        if (nameLower.StartsWith(searchLower, StringComparison.Ordinal))
            return 300;

        var tokenScore = searchLower
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Count(token => nameLower.Contains(token, StringComparison.Ordinal));

        if (tokenScore > 0)
            return 200 + tokenScore;

        return nameLower.Contains(searchLower, StringComparison.Ordinal) ? 100 : 0;
    }

    private static double ComputePopularitySignal(WorkshopModInfo? info)
    {
        if (info is null)
            return 0;

        var signal = 0d;

        if (info.PopularityScore > 0)
            signal += info.PopularityScore * 1000d;

        if (info.FavoritedCount > 0)
            signal += Math.Log10(info.FavoritedCount + 1) * 120d;

        if (info.ViewCount > 0)
            signal += Math.Log10(info.ViewCount + 1) * 80d;

        if (info.TotalSubscribers > 0)
            signal += Math.Log10(info.TotalSubscribers + 1) * 60d;

        return signal;
    }

    private void ApplyModStateToCards()
    {
        foreach (var card in _fetchedMods)
            card.ActionState = GetEffectiveState(card.WorkshopId);
    }

    private void NotifyOverlayStateChanged()
    {
        OverlayStateVersion++;
    }

    private string GetEffectiveState(string workshopId)
    {
        if (string.IsNullOrWhiteSpace(workshopId))
            return "not-installed";

        if (_modStates.TryGetValue(workshopId, out var state))
        {
            if (!string.Equals(state, "not-installed", StringComparison.OrdinalIgnoreCase))
                return state;
        }

        if (_installedWorkshopIds.Contains(workshopId))
            return "installed";

        return "not-installed";
    }

    private static async Task<Bitmap?> LoadThumbnailBitmapAsync(string workshopId, string? previewImageUrl, CancellationToken cancellationToken)
    {
        var normalized = NormalizePreviewUrl(previewImageUrl);
        if (normalized is null)
            return null;

        try
        {
            var uri = new Uri(normalized, UriKind.Absolute);
            var ext = Path.GetExtension(uri.AbsolutePath);
            if (string.IsNullOrWhiteSpace(ext) || ext.Length > 8)
                ext = ".jpg";

            var fileName = $"{workshopId}{ext.ToLowerInvariant()}";
            var cachePath = Path.Combine(ThumbnailCacheDir, fileName);

            if (File.Exists(cachePath))
            {
                var info = new FileInfo(cachePath);
                if (info.Length > 0)
                {
                    var cachedBitmap = TryLoadBitmapFromFile(cachePath);
                    if (cachedBitmap is not null)
                        return cachedBitmap;

                    try
                    {
                        File.Delete(cachePath);
                    }
                    catch
                    {
                        // Best-effort delete of bad cache file.
                    }
                }
            }

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Referrer = new Uri("https://steamcommunity.com/workshop/browse/?appid=281990");
            using var response = await WorkshopHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (bytes.Length == 0)
                return null;

            await File.WriteAllBytesAsync(cachePath, bytes, cancellationToken);
            return TryLoadBitmapFromFile(cachePath);
        }
        catch
        {
            return null;
        }
    }

    private static Bitmap? TryLoadBitmapFromFile(string path)
    {
        try
        {
            return new Bitmap(path);
        }
        catch
        {
            return null;
        }
    }

    private static string? NormalizePreviewUrl(string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
            return null;

        var url = WebUtility.HtmlDecode(rawUrl).Trim();
        if (url.StartsWith("//", StringComparison.Ordinal))
            url = "https:" + url;

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return null;

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return null;

        return uri.ToString();
    }

    private static string GetResultCachePath(string versionQuery)
    {
        var cacheKey = BuildResultCacheKey(versionQuery, null);
        var safeName = string.Join("_", cacheKey.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
        if (string.IsNullOrWhiteSpace(safeName))
            safeName = "unknown";

        return Path.Combine(ResultCacheDir, $"{safeName}.json");
    }

    private static string GetResultCachePath(string versionQuery, string? searchText)
    {
        var cacheKey = BuildResultCacheKey(versionQuery, searchText);
        var safeName = string.Join("_", cacheKey.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
        if (string.IsNullOrWhiteSpace(safeName))
            safeName = "unknown";

        return Path.Combine(ResultCacheDir, $"{safeName}.json");
    }

    private static string BuildResultCacheKey(string versionQuery, string? searchText)
    {
        var version = (versionQuery ?? string.Empty).Trim();
        var search = (searchText ?? string.Empty).Trim().ToLowerInvariant();

        return string.IsNullOrWhiteSpace(search)
            ? version
            : $"{version}__q__{search}";
    }

    private static string BuildWorkshopBrowseUrl(string versionQuery, string sort, int page)
    {
        var query = WebUtility.UrlEncode(versionQuery);
        return $"https://steamcommunity.com/workshop/browse/?appid=281990&searchtext={query}&childpublishedfileid=0&browsesort={sort}&section=readytouseitems&actualsort={sort}&days=-1&p={page}";
    }

    private static IReadOnlyList<string> GetVersionSearchQueries(string versionQuery)
    {
        var queries = new List<string>();
        var selectedToken = ExtractVersionToken(versionQuery) ?? versionQuery.Trim();

        if (!string.IsNullOrWhiteSpace(selectedToken))
            queries.Add(selectedToken);

        // For patch selections, also search the parent major.minor stream.
        // This keeps exact-match priority while still surfacing recently-compatible mods.
        var patchMatch = Regex.Match(selectedToken, @"^(?<major>\d+)\.(?<minor>\d+)\.\d+$");
        if (patchMatch.Success)
        {
            var majorMinor = $"{patchMatch.Groups["major"].Value}.{patchMatch.Groups["minor"].Value}";
            if (!queries.Contains(majorMinor, StringComparer.OrdinalIgnoreCase))
                queries.Add(majorMinor);
        }

        var normalized = StellarisVersions.Normalize(selectedToken);
        if (!string.IsNullOrWhiteSpace(normalized) &&
            !queries.Contains(normalized, StringComparer.OrdinalIgnoreCase))
        {
            queries.Add(normalized);
        }

        return queries;
    }

    private static IReadOnlyList<string> GetWorkshopSearchQueries(string versionQuery, string? modNameSearch)
    {
        var name = modNameSearch?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return GetVersionSearchQueries(versionQuery);

        var queries = new List<string>();
        var versionToken = ExtractVersionToken(versionQuery) ?? versionQuery.Trim();

        // Run name-only first so exact-title searches are not crowded out by broader version tokens.
        queries.Add(name);

        if (!string.IsNullOrWhiteSpace(versionToken))
            queries.Add($"{name} {versionToken}");

        var patchMatch = Regex.Match(versionToken, @"^(?<major>\d+)\.(?<minor>\d+)\.\d+$");
        if (patchMatch.Success)
        {
            var majorMinor = $"{patchMatch.Groups["major"].Value}.{patchMatch.Groups["minor"].Value}";
            queries.Add($"{name} {majorMinor}");
        }

        var normalizedVersion = StellarisVersions.Normalize(versionToken);
        if (!string.IsNullOrWhiteSpace(normalizedVersion) &&
            !string.Equals(normalizedVersion, versionToken, StringComparison.OrdinalIgnoreCase))
        {
            queries.Add($"{name} {normalizedVersion}");
        }

        return queries
            .Where(q => !string.IsNullOrWhiteSpace(q))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool CountReleaseCutoffExclusion(ref int accumulator, bool excludedByReleaseCutoff)
    {
        if (excludedByReleaseCutoff)
            accumulator++;

        return false;
    }

    private string WithReleaseCutoffHint(string status, string versionQuery)
    {
        if (_releaseCutoffExcludedCount <= 0)
            return status;

        if (!StellarisVersions.TryGetReleaseDateUtc(versionQuery, out var releaseDateUtc))
            return status;

        return $"{status} Release cutoff hid {_releaseCutoffExcludedCount} older mod(s) (before {releaseDateUtc:MMM d, yyyy}).";
    }

    private static string BuildVersionEvidenceTokens(WorkshopModInfo? info, string fallbackName)
    {
        var tokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        static void AddTokens(HashSet<string> tokenSet, string? text)
        {
            if (string.IsNullOrWhiteSpace(text))
                return;

            foreach (Match match in AnyVersionRegex.Matches(text))
            {
                var token = match.Value;
                if (!string.IsNullOrWhiteSpace(token))
                    tokenSet.Add(token);
            }
        }

        AddTokens(tokens, info?.Title);
        AddTokens(tokens, info?.Description);

        if (info?.Tags is { Count: > 0 })
        {
            foreach (var tag in info.Tags)
                AddTokens(tokens, tag);
        }

        if (tokens.Count == 0)
            AddTokens(tokens, fallbackName);

        return string.Join(',', tokens);
    }

    private static bool HasSelectedVersionEvidence(string selectedToken, string? evidenceTokens)
    {
        if (string.IsNullOrWhiteSpace(selectedToken) || string.IsNullOrWhiteSpace(evidenceTokens))
            return false;

        var selectedMajorMinor = StellarisVersions.Normalize(selectedToken) ?? selectedToken;
        var tokens = evidenceTokens.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var token in tokens)
        {
            if (string.Equals(token, selectedToken, StringComparison.OrdinalIgnoreCase))
                return true;

            var tokenMajorMinor = StellarisVersions.Normalize(token) ?? token;
            if (string.Equals(tokenMajorMinor, selectedMajorMinor, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static bool ShouldIncludeForSelectedVersion(
        string versionQuery,
        VersionModCard modCard,
        bool excludePatchPinned,
        out bool excludedByReleaseCutoff)
    {
        excludedByReleaseCutoff = false;

        if (string.IsNullOrWhiteSpace(versionQuery) || modCard is null)
            return true;

        var modName = modCard.Name;
        if (string.IsNullOrWhiteSpace(modName))
            return true;

        if (modCard.TotalSubscribers <= 0)
            return false;

        var selectedToken = ExtractVersionToken(versionQuery);
        if (string.IsNullOrWhiteSpace(selectedToken))
            return true;

        if (!HasSelectedVersionEvidence(selectedToken, modCard.VersionEvidenceTokens))
            return false;

        // For major.minor pages (e.g. 4.2), exclude explicitly patch-pinned mods (e.g. 4.2.4).
        if (excludePatchPinned && Regex.IsMatch(selectedToken, @"^\d+\.\d+$"))
        {
            var patchRegex = new Regex($@"^{Regex.Escape(selectedToken)}\.\d+$", RegexOptions.IgnoreCase);
            var evidenceTokens = modCard.VersionEvidenceTokens.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (evidenceTokens.Any(token => patchRegex.IsMatch(token)))
                return false;
        }

        // Keep mods visible if they were updated after the selected version release date,
        // even when the original upload date is older.
        if (StellarisVersions.TryGetReleaseDateUtc(versionQuery, out var releaseDateUtc))
        {
            var activityUnixSeconds = modCard.UpdatedAtUnixSeconds > 0
                ? modCard.UpdatedAtUnixSeconds
                : modCard.PublishedAtUnixSeconds;

            if (activityUnixSeconds > 0)
            {
                var lastActivityUtc = DateTimeOffset.FromUnixTimeSeconds(activityUnixSeconds);
                if (lastActivityUtc < releaseDateUtc)
                {
                    excludedByReleaseCutoff = true;
                    return false;
                }
            }
        }

        return true;
    }

    private bool ShouldExcludePatchPinnedForSelection(string versionQuery)
    {
        var selectedToken = ExtractVersionToken(versionQuery);
        if (string.IsNullOrWhiteSpace(selectedToken))
            return false;

        if (!Regex.IsMatch(selectedToken, @"^\d+\.\d+$"))
            return false;

        var prefix = selectedToken + ".";
        return VersionItems.Any(v =>
            !string.IsNullOrWhiteSpace(v.Version) &&
            v.Version.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
    }

    private static List<string> GetVersionQueries(bool includeOlder)
    {
        var preferred = new List<string>
        {
            "4.3",
            "4.2.4",
            "4.2",
            "4.1",
            "4.0",
            "3.14",
            "3.13",
            "3.12",
            "3.11",
            "3.10"
        };

        var dedupe = new HashSet<string>(preferred, StringComparer.Ordinal);
        var knownVersions = StellarisVersions.KnownVersions.Keys
            .Where(v => includeOlder || StellarisVersions.IsRecent(v))
            .OrderByDescending(v => v, VersionComparer.Instance);

        foreach (var version in knownVersions)
        {
            if (dedupe.Add(version))
                preferred.Add(version);
        }

        return preferred;
    }

    private static string GetDisplayName(string version)
    {
        var normalized = StellarisVersions.Normalize(version) ?? version;
        if (StellarisVersions.KnownVersions.TryGetValue(normalized, out var codename))
            return $"{version} - {codename}";

        return version;
    }

    private static string NormalizeState(string? state)
    {
        if (string.IsNullOrWhiteSpace(state))
            return "not-installed";

        return state.Trim().ToLowerInvariant() switch
        {
            "queued" => "queued",
            "installing" => "installing",
            "installed" => "installed",
            "uninstalling" => "uninstalling",
            "error" => "error",
            _ => "not-installed"
        };
    }

    private static HttpClient BuildWorkshopHttpClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(25) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) StellarisModManager/1.0");
        client.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        return client;
    }

    private sealed record IndexedCard(int Index, VersionModCard Card);

    private sealed class CachedVersionResult
    {
        public DateTimeOffset CachedAtUtc { get; set; }
        public List<CachedVersionModEntry> Mods { get; set; } = new();
    }

    private sealed class CachedVersionModEntry
    {
        public string WorkshopId { get; set; } = "";
        public string Name { get; set; } = "";
        public string VersionEvidenceTokens { get; set; } = "";
        public string? PreviewImageUrl { get; set; }
        public long PublishedAtUnixSeconds { get; set; }
        public long UpdatedAtUnixSeconds { get; set; }
        public long TotalSubscribers { get; set; }
        public double PopularitySignal { get; set; }
    }

    private sealed class VersionComparer : IComparer<string>
    {
        public static readonly VersionComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            if (ReferenceEquals(x, y)) return 0;
            if (x is null) return -1;
            if (y is null) return 1;

            var xv = ParseVersionParts(x);
            var yv = ParseVersionParts(y);

            for (var i = 0; i < 3; i++)
            {
                var cmp = xv[i].CompareTo(yv[i]);
                if (cmp != 0) return cmp;
            }

            return string.CompareOrdinal(x, y);
        }

        private static int[] ParseVersionParts(string input)
        {
            var normalized = StellarisVersions.Normalize(input) ?? input;
            var parts = normalized.Split('.', StringSplitOptions.RemoveEmptyEntries);
            var values = new[] { 0, 0, 0 };

            for (var i = 0; i < values.Length && i < parts.Length; i++)
            {
                if (int.TryParse(parts[i], out var value))
                    values[i] = value;
            }

            return values;
        }
    }
}

public enum VersionSortMode
{
    Relevance,
    MostSubscribed,
    MostPopular
}

public sealed class VersionSortModeItem
{
    public VersionSortModeItem(VersionSortMode mode, string displayName)
    {
        Mode = mode;
        DisplayName = displayName;
    }

    public VersionSortMode Mode { get; }
    public string DisplayName { get; }

    public override string ToString() => DisplayName;
}

public sealed class VersionDropdownItem
{
    public string Version { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public string DropdownText => DisplayName;

    public override string ToString() => DropdownText;
}

public sealed partial class VersionModCard : ObservableObject
{
    private Bitmap? _thumbnailImage;
    private string _actionState = "not-installed";
    private bool _isActionHovered;

    public string WorkshopId { get; init; } = "";
    public string Name { get; init; } = "";
    public string VersionEvidenceTokens { get; init; } = "";
    public string GameVersionBadge { get; init; } = "Unknown";
    public string? PreviewImageUrl { get; init; }
    public long PublishedAtUnixSeconds { get; init; }
    public long UpdatedAtUnixSeconds { get; init; }
    public long TotalSubscribers { get; init; }
    public double PopularitySignal { get; init; }
    public int CommunityWorksCount { get; init; }
    public int CommunityNotWorksCount { get; init; }

    public Bitmap? ThumbnailImage
    {
        get => _thumbnailImage;
        set
        {
            if (!SetProperty(ref _thumbnailImage, value))
                return;

            OnPropertyChanged(nameof(HasThumbnail));
        }
    }

    public string ActionState
    {
        get => _actionState;
        set
        {
            var normalized = NormalizeActionState(value);
            if (!SetProperty(ref _actionState, normalized))
                return;

            OnPropertyChanged(nameof(ActionButtonText));
            OnPropertyChanged(nameof(IsActionEnabled));
            OnPropertyChanged(nameof(IsInstalledState));
            OnPropertyChanged(nameof(IsBusyState));
            OnPropertyChanged(nameof(IsErrorState));
            OnPropertyChanged(nameof(ActionButtonTooltip));
        }
    }

    public bool IsActionHovered
    {
        get => _isActionHovered;
        set
        {
            if (!SetProperty(ref _isActionHovered, value))
                return;

            OnPropertyChanged(nameof(ActionButtonText));
        }
    }

    public bool HasThumbnail => ThumbnailImage is not null;
    public string PlaceholderLetter => string.IsNullOrWhiteSpace(Name) ? "?" : Name[0].ToString().ToUpperInvariant();
    public int CommunityTotalReports => CommunityWorksCount + CommunityNotWorksCount;
    public int CommunityWorksPercent => CommunityTotalReports <= 0
        ? 0
        : (int)Math.Round((double)CommunityWorksCount * 100d / CommunityTotalReports, MidpointRounding.AwayFromZero);
    public bool HasCommunityWorks => CommunityTotalReports > 0;
    public string CommunityWorksBadge => CommunityWorksCount switch
    {
        <= 0 when CommunityTotalReports <= 0 => string.Empty,
        _ => $"✅ {CommunityWorksPercent}% work ({CommunityTotalReports} report{(CommunityTotalReports == 1 ? "" : "s")})"
    };
    public string SubscriberSummary => TotalSubscribers > 0 ? $"{TotalSubscribers:N0} subscribers" : "New / low data";

    public bool IsInstalledState => string.Equals(ActionState, "installed", StringComparison.OrdinalIgnoreCase);
    public bool IsBusyState => ActionState is "queued" or "installing" or "uninstalling";
    public bool IsErrorState => string.Equals(ActionState, "error", StringComparison.OrdinalIgnoreCase);

    public bool IsActionEnabled => ActionState is "not-installed" or "installed" or "error";

    public string ActionButtonText => ActionState switch
    {
        "queued" => "Queued",
        "installing" => "Installing...",
        "installed" => IsActionHovered ? "Uninstall" : "Installed",
        "uninstalling" => "Uninstalling...",
        "error" => "Retry Install",
        _ => "Install"
    };

    public string ActionButtonTooltip => ActionState switch
    {
        "queued" => "This mod is queued for installation",
        "installing" => "This mod is currently installing",
        "installed" => "Click to uninstall this mod",
        "uninstalling" => "This mod is currently uninstalling",
        "error" => "Retry installing this mod",
        _ => "Install this mod"
    };

    private static string NormalizeActionState(string? state)
    {
        if (string.IsNullOrWhiteSpace(state))
            return "not-installed";

        return state.Trim().ToLowerInvariant() switch
        {
            "queued" => "queued",
            "installing" => "installing",
            "installed" => "installed",
            "uninstalling" => "uninstalling",
            "error" => "error",
            _ => "not-installed"
        };
    }
}
