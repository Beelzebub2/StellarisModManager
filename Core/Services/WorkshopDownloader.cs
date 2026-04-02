using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

namespace StellarisModManager.Core.Services;

// -------------------------------------------------------------------------
// Event args
// -------------------------------------------------------------------------

public class DownloadProgressEventArgs : EventArgs
{
    public string ModId { get; set; } = string.Empty;
    public string ModName { get; set; } = string.Empty;
    public int ProgressPercent { get; set; }   // 0-100, or -1 if unknown
    public string StatusMessage { get; set; } = string.Empty;
}

public class DownloadCompleteEventArgs : EventArgs
{
    public string ModId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? DownloadedPath { get; set; }
    public string? ErrorMessage { get; set; }
}

// -------------------------------------------------------------------------
// Workshop info model
// -------------------------------------------------------------------------

public class WorkshopModInfo
{
    public string WorkshopId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? PreviewImageUrl { get; set; }
    public long TimeUpdated { get; set; }
    public List<string> Tags { get; set; } = new();
}

// -------------------------------------------------------------------------
// Downloader
// -------------------------------------------------------------------------

/// <summary>
/// Downloads Workshop mods using SteamCMD and queries the Steam Web API.
/// </summary>
public class WorkshopDownloader
{
    private static readonly ILogger _log = Log.ForContext<WorkshopDownloader>();
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private const string SteamCmdZipUrl =
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

    private const string StellarisAppId = "281990";

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    public event EventHandler<DownloadProgressEventArgs>? ProgressChanged;
    public event EventHandler<DownloadCompleteEventArgs>? DownloadComplete;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /// <summary>
    /// Downloads a Workshop mod using SteamCMD.
    /// Returns the path to the downloaded mod folder, or null on failure.
    ///
    /// SteamCMD downloads to:
    ///   {downloadBasePath}/steamapps/workshop/content/281990/{modId}/
    /// </summary>
    public async Task<string?> DownloadModAsync(
        string modId,
        string steamCmdPath,
        string downloadBasePath,
        CancellationToken ct = default)
    {
        if (!IsSteamCmdAvailable(steamCmdPath))
        {
            _log.Error("steamcmd not found at {Path}", steamCmdPath);
            RaiseComplete(modId, false, null, "steamcmd.exe not found");
            return null;
        }

        RaiseProgress(modId, "", 0, "Starting SteamCMD…");

        // SteamCMD needs a writable install path passed via +force_install_dir
        var forceInstallDir = downloadBasePath.Replace('/', '\\');

        var args = $"+force_install_dir \"{forceInstallDir}\" " +
                   $"+login anonymous " +
                   $"+workshop_download_item {StellarisAppId} {modId} " +
                   $"+quit";

        _log.Information("Running steamcmd: {Exe} {Args}", steamCmdPath, args);

        var psi = new ProcessStartInfo
        {
            FileName = steamCmdPath,
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        string? downloadedPath = null;
        string? errorMessage = null;
        bool success = false;

        try
        {
            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                var line = e.Data;
                _log.Debug("[steamcmd] {Line}", line);

                // Parse progress from SteamCMD output
                var (percent, status) = ParseSteamCmdLine(line, modId);
                if (status is not null)
                    RaiseProgress(modId, "", percent, status);
            };

            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is not null)
                    _log.Warning("[steamcmd stderr] {Line}", e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync(ct);

            if (process.ExitCode == 0)
            {
                var expectedPath = Path.Combine(
                    downloadBasePath,
                    "steamapps", "workshop", "content", StellarisAppId, modId);

                if (Directory.Exists(expectedPath))
                {
                    downloadedPath = expectedPath;
                    success = true;
                    _log.Information("Mod {Id} downloaded to {Path}", modId, downloadedPath);
                }
                else
                {
                    errorMessage = $"SteamCMD exited cleanly but download folder not found: {expectedPath}";
                    _log.Warning(errorMessage);
                }
            }
            else
            {
                errorMessage = $"SteamCMD exited with code {process.ExitCode}";
                _log.Warning(errorMessage);
            }
        }
        catch (OperationCanceledException)
        {
            errorMessage = "Download cancelled.";
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            _log.Error(ex, "Exception while running SteamCMD for mod {Id}", modId);
        }

        RaiseComplete(modId, success, downloadedPath, errorMessage);
        return downloadedPath;
    }

    /// <summary>
    /// Returns true if steamcmd.exe exists at the given path.
    /// </summary>
    public bool IsSteamCmdAvailable(string steamCmdPath)
    {
        return !string.IsNullOrWhiteSpace(steamCmdPath) && File.Exists(steamCmdPath);
    }

