using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace StellarisModManager.Core.Services;

public sealed class AppReleaseInfo
{
    public string Version { get; init; } = string.Empty;
    public string ReleaseUrl { get; init; } = string.Empty;
    public string DownloadUrl { get; init; } = string.Empty;
    public string Changelog { get; init; } = string.Empty;
    public bool Critical { get; init; }
    public DateTimeOffset ReleasedAtUtc { get; init; }
    public string Source { get; init; } = string.Empty;
}

public sealed class AppUpdateCheckResult
{
    public bool IsUpdateAvailable { get; init; }
    public bool IsSkippedVersion { get; init; }
    public string Message { get; init; } = string.Empty;
    public AppReleaseInfo? Release { get; init; }
}

public sealed class AppDownloadProgress
{
    public long DownloadedBytes { get; init; }
    public long? TotalBytes { get; init; }
    public int Percent { get; init; }
}

public sealed class AppUpdateApplyStatus
{
    public string Step { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    public string? TargetVersion { get; init; }
    public bool Success { get; init; }
    public string UpdatedAtUtc { get; init; } = DateTime.UtcNow.ToString("O");
}

public static class AppUpdateStatusStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public static string GetStatusFilePath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StellarisModManager",
            "updates");

        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "update-status.json");
    }

    public static void Write(AppUpdateApplyStatus status)
    {
        var path = GetStatusFilePath();
        var json = JsonSerializer.Serialize(status, JsonOptions);
        File.WriteAllText(path, json);
    }

    public static AppUpdateApplyStatus? TryRead()
    {
        var path = GetStatusFilePath();
        if (!File.Exists(path))
            return null;

        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AppUpdateApplyStatus>(json, JsonOptions);
        }
        catch
        {
            return null;
        }
    }
}

