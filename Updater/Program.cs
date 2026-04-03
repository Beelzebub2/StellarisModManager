using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace StellarisModManager.Updater;

internal static class Program
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    [STAThread]
    private static async Task Main(string[] args)
    {
        var request = UpdateRequest.Parse(args);
        if (request is null)
        {
            AppUpdateStatusStore.Write("failed", "Updater arguments are incomplete.", null, false);
            return;
        }

        try
        {
            AppUpdateStatusStore.Write("starting", "Updater started.", request.TargetVersion, false);

            await WaitForParentExitAsync(request.ParentPid);

            AppUpdateStatusStore.Write("downloading", "Downloading installer package.", request.TargetVersion, false);
            var installerPath = await DownloadInstallerAsync(request);

            AppUpdateStatusStore.Write("installing", "Running installer in background.", request.TargetVersion, false);
            var logPath = GetInstallerLogPath(installerPath);

            var installProcess = StartInstaller(installerPath, logPath);
            if (installProcess is null)
            {
                AppUpdateStatusStore.Write("failed", "Could not start installer process.", request.TargetVersion, false);
                return;
            }

            await installProcess.WaitForExitAsync();
            var exitCode = installProcess.ExitCode;
            installProcess.Dispose();

            if (exitCode != 0)
            {
                AppUpdateStatusStore.Write("failed", $"Installer failed with exit code {exitCode}.", request.TargetVersion, false);
                return;
            }

            AppUpdateStatusStore.Write("relaunching", "Update installed. Relaunching app.", request.TargetVersion, true);
            TryStartMainApp(request.AppExePath);
            TryDeleteFile(installerPath);
        }
        catch (Exception ex)
        {
            AppUpdateStatusStore.Write("failed", $"Update install failed: {ex.Message}", request.TargetVersion, false);
        }
        finally
        {
            ScheduleSelfDelete(request.CleanupRoot);
        }
    }

    private static async Task WaitForParentExitAsync(int parentPid)
    {
        if (parentPid <= 0)
            return;

        Process? parent = null;
        try
        {
            parent = Process.GetProcessById(parentPid);
        }
        catch
        {
            return;
        }

        try
        {
            if (SafeHasExited(parent))
                return;

            var startedAt = DateTime.UtcNow;
            var timeout = TimeSpan.FromSeconds(90);

            while (!SafeHasExited(parent))
            {
                if (DateTime.UtcNow - startedAt >= timeout)
                    break;

                await Task.Delay(250);
            }

            if (!SafeHasExited(parent))
            {
                try
                {
                    parent.Kill(true);
                }
                catch
                {
                    // Parent may have already exited.
                }
            }

            await Task.Delay(500);
        }
        finally
        {
            parent.Dispose();
        }
    }

    private static bool SafeHasExited(Process process)
    {
        try
        {
            return process.HasExited;
        }
        catch
        {
            return true;
        }
    }

    private static string GetInstallerLogPath(string installerPath)
    {
        var installerDir = Path.GetDirectoryName(installerPath);
        if (string.IsNullOrWhiteSpace(installerDir))
            installerDir = Path.GetTempPath();

        Directory.CreateDirectory(installerDir);
        return Path.Combine(installerDir, "installer-run.log");
    }

    private static Process? StartInstaller(string installerPath, string logPath)
    {
        if (string.IsNullOrWhiteSpace(installerPath) || !File.Exists(installerPath))
            return null;

        var startInfo = new ProcessStartInfo
        {
            FileName = installerPath,
            Arguments = $"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /SP- /LOG=\"{logPath}\"",
            WorkingDirectory = Path.GetDirectoryName(installerPath) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        return Process.Start(startInfo);
    }

    private static bool TryStartMainApp(string appExePath)
    {
        if (string.IsNullOrWhiteSpace(appExePath) || !File.Exists(appExePath))
            return false;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = appExePath,
                WorkingDirectory = Path.GetDirectoryName(appExePath) ?? AppContext.BaseDirectory,
                UseShellExecute = true,
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<string> DownloadInstallerAsync(UpdateRequest request)
    {
        var versionFolder = string.IsNullOrWhiteSpace(request.TargetVersion)
            ? "latest"
            : request.TargetVersion;

        var baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StellarisModManager",
            "updates",
            versionFolder);

        Directory.CreateDirectory(baseDir);

        var downloadUrl = request.DownloadUrl;
        var targetName = TryGetFileNameFromUrl(downloadUrl);
        if (string.IsNullOrWhiteSpace(targetName) || !targetName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            targetName = "StellarisModManager-Setup.exe";

        var targetPath = Path.Combine(baseDir, targetName);

        var usedFallback = false;
        while (true)
        {
            try
            {
                await DownloadFileAsync(downloadUrl, targetPath);
                return targetPath;
            }
            catch (HttpRequestException ex) when (!usedFallback && IsStaleAssetStatus(ex.StatusCode))
            {
                var fallback = await ResolveFallbackDownloadUrlAsync(request.ReleaseUrl);
                if (string.IsNullOrWhiteSpace(fallback) || string.Equals(fallback, downloadUrl, StringComparison.OrdinalIgnoreCase))
                    throw;

                var fallbackName = TryGetFileNameFromUrl(fallback);
                if (!string.IsNullOrWhiteSpace(fallbackName) && fallbackName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    targetPath = Path.Combine(baseDir, fallbackName);

                downloadUrl = fallback;
                usedFallback = true;
            }
        }
    }

    private static async Task DownloadFileAsync(string url, string targetPath)
    {
        using var response = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        await using var input = await response.Content.ReadAsStreamAsync();
        await using var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.Read);
        await input.CopyToAsync(output);
    }

    private static bool IsStaleAssetStatus(HttpStatusCode? statusCode)
    {
        if (!statusCode.HasValue)
            return false;

        return statusCode == HttpStatusCode.NotFound
            || statusCode == HttpStatusCode.Forbidden
            || statusCode == HttpStatusCode.Gone;
    }

    private static async Task<string?> ResolveFallbackDownloadUrlAsync(string releaseUrl)
    {
        if (!TryParseGitHubReleaseTag(releaseUrl, out var owner, out var repo, out var tag))
            return null;

        try
        {
            var url = $"https://api.github.com/repos/{owner}/{repo}/releases/tags/{Uri.EscapeDataString(tag)}";
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("StellarisModManagerUpdater", "1.0"));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

            using var response = await Http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync();
            using var doc = await JsonDocument.ParseAsync(stream);
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

        if (!string.Equals(segments[2], "releases", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(segments[3], "tag", StringComparison.OrdinalIgnoreCase))
            return false;

        owner = segments[0];
        repo = segments[1];
        tag = Uri.UnescapeDataString(segments[4]);

        return !string.IsNullOrWhiteSpace(owner)
               && !string.IsNullOrWhiteSpace(repo)
               && !string.IsNullOrWhiteSpace(tag);
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

    private static void TryDeleteFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return;

        try
        {
            File.Delete(path);
        }
        catch
        {
            // Best-effort cleanup.
        }
    }

    private static void ScheduleSelfDelete(string? cleanupRoot)
    {
        if (string.IsNullOrWhiteSpace(cleanupRoot))
            return;

        var selfPath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(selfPath))
            return;

        var escapedSelf = selfPath.Replace("\"", "\"\"");
        var escapedRoot = cleanupRoot.Replace("\"", "\"\"");
        var command = $"/c timeout /t 2 /nobreak >nul & del /f /q \"{escapedSelf}\" & rmdir /s /q \"{escapedRoot}\"";

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = command,
                UseShellExecute = false,
                CreateNoWindow = true,
            });
        }
        catch
        {
            // Best-effort cleanup.
        }
    }
}