    /// <summary>
    /// Downloads SteamCMD from Valve's official URL, extracts it to <paramref name="targetDir"/>,
    /// and returns the path to steamcmd.exe.
    /// </summary>
    public async Task<string> DownloadSteamCmdAsync(
        string targetDir,
        IProgress<int>? progress = null,
        CancellationToken ct = default)
    {
        Directory.CreateDirectory(targetDir);

        var zipPath = Path.Combine(targetDir, "steamcmd.zip");
        _log.Information("Downloading SteamCMD to {Dir}", targetDir);

        using (var response = await _http.GetAsync(SteamCmdZipUrl, HttpCompletionOption.ResponseHeadersRead, ct))
        {
            response.EnsureSuccessStatusCode();

            var total = response.Content.Headers.ContentLength ?? -1L;
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            await using var fileStream = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);

            var buffer = new byte[81920];
            long downloaded = 0;
            int read;

            while ((read = await stream.ReadAsync(buffer, ct)) > 0)
            {
                await fileStream.WriteAsync(buffer.AsMemory(0, read), ct);
                downloaded += read;

                if (total > 0 && progress is not null)
                    progress.Report((int)(downloaded * 100 / total));
            }
        }

        progress?.Report(100);

        // Extract
        _log.Information("Extracting SteamCMD…");
        ZipFile.ExtractToDirectory(zipPath, targetDir, overwriteFiles: true);
        File.Delete(zipPath);

        var exePath = Path.Combine(targetDir, "steamcmd.exe");
        if (!File.Exists(exePath))
            throw new FileNotFoundException("steamcmd.exe not found after extraction.", exePath);

        _log.Information("SteamCMD ready at {Path}", exePath);
        return exePath;
    }

    /// <summary>
    /// Queries the Steam Web API for metadata about a Workshop mod.
    /// Uses the public (no-auth) GetPublishedFileDetails endpoint.
    /// Returns null on failure.
    /// </summary>
    public async Task<WorkshopModInfo?> GetModInfoAsync(string modId)
    {
        const string url = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

        var formData = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("itemcount", "1"),
            new KeyValuePair<string, string>("publishedfileids[0]", modId),
        });

        try
        {
            using var response = await _http.PostAsync(url, formData);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync();
            return ParseSteamApiResponse(json, modId);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Failed to get mod info for {Id}", modId);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private static (int percent, string? status) ParseSteamCmdLine(string line, string modId)
    {
        // "Downloading item 123456789 ..."
        if (line.Contains("Downloading item", StringComparison.OrdinalIgnoreCase))
            return (-1, "Downloading…");

        // "Success. Downloaded item 123456789 to ..."
        if (line.Contains("Success.", StringComparison.OrdinalIgnoreCase) &&
            line.Contains("Downloaded item", StringComparison.OrdinalIgnoreCase))
            return (100, "Download complete");

        // Progress percentage patterns like "[ 42%]"
        var bracketIdx = line.IndexOf('[');
        var percentIdx = line.IndexOf('%');
        if (bracketIdx >= 0 && percentIdx > bracketIdx)
        {
            var numStr = line[(bracketIdx + 1)..percentIdx].Trim();
            if (int.TryParse(numStr, out var pct))
                return (pct, $"Downloading… {pct}%");
        }

        if (line.Contains("ERROR", StringComparison.OrdinalIgnoreCase))
            return (-1, $"Error: {line.Trim()}");

        return (-1, null);
    }

    private static WorkshopModInfo? ParseSteamApiResponse(string json, string modId)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("response", out var responseEl))
                return null;

            if (!responseEl.TryGetProperty("publishedfiledetails", out var details))
                return null;

            if (details.GetArrayLength() == 0)
                return null;

            var item = details[0];
            var result = item.TryGetProperty("result", out var resultEl) ? resultEl.GetInt32() : 1;
            if (result != 1)
                return null;   // item not found or error

            var info = new WorkshopModInfo
            {
                WorkshopId = modId,
                Title = item.TryGetProperty("title", out var title) ? title.GetString() ?? modId : modId,
                Description = item.TryGetProperty("description", out var desc) ? desc.GetString() ?? string.Empty : string.Empty,
                PreviewImageUrl = item.TryGetProperty("preview_url", out var preview) ? preview.GetString() : null,
                TimeUpdated = item.TryGetProperty("time_updated", out var updated) ? updated.GetInt64() : 0,
            };

            // Tags array: [{"tag": "Utilities"}, ...]
            if (item.TryGetProperty("tags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var tagEl in tagsEl.EnumerateArray())
                {
                    if (tagEl.TryGetProperty("tag", out var tagVal))
                    {
                        var tagStr = tagVal.GetString();
                        if (tagStr is not null)
                            info.Tags.Add(tagStr);
                    }
                }
            }

            return info;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to parse Steam API response for mod {Id}", modId);
            return null;
        }
    }

    private void RaiseProgress(string modId, string modName, int percent, string status)
    {
        ProgressChanged?.Invoke(this, new DownloadProgressEventArgs
        {
            ModId = modId,
            ModName = modName,
            ProgressPercent = percent,
            StatusMessage = status,
        });
    }

    private void RaiseComplete(string modId, bool success, string? path, string? error)
    {
        DownloadComplete?.Invoke(this, new DownloadCompleteEventArgs
        {
            ModId = modId,
            Success = success,
            DownloadedPath = path,
            ErrorMessage = error,
        });
    }
}