public sealed class AppUpdateService
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    private const string DefaultStellarisyncBaseUrl = "https://stellarisync.rrmtools.uk";
    private const string DefaultGitHubRepo = "ricarrrdoaraujo/StellarisModManager";
    private static readonly Regex SemverRegex = new(@"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$", RegexOptions.Compiled);

    private readonly AppSettings _settings;

    public AppUpdateService(AppSettings settings)
    {
        _settings = settings;
    }

    public string CurrentVersion => AppVersionInfo.GetSemanticVersion();
    public string CurrentVersionDisplay => AppVersionInfo.GetDisplayVersion();

    public async Task<AppUpdateCheckResult> CheckForUpdatesAsync(bool manualCheck, CancellationToken cancellationToken = default)
    {
        var current = CurrentVersion;
        var latest = await TryGetLatestReleaseFromStellarisyncAsync(cancellationToken)
            ?? await TryGetLatestReleaseFromGitHubAsync(cancellationToken);

        _settings.LastAppUpdateCheckUtc = DateTime.UtcNow.ToString("O");

        if (latest is null)
        {
            _settings.Save();
            return new AppUpdateCheckResult
            {
                Message = "Update service unavailable."
            };
        }

        _settings.LastOfferedAppVersion = latest.Version;
        _settings.Save();

        if (!AppVersionInfo.IsNewer(latest.Version, current))
        {
            return new AppUpdateCheckResult
            {
                IsUpdateAvailable = false,
                Release = latest,
                Message = $"You are up to date ({current})."
            };
        }

        var isSkipped = !manualCheck
            && !latest.Critical
            && !string.IsNullOrWhiteSpace(_settings.SkippedAppVersion)
            && string.Equals(_settings.SkippedAppVersion, latest.Version, StringComparison.OrdinalIgnoreCase);

        if (isSkipped)
        {
            return new AppUpdateCheckResult
            {
                IsUpdateAvailable = false,
                IsSkippedVersion = true,
                Release = latest,
                Message = $"Skipped update {latest.Version}."
            };
        }

        return new AppUpdateCheckResult
        {
            IsUpdateAvailable = true,
            Release = latest,
            Message = latest.Critical
                ? $"Critical update {latest.Version} is available."
                : $"Update {latest.Version} is available."
        };
    }

    public async Task<string> DownloadInstallerAsync(
        AppReleaseInfo release,
        IProgress<AppDownloadProgress>? progress = null,
        CancellationToken cancellationToken = default)
    {
        var baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StellarisModManager",
            "updates",
            release.Version);

        Directory.CreateDirectory(baseDir);

        var fileName = TryGetFileNameFromUrl(release.DownloadUrl);
        if (string.IsNullOrWhiteSpace(fileName) || !fileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            fileName = "StellarisModManager-Setup.exe";

        var targetPath = Path.Combine(baseDir, fileName);

        var downloadUrl = release.DownloadUrl;
        var usedFallback = false;

        while (true)
        {
            try
            {
                await DownloadFileAsync(downloadUrl, targetPath, progress, cancellationToken);
                return targetPath;
            }
            catch (HttpRequestException ex) when (!usedFallback && IsStaleAssetStatus(ex.StatusCode))
            {
                var fallbackUrl = await ResolveFallbackDownloadUrlAsync(release, cancellationToken);
                if (string.IsNullOrWhiteSpace(fallbackUrl) || string.Equals(fallbackUrl, downloadUrl, StringComparison.OrdinalIgnoreCase))
                    throw;

                var fallbackName = TryGetFileNameFromUrl(fallbackUrl);
                if (!string.IsNullOrWhiteSpace(fallbackName) && fallbackName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    targetPath = Path.Combine(baseDir, fallbackName);

                usedFallback = true;
                downloadUrl = fallbackUrl;
            }
        }
    }

    private static async Task DownloadFileAsync(
        string downloadUrl,
        string targetPath,
        IProgress<AppDownloadProgress>? progress,
        CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        var total = response.Content.Headers.ContentLength;
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.Read);

        var buffer = new byte[1024 * 64];
        long downloaded = 0;

        while (true)
        {
            var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read <= 0)
                break;

            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            downloaded += read;

            progress?.Report(new AppDownloadProgress
            {
                DownloadedBytes = downloaded,
                TotalBytes = total,
                Percent = total > 0
                    ? (int)Math.Round((downloaded / (double)total.Value) * 100, MidpointRounding.AwayFromZero)
                    : -1
            });
        }
    }

    private async Task<string?> ResolveFallbackDownloadUrlAsync(AppReleaseInfo release, CancellationToken cancellationToken)
    {
        if (TryParseGitHubReleaseTag(release.ReleaseUrl, out var owner, out var repo, out var tag))
        {
            var tagged = await TryGetGitHubReleaseByTagAsync(owner, repo, tag, cancellationToken);
            if (!string.IsNullOrWhiteSpace(tagged))
                return tagged;
        }

        // Last fallback: query latest release in configured repository.
        var latest = await TryGetLatestReleaseFromGitHubAsync(cancellationToken);
        return latest?.DownloadUrl;
    }

    private async Task<string?> TryGetGitHubReleaseByTagAsync(
        string owner,
        string repo,
        string tag,
        CancellationToken cancellationToken)
    {
        try
        {
            var url = $"https://api.github.com/repos/{owner}/{repo}/releases/tags/{Uri.EscapeDataString(tag)}";
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("StellarisModManager", CurrentVersion));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

            using var response = await Http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

            return TryGetInstallerAssetUrl(doc.RootElement);
        }
        catch
        {
            return null;
        }
    }

    private static bool TryParseGitHubReleaseTag(string releaseUrl, out string owner, out string repo, out string tag)
    {
        owner = string.Empty;
        repo = string.Empty;
        tag = string.Empty;

        if (!Uri.TryCreate(releaseUrl, UriKind.Absolute, out var uri))
            return false;

        if (!string.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase))
            return false;

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 5)
            return false;

        if (!string.Equals(segments[2], "releases", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(segments[3], "tag", StringComparison.OrdinalIgnoreCase))
            return false;

        owner = segments[0];
        repo = segments[1];
        tag = Uri.UnescapeDataString(segments[4]);
        return !string.IsNullOrWhiteSpace(owner)
               && !string.IsNullOrWhiteSpace(repo)
               && !string.IsNullOrWhiteSpace(tag);
    }

    private static bool IsStaleAssetStatus(HttpStatusCode? statusCode)
    {
        if (!statusCode.HasValue)
            return false;

        return statusCode == HttpStatusCode.NotFound
            || statusCode == HttpStatusCode.Forbidden
            || statusCode == HttpStatusCode.Gone;
    }

    private static string? TryGetInstallerAssetUrl(JsonElement releaseRoot)
    {
        if (!releaseRoot.TryGetProperty("assets", out var assetsEl) || assetsEl.ValueKind != JsonValueKind.Array)
            return null;

        foreach (var asset in assetsEl.EnumerateArray())
        {
            var name = asset.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? string.Empty : string.Empty;
            if (!name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                continue;

            var browserUrl = asset.TryGetProperty("browser_download_url", out var dlEl)
                ? dlEl.GetString()
                : null;

            if (!string.IsNullOrWhiteSpace(browserUrl))
                return browserUrl;
        }

        return null;
    }

    public void MarkVersionSkipped(string version)
    {
        _settings.SkippedAppVersion = version;
        _settings.Save();
    }

    public void ClearSkippedVersion()
    {
        _settings.SkippedAppVersion = null;
        _settings.Save();
    }

    private async Task<AppReleaseInfo?> TryGetLatestReleaseFromStellarisyncAsync(CancellationToken cancellationToken)
    {
        try
        {
            var baseUrl = Environment.GetEnvironmentVariable("STELLARISYNC_BASE_URL");
            if (string.IsNullOrWhiteSpace(baseUrl))
                baseUrl = DefaultStellarisyncBaseUrl;

            var url = $"{baseUrl.TrimEnd('/')}/app-release/latest";
            using var response = await Http.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseReleaseFromStellarisync(doc.RootElement);
        }
        catch
        {
            return null;
        }
    }

    private async Task<AppReleaseInfo?> TryGetLatestReleaseFromGitHubAsync(CancellationToken cancellationToken)
    {
        try
        {
            var repo = Environment.GetEnvironmentVariable("STELLARISMODMANAGER_GITHUB_REPO");
            if (string.IsNullOrWhiteSpace(repo))
                repo = DefaultGitHubRepo;

            var url = $"https://api.github.com/repos/{repo}/releases/latest";
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("StellarisModManager", CurrentVersion));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

            using var response = await Http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseReleaseFromGitHub(doc.RootElement);
        }
        catch
        {
            return null;
        }
    }

    private static AppReleaseInfo? ParseReleaseFromStellarisync(JsonElement root)
    {
        var version = root.TryGetProperty("version", out var versionEl) ? versionEl.GetString() ?? string.Empty : string.Empty;
        var downloadUrl = root.TryGetProperty("downloadUrl", out var downloadEl) ? downloadEl.GetString() ?? string.Empty : string.Empty;
        var releaseUrl = root.TryGetProperty("releaseUrl", out var releaseEl) ? releaseEl.GetString() ?? string.Empty : string.Empty;

        if (!SemverRegex.IsMatch(version) || string.IsNullOrWhiteSpace(downloadUrl) || string.IsNullOrWhiteSpace(releaseUrl))
            return null;

        var changelog = root.TryGetProperty("changelog", out var notesEl) ? notesEl.GetString() ?? string.Empty : string.Empty;
        var critical = root.TryGetProperty("critical", out var criticalEl) && criticalEl.ValueKind == JsonValueKind.True;
        var releasedAt = root.TryGetProperty("releasedAt", out var releasedAtEl)
            && DateTimeOffset.TryParse(releasedAtEl.GetString(), out var parsed)
            ? parsed
            : DateTimeOffset.UtcNow;

        return new AppReleaseInfo
        {
            Version = version,
            DownloadUrl = downloadUrl,
            ReleaseUrl = releaseUrl,
            Changelog = changelog,
            Critical = critical,
            ReleasedAtUtc = releasedAt,
            Source = "stellarisync"
        };
    }

    private static AppReleaseInfo? ParseReleaseFromGitHub(JsonElement root)
    {
        var tag = root.TryGetProperty("tag_name", out var tagEl) ? tagEl.GetString() ?? string.Empty : string.Empty;
        var version = tag.StartsWith("v", StringComparison.OrdinalIgnoreCase) ? tag[1..] : tag;
        if (!SemverRegex.IsMatch(version))
            return null;

        var releaseUrl = root.TryGetProperty("html_url", out var htmlEl) ? htmlEl.GetString() ?? string.Empty : string.Empty;
        if (string.IsNullOrWhiteSpace(releaseUrl))
            return null;

        var downloadUrl = TryGetInstallerAssetUrl(root);

        if (string.IsNullOrWhiteSpace(downloadUrl))
            return null;

        var changelog = root.TryGetProperty("body", out var bodyEl) ? bodyEl.GetString() ?? string.Empty : string.Empty;
        var releasedAt = root.TryGetProperty("published_at", out var publishedEl)
            && DateTimeOffset.TryParse(publishedEl.GetString(), out var parsed)
            ? parsed
            : DateTimeOffset.UtcNow;

        return new AppReleaseInfo
        {
            Version = version,
            DownloadUrl = downloadUrl,
            ReleaseUrl = releaseUrl,
            Changelog = changelog,
            Critical = false,
            ReleasedAtUtc = releasedAt,
            Source = "github"
        };
    }

    private static string? TryGetFileNameFromUrl(string url)
    {
        try
        {
            var uri = new Uri(url, UriKind.Absolute);
            var name = Path.GetFileName(uri.LocalPath);
            return string.IsNullOrWhiteSpace(name) ? null : name;
        }
        catch
        {
            return null;
        }
    }
}