internal sealed class UpdateRequest
{
    public int ParentPid { get; init; }
    public string AppExePath { get; init; } = string.Empty;
    public string DownloadUrl { get; init; } = string.Empty;
    public string ReleaseUrl { get; init; } = string.Empty;
    public string TargetVersion { get; init; } = string.Empty;
    public string CleanupRoot { get; init; } = string.Empty;

    public static UpdateRequest? Parse(string[] args)
    {
        if (!HasFlag(args, "--apply-update"))
            return null;

        var parentPid = GetIntArg(args, "--parent-pid");
        var appExe = GetStringArg(args, "--app-exe");
        var downloadUrl = GetStringArg(args, "--download-url");

        if (string.IsNullOrWhiteSpace(appExe) || string.IsNullOrWhiteSpace(downloadUrl))
            return null;

        return new UpdateRequest
        {
            ParentPid = parentPid,
            AppExePath = appExe,
            DownloadUrl = downloadUrl,
            ReleaseUrl = GetStringArg(args, "--release-url") ?? string.Empty,
            TargetVersion = GetStringArg(args, "--target-version") ?? string.Empty,
            CleanupRoot = GetStringArg(args, "--cleanup-root") ?? string.Empty,
        };
    }

    private static bool HasFlag(string[] args, string flag)
    {
        foreach (var arg in args)
        {
            if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static string? GetStringArg(string[] args, string key)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], key, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }

        return null;
    }

    private static int GetIntArg(string[] args, string key)
    {
        var value = GetStringArg(args, key);
        return int.TryParse(value, out var parsed) ? parsed : 0;
    }
}

internal static class AppUpdateStatusStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public static void Write(string step, string message, string? targetVersion, bool success)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StellarisModManager",
                "updates");

            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "update-status.json");

            var payload = new
            {
                Step = step,
                Message = message,
                TargetVersion = targetVersion,
                Success = success,
                UpdatedAtUtc = DateTime.UtcNow.ToString("O")
            };

            var json = JsonSerializer.Serialize(payload, JsonOptions);
            File.WriteAllText(path, json);
        }
        catch
        {
            // Best-effort status reporting.
        }
    }
}
