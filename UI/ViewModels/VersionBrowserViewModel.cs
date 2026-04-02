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
    private const string CacheSchemaVersion = "2";
    private static readonly Regex AnyVersionRegex = new(@"\b\d+\.\d+(?:\.\d+)?\b", RegexOptions.Compiled);
    private static readonly HttpClient WorkshopHttp = BuildWorkshopHttpClient();
    private static readonly Regex WorkshopIdRegex = new(@"sharedfiles/filedetails/\?id=(?<id>\d+)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
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
    private CancellationTokenSource? _refreshCts;
    private CancellationTokenSource? _thumbnailWarmCts;

    public ObservableCollection<VersionDropdownItem> VersionItems { get; } = new();
    public ObservableCollection<VersionModCard> DisplayedMods { get; } = new();

    [ObservableProperty] private VersionDropdownItem? _selectedVersion;
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private bool _showOlderVersions;
    [ObservableProperty] private int _displayedModCount;
    [ObservableProperty] private bool _isLoading;
    [ObservableProperty] private bool _hasNoMods;
    [ObservableProperty] private string _statusText = "Select a Stellaris version to load workshop mods.";

    public bool ShowNoModsState => !IsLoading && HasNoMods;
    public bool ShowFilteredEmptyState => !IsLoading && !HasNoMods && DisplayedModCount == 0;
    public bool HasResults => !IsLoading && DisplayedModCount > 0;

    public event EventHandler<string>? InstallModRequested;
    public event EventHandler<string>? UninstallModRequested;

    public VersionBrowserViewModel(WorkshopDownloader downloader, AppSettings settings, GameDetector detector)
    {
        _downloader = downloader;
        _settings = settings;
        _detector = detector;
        Directory.CreateDirectory(ThumbnailCacheDir);
        Directory.CreateDirectory(ResultCacheDir);
        InitializeCaches();
    }

    private static IReadOnlyList<string> ResolvePreferredVersionCandidates(AppSettings settings, GameDetector detector)
    {
        var result = new List<string>();

        var gamePath = settings.GamePath;
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
        if (_loadedOnce)
            _ = RefreshFromWorkshopAsync();
    }

    partial void OnSearchTextChanged(string value)
    {
        ApplyFilter();
    }

    partial void OnShowOlderVersionsChanged(bool value)
    {
        if (!_loadedOnce)
            return;

        BuildVersionDropdown();
        _ = RefreshFromWorkshopAsync();
    }

    partial void OnIsLoadingChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowNoModsState));
        OnPropertyChanged(nameof(ShowFilteredEmptyState));
        OnPropertyChanged(nameof(HasResults));
    }

    partial void OnHasNoModsChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowNoModsState));
        OnPropertyChanged(nameof(ShowFilteredEmptyState));
    }

    partial void OnDisplayedModCountChanged(int value)
    {
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
            UninstallModRequested?.Invoke(this, card.WorkshopId);
            return;
        }

        card.ActionState = "queued";
        StatusText = $"Queued {card.Name}";
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

        await RefreshFromWorkshopAsync();
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

        var preserveCurrentSelection = _loadedOnce && !string.IsNullOrWhiteSpace(currentSelection);

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
    }

    private VersionDropdownItem? ResolvePreferredVersionItem(IReadOnlyList<string> preferredVersionCandidates)
    {
        foreach (var candidate in preferredVersionCandidates)
        {
            var exact = VersionItems.FirstOrDefault(v =>
                string.Equals(v.Version, candidate, StringComparison.OrdinalIgnoreCase));
            if (exact is not null)
                return exact;

            // If we only have major.minor, prefer newest patch variant (e.g. 4.2.4 over 4.2).
            if (Regex.IsMatch(candidate, @"^\d+\.\d+$"))
            {
                var patch = VersionItems.FirstOrDefault(v =>
                    v.Version.StartsWith(candidate + ".", StringComparison.OrdinalIgnoreCase));
                if (patch is not null)
                    return patch;
            }
        }

        return null;
    }

    private async Task RefreshFromWorkshopAsync()
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

        IsLoading = true;
        StatusText = $"Searching Workshop for {versionQuery}...";

        try
        {
            var searchQueries = GetVersionSearchQueries(versionQuery);

            var cachedCards = await TryLoadCachedVersionCardsAsync(versionQuery, cancellationToken);
            if (cachedCards is not null)
            {
                _fetchedMods.Clear();
                _fetchedMods.AddRange(cachedCards);

                HasNoMods = _fetchedMods.Count == 0;
                StatusText = HasNoMods
                    ? $"No workshop mods found for {versionQuery}."
                    : $"Loaded {_fetchedMods.Count} mods for {versionQuery} (cached).";

                ApplyModStateToCards();
                ApplyFilter();
                QueueThumbnailWarm(_fetchedMods.ToList());
                return;
            }

            var ids = await FetchCandidateWorkshopIdsAsync(searchQueries, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            var cards = await ResolveWorkshopCardsAsync(versionQuery, ids, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();

            await SaveCachedVersionCardsAsync(versionQuery, cards, cancellationToken);

            _fetchedMods.Clear();
            _fetchedMods.AddRange(cards);

            HasNoMods = _fetchedMods.Count == 0;
            StatusText = HasNoMods
                ? $"No workshop mods found for {versionQuery}."
                : $"Loaded {_fetchedMods.Count} mods for {versionQuery}.";

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
            _fetchedMods.Clear();
            DisplayedMods.Clear();
            DisplayedModCount = 0;
            HasNoMods = true;
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
    {
        var dedupe = new HashSet<string>(StringComparer.Ordinal);
        var ordered = new List<string>();

        foreach (var query in searchQueries)
        {
            foreach (var sort in new[] { "trend", "totaluniquesubscribers" })
            {
                for (var page = 1; page <= 2; page++)
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

                        if (ordered.Count >= 60)
                            return ordered;
                    }
                }
            }

            if (ordered.Count >= 24)
                return ordered;
        }

        return ordered;
    }

    private async Task<List<VersionModCard>> ResolveWorkshopCardsAsync(
        string versionQuery,
        List<string> ids,
        CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
            return new List<VersionModCard>();

        var topIds = ids.Take(32).ToList();
        var semaphore = new SemaphoreSlim(4);

        var tasks = topIds.Select(async (id, index) =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var info = await _downloader.GetModInfoAsync(id);
                var name = string.IsNullOrWhiteSpace(info?.Title) ? $"Workshop {id}" : info.Title;
                var previewImageUrl = NormalizePreviewUrl(info?.PreviewImageUrl);

                var card = new VersionModCard
                {
                    WorkshopId = id,
                    Name = name,
                    PreviewImageUrl = previewImageUrl,
                    GameVersionBadge = versionQuery,
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
        return cards.OrderBy(c => c.Index).Select(c => c.Card).ToList();
    }

    private async Task<List<VersionModCard>?> TryLoadCachedVersionCardsAsync(string versionQuery, CancellationToken cancellationToken)
    {
        if (_versionResultCache.TryGetValue(versionQuery, out var memoryCached))
        {
            if (DateTimeOffset.UtcNow - memoryCached.CachedAtUtc <= ResultCacheTtl)
                return await BuildCardsFromCachedEntriesAsync(versionQuery, memoryCached.Mods, cancellationToken);
        }

        var cachePath = GetResultCachePath(versionQuery);
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

            _versionResultCache[versionQuery] = diskCached;
            return await BuildCardsFromCachedEntriesAsync(versionQuery, diskCached.Mods, cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    private async Task SaveCachedVersionCardsAsync(string versionQuery, List<VersionModCard> cards, CancellationToken cancellationToken)
    {
        var cached = new CachedVersionResult
        {
            CachedAtUtc = DateTimeOffset.UtcNow,
            Mods = cards.Select(c => new CachedVersionModEntry
            {
                WorkshopId = c.WorkshopId,
                Name = c.Name,
                PreviewImageUrl = c.PreviewImageUrl
            }).ToList()
        };

        _versionResultCache[versionQuery] = cached;

        try
        {
            var cachePath = GetResultCachePath(versionQuery);
            var json = JsonSerializer.Serialize(cached);
            await File.WriteAllTextAsync(cachePath, json, cancellationToken);
        }
        catch
        {
            // Best effort cache write.
        }
    }

    private async Task<List<VersionModCard>> BuildCardsFromCachedEntriesAsync(
        string versionQuery,
        List<CachedVersionModEntry> mods,
        CancellationToken cancellationToken)
    {
        if (mods.Count == 0)
            return new List<VersionModCard>();

        var limited = mods.Take(32).ToList();
        var cards = limited
            .Select((item, index) => new IndexedCard(index, new VersionModCard
            {
                WorkshopId = item.WorkshopId,
                Name = string.IsNullOrWhiteSpace(item.Name) ? $"Workshop {item.WorkshopId}" : item.Name,
                PreviewImageUrl = item.PreviewImageUrl,
                GameVersionBadge = versionQuery,
                ActionState = GetEffectiveState(item.WorkshopId)
            }))
            .ToList();

        await Task.CompletedTask;
        return cards.OrderBy(c => c.Index).Select(c => c.Card).ToList();
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
        DisplayedMods.Clear();

        IEnumerable<VersionModCard> filtered = _fetchedMods;
        if (!string.IsNullOrWhiteSpace(SearchText))
        {
            var lower = SearchText.ToLowerInvariant();
            filtered = filtered.Where(m => m.Name.ToLowerInvariant().Contains(lower));
        }

        foreach (var mod in filtered)
            DisplayedMods.Add(mod);

        DisplayedModCount = DisplayedMods.Count;
    }

    private void ApplyModStateToCards()
    {
        foreach (var card in _fetchedMods)
            card.ActionState = GetEffectiveState(card.WorkshopId);
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
        var safeName = string.Join("_", versionQuery.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
        if (string.IsNullOrWhiteSpace(safeName))
            safeName = "unknown";

        return Path.Combine(ResultCacheDir, $"{safeName}.json");
    }

    private static string BuildWorkshopBrowseUrl(string versionQuery, string sort, int page)
    {
        var query = WebUtility.UrlEncode(versionQuery);
        return $"https://steamcommunity.com/workshop/browse/?appid=281990&searchtext={query}&childpublishedfileid=0&browsesort={sort}&section=readytouseitems&actualsort={sort}&days=-1&p={page}";
    }

    private static IReadOnlyList<string> GetVersionSearchQueries(string versionQuery)
    {
        var queries = new List<string>();

        if (!string.IsNullOrWhiteSpace(versionQuery))
            queries.Add(versionQuery.Trim());

        var normalized = StellarisVersions.Normalize(versionQuery);
        if (!string.IsNullOrWhiteSpace(normalized) &&
            !queries.Contains(normalized, StringComparer.OrdinalIgnoreCase))
        {
            queries.Add(normalized);
        }

        return queries;
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
        public string? PreviewImageUrl { get; set; }
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
    public string GameVersionBadge { get; init; } = "Unknown";
    public string? PreviewImageUrl { get; init; }

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
