using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    public long TimeCreated { get; set; }
    public long TimeUpdated { get; set; }
    public long TotalSubscribers { get; set; }
    public long FavoritedCount { get; set; }
    public long ViewCount { get; set; }
    public double PopularityScore { get; set; }
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
    private static readonly Serilog.ILogger _log = Log.ForContext<WorkshopDownloader>();
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private const string SteamCmdZipUrl =
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

    private const string StellarisAppId = "281990";

    private readonly SemaphoreSlim _steamCmdSessionLock = new(1, 1);
    private readonly object _steamCmdStateLock = new();

    private Process? _steamCmdSessionProcess;
    private StreamWriter? _steamCmdSessionInput;
    private TaskCompletionSource<bool>? _steamCmdSessionReady;
    private TaskCompletionSource<SteamCmdSessionResult>? _steamCmdCommandTcs;
    private SteamCmdCommandState? _steamCmdCommandState;

    private string? _steamCmdSessionExePath;
    private string? _steamCmdSessionWorkingDir;
    private string? _steamCmdSessionForceInstallDir;
    private bool _steamCmdForceDirectMode;

    private sealed record SteamCmdSessionResult(bool Success, string? DownloadedPath, string? ErrorMessage);

    private sealed class SteamCmdCommandState
    {
        public required string ModId { get; init; }
        public string? DownloadedPath { get; set; }
        public bool SawSuccessLine { get; set; }
        public List<string> Errors { get; } = new();
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    public event EventHandler<DownloadProgressEventArgs>? ProgressChanged;
    public event EventHandler<DownloadCompleteEventArgs>? DownloadComplete;
    public event EventHandler<string>? LogLine;

    public void PublishDiagnostic(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return;

        RaiseLog(message);
    }

    public async Task WarmUpSteamCmdAsync(
        string steamCmdPath,
        string downloadBasePath,
        CancellationToken ct = default)
    {
        if (!IsSteamCmdAvailable(steamCmdPath))
        {
            RaiseLog("SteamCMD warm-up skipped: executable not configured.");
            return;
        }

        var basePath = string.IsNullOrWhiteSpace(downloadBasePath)
            ? Path.GetDirectoryName(steamCmdPath) ?? Environment.CurrentDirectory
            : downloadBasePath;

        var forceInstallDir = basePath.Replace('/', '\\');
        var steamCmdDir = Path.GetDirectoryName(steamCmdPath) ?? basePath;

        await _steamCmdSessionLock.WaitAsync(ct);
        try
        {
            if (_steamCmdForceDirectMode)
            {
                RaiseLog("SteamCMD warm-up using direct mode (interactive mode previously unavailable).");
                return;
            }

            await EnsureSteamCmdSessionCoreAsync(
                steamCmdPath,
                steamCmdDir,
                forceInstallDir,
                modId: "warmup",
                emitProgress: false,
                ct);

            if (_steamCmdForceDirectMode)
                RaiseLog("SteamCMD warm-up switched to direct mode.");
            else
                RaiseLog("SteamCMD warm-up completed.");
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "SteamCMD warm-up failed.");
            RaiseLog($"SteamCMD warm-up failed: {ex.Message}");
        }
        finally
        {
            _steamCmdSessionLock.Release();
        }
    }

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
            RaiseLog($"steamcmd.exe not found at '{steamCmdPath}'");
            RaiseComplete(modId, false, null, "steamcmd.exe not found");
            return null;
        }

        // Mirror WorkshopDL behavior: detect the real consumer app id from the mod id.
        var effectiveAppId = await TryDetectWorkshopAppIdAsync(modId, ct) ?? StellarisAppId;
        RaiseLog($"Download requested for mod {modId}, app {effectiveAppId}");
        if (!string.Equals(effectiveAppId, StellarisAppId, StringComparison.Ordinal))
            RaiseProgress(modId, "", -1, $"Detected AppID {effectiveAppId} for this item");

        var forceInstallDir = downloadBasePath.Replace('/', '\\');
        var steamCmdDir = Path.GetDirectoryName(steamCmdPath) ?? downloadBasePath;

        var attempts = new[]
        {
            $"workshop_download_item {effectiveAppId} {modId} validate",
            $"workshop_download_item {effectiveAppId} {modId}",
        };

        string? downloadedPath = null;
        string? errorMessage = null;
        var attemptErrors = new List<string>();

        foreach (var args in attempts)
        {
            var result = await RunSteamCmdCommandAttemptAsync(
                modId,
                effectiveAppId,
                steamCmdPath,
                steamCmdDir,
                forceInstallDir,
                downloadBasePath,
                args,
                ct);

            if (result.Success)
            {
                downloadedPath = result.DownloadedPath;
                RaiseLog($"SteamCMD command succeeded for mod {modId}");
                break;
            }

            if (!string.IsNullOrWhiteSpace(result.ErrorMessage))
                attemptErrors.Add(result.ErrorMessage);
        }

        if (downloadedPath is null)
        {
            errorMessage = attemptErrors.Count > 0
                ? string.Join(" | ", attemptErrors)
                : "SteamCMD failed with unknown error.";
            RaiseComplete(modId, false, null, errorMessage);
            return null;
        }

        RaiseComplete(modId, true, downloadedPath, null);
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
                TimeCreated = item.TryGetProperty("time_created", out var created) ? created.GetInt64() : 0,
                TimeUpdated = item.TryGetProperty("time_updated", out var updated) ? updated.GetInt64() : 0,
                TotalSubscribers = TryReadLong(item, "subscriptions", "lifetime_subscriptions", "num_subscriptions"),
                FavoritedCount = TryReadLong(item, "favorited", "lifetime_favorited"),
                ViewCount = TryReadLong(item, "views", "lifetime_playtime"),
                PopularityScore = TryReadDouble(item, "score", "weighted_vote_score"),
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

    private static long TryReadLong(JsonElement element, params string[] propertyNames)
    {
        foreach (var property in propertyNames)
        {
            if (!element.TryGetProperty(property, out var value))
                continue;

            try
            {
                if (value.ValueKind == JsonValueKind.Number)
                    return value.GetInt64();

                if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out var parsed))
                    return parsed;
            }
            catch
            {
                // Ignore malformed values and continue through fallbacks.
            }
        }

        return 0;
    }

    private static double TryReadDouble(JsonElement element, params string[] propertyNames)
    {
        foreach (var property in propertyNames)
        {
            if (!element.TryGetProperty(property, out var value))
                continue;

            try
            {
                if (value.ValueKind == JsonValueKind.Number)
                    return value.GetDouble();

                if (value.ValueKind == JsonValueKind.String &&
                    double.TryParse(value.GetString(), out var parsed))
                {
                    return parsed;
                }
            }
            catch
            {
                // Ignore malformed values and continue through fallbacks.
            }
        }

        return 0;
    }

    private async Task<(bool Success, string? DownloadedPath, string? ErrorMessage)> RunSteamCmdCommandAttemptAsync(
        string modId,
        string appId,
        string steamCmdPath,
        string steamCmdDir,
        string forceInstallDir,
        string downloadBasePath,
        string command,
        CancellationToken ct)
    {
        await _steamCmdSessionLock.WaitAsync(ct);
        try
        {
            if (_steamCmdForceDirectMode)
            {
                RaiseProgress(modId, "", -1, "Using SteamCMD direct mode...");
                return await RunSteamCmdSingleAttemptAsync(
                    modId,
                    appId,
                    steamCmdPath,
                    steamCmdDir,
                    forceInstallDir,
                    downloadBasePath,
                    command,
                    ct);
            }

            await EnsureSteamCmdSessionCoreAsync(steamCmdPath, steamCmdDir, forceInstallDir, modId, emitProgress: true, ct);

            if (_steamCmdForceDirectMode)
            {
                return await RunSteamCmdSingleAttemptAsync(
                    modId,
                    appId,
                    steamCmdPath,
                    steamCmdDir,
                    forceInstallDir,
                    downloadBasePath,
                    command,
                    ct);
            }

            _log.Information("Running steamcmd command: {Command}", command);
            RaiseLog($"steamcmd> {command}");

            var tcs = new TaskCompletionSource<SteamCmdSessionResult>(TaskCreationOptions.RunContinuationsAsynchronously);

            lock (_steamCmdStateLock)
            {
                _steamCmdCommandState = new SteamCmdCommandState { ModId = modId };
                _steamCmdCommandTcs = tcs;
            }

            _steamCmdSessionInput!.WriteLine(command);
            _steamCmdSessionInput.Flush();

            SteamCmdSessionResult result;
            try
            {
                using var commandCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                commandCts.CancelAfter(TimeSpan.FromMinutes(3));
                result = await tcs.Task.WaitAsync(commandCts.Token);
            }
            catch (OperationCanceledException)
            {
                if (ct.IsCancellationRequested)
                    return (false, null, "Download cancelled.");

                ShutdownSteamCmdSessionCore();
                RaiseProgress(modId, "", -1, "SteamCMD session timed out, retrying with direct launch...");
                RaiseLog("SteamCMD session command timed out; using direct-launch fallback");
                return await RunSteamCmdSingleAttemptAsync(
                    modId,
                    appId,
                    steamCmdPath,
                    steamCmdDir,
                    forceInstallDir,
                    downloadBasePath,
                    command,
                    ct);
            }

            var candidatePaths = BuildCandidateDownloadPaths(
                appId,
                modId,
                downloadBasePath,
                steamCmdDir,
                result.DownloadedPath);

            foreach (var path in candidatePaths)
            {
                if (Directory.Exists(path))
                {
                    _log.Information("Mod {Id} downloaded to {Path}", modId, path);
                    return (true, path, null);
                }
            }

            var error = result.ErrorMessage;
            if (string.IsNullOrWhiteSpace(error))
                error = "SteamCMD finished but no downloaded folder was found.";

            return (false, null, error);
        }
        catch (OperationCanceledException)
        {
            return (false, null, "Download cancelled.");
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Exception while running SteamCMD for mod {Id}", modId);
            ShutdownSteamCmdSessionCore();
            return (false, null, ex.Message);
        }
        finally
        {
            _steamCmdSessionLock.Release();
        }
    }

    private async Task EnsureSteamCmdSessionCoreAsync(
        string steamCmdPath,
        string steamCmdDir,
        string forceInstallDir,
        string modId,
        bool emitProgress,
        CancellationToken ct)
    {
        if (_steamCmdSessionProcess is not null &&
            !_steamCmdSessionProcess.HasExited &&
            string.Equals(_steamCmdSessionExePath, steamCmdPath, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(_steamCmdSessionWorkingDir, steamCmdDir, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(_steamCmdSessionForceInstallDir, forceInstallDir, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        ShutdownSteamCmdSessionCore();
        if (emitProgress)
            RaiseProgress(modId, "", 0, "Starting SteamCMD...");
        RaiseLog("Starting persistent SteamCMD session...");

        var psi = new ProcessStartInfo
        {
            FileName = steamCmdPath,
            Arguments = $"+force_install_dir \"{forceInstallDir}\" +login anonymous",
            WorkingDirectory = steamCmdDir,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += OnSteamCmdOutputDataReceived;
        process.ErrorDataReceived += OnSteamCmdErrorDataReceived;
        process.Exited += OnSteamCmdSessionExited;

        if (!process.Start())
            throw new InvalidOperationException("Could not start steamcmd process.");

        _steamCmdSessionProcess = process;
        _steamCmdSessionInput = process.StandardInput;
        _steamCmdSessionExePath = steamCmdPath;
        _steamCmdSessionWorkingDir = steamCmdDir;
        _steamCmdSessionForceInstallDir = forceInstallDir;
        _steamCmdSessionReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            var readyTask = _steamCmdSessionReady.Task;
            var delayTask = Task.Delay(TimeSpan.FromSeconds(6), ct);
            var completed = await Task.WhenAny(readyTask, delayTask);

            if (completed == readyTask)
            {
                var ready = await readyTask;
                if (!ready)
                    throw new InvalidOperationException("SteamCMD session failed to initialize.");

                if (emitProgress)
                    RaiseProgress(modId, "", -1, "SteamCMD session ready");
                RaiseLog("SteamCMD session ready");
            }
            else
            {
                if (process.HasExited)
                    throw new InvalidOperationException($"SteamCMD exited during startup (code {process.ExitCode}).");

                _steamCmdForceDirectMode = true;
                if (emitProgress)
                    RaiseProgress(modId, "", -1, "SteamCMD interactive prompt not detected; switching to direct mode");
                RaiseLog("SteamCMD prompt did not appear; switching to direct mode for reliability");
                ShutdownSteamCmdSessionCore();
            }
        }
        catch (OperationCanceledException)
        {
            ShutdownSteamCmdSessionCore();
            if (ct.IsCancellationRequested)
                throw;

            throw new TimeoutException("Timed out starting SteamCMD session.");
        }
    }

    private void OnSteamCmdSessionExited(object? sender, EventArgs e)
    {
        lock (_steamCmdStateLock)
        {
            _steamCmdSessionReady?.TrySetResult(false);

            if (_steamCmdCommandTcs is not null)
            {
                _steamCmdCommandTcs.TrySetResult(
                    new SteamCmdSessionResult(false, null, "SteamCMD session exited unexpectedly."));
                _steamCmdCommandTcs = null;
                _steamCmdCommandState = null;
            }
        }
    }

    private void OnSteamCmdOutputDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (e.Data is null)
            return;

        var line = e.Data;
        _log.Debug("[steamcmd] {Line}", line);
        RaiseLog($"[steamcmd] {line}");
        HandleSteamCmdSessionOutput(line);
    }

    private void OnSteamCmdErrorDataReceived(object? sender, DataReceivedEventArgs e)
    {
        if (e.Data is null)
            return;

        var line = e.Data;
        _log.Warning("[steamcmd stderr] {Line}", line);
        RaiseLog($"[steamcmd stderr] {line}");
        HandleSteamCmdSessionOutput(line);
    }

    private void HandleSteamCmdSessionOutput(string line)
    {
        if (IsSteamCmdPrompt(line))
            _steamCmdSessionReady?.TrySetResult(true);

        SteamCmdCommandState? state;
        TaskCompletionSource<SteamCmdSessionResult>? tcs;

        lock (_steamCmdStateLock)
        {
            state = _steamCmdCommandState;
            tcs = _steamCmdCommandTcs;
        }

        if (state is null || tcs is null)
            return;

        var (percent, status) = ParseSteamCmdLine(line, state.ModId);
        if (status is not null)
            RaiseProgress(state.ModId, "", percent, status);

        if (TryExtractDownloadedPath(line, out var path))
            state.DownloadedPath = path;

        if (line.Contains("success.", StringComparison.OrdinalIgnoreCase) &&
            line.Contains("Downloaded item", StringComparison.OrdinalIgnoreCase))
        {
            state.SawSuccessLine = true;

            lock (_steamCmdStateLock)
            {
                if (ReferenceEquals(tcs, _steamCmdCommandTcs) && ReferenceEquals(state, _steamCmdCommandState))
                {
                    _steamCmdCommandTcs = null;
                    _steamCmdCommandState = null;
                    tcs.TrySetResult(new SteamCmdSessionResult(true, state.DownloadedPath, null));
                }
            }

            return;
        }

        if (line.Contains("error", StringComparison.OrdinalIgnoreCase))
            state.Errors.Add(line.Trim());

        if (!IsSteamCmdPrompt(line))
            return;

        lock (_steamCmdStateLock)
        {
            if (!ReferenceEquals(tcs, _steamCmdCommandTcs) || !ReferenceEquals(state, _steamCmdCommandState))
                return;

            var error = state.Errors.Count > 0 ? string.Join(" || ", state.Errors) : null;
            _steamCmdCommandTcs = null;
            _steamCmdCommandState = null;
            tcs.TrySetResult(new SteamCmdSessionResult(state.SawSuccessLine, state.DownloadedPath, error));
        }
    }

    private async Task<(bool Success, string? DownloadedPath, string? ErrorMessage)> RunSteamCmdSingleAttemptAsync(
        string modId,
        string appId,
        string steamCmdPath,
        string steamCmdDir,
        string forceInstallDir,
        string downloadBasePath,
        string command,
        CancellationToken ct,
        bool allowBootstrapRetry = true)
    {
        var args = $"+force_install_dir \"{forceInstallDir}\" +login anonymous +{command} +quit";
        _log.Information("Running direct steamcmd fallback: {Exe} {Args}", steamCmdPath, args);
        RaiseLog($"Running direct fallback: {command}");

        var psi = new ProcessStartInfo
        {
            FileName = steamCmdPath,
            Arguments = args,
            WorkingDirectory = steamCmdDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        string? downloadedPathFromOutput = null;
        var errors = new List<string>();
        var sawSuccessfulDownload = false;
        var sawBootstrapUpdateActivity = false;

        try
        {
            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };

            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null)
                    return;

                var line = e.Data;
                _log.Debug("[steamcmd-fallback] {Line}", line);
                RaiseLog($"[steamcmd-fallback] {line}");

                if (line.Contains("Success.", StringComparison.OrdinalIgnoreCase) &&
                    line.Contains("Downloaded item", StringComparison.OrdinalIgnoreCase))
                {
                    sawSuccessfulDownload = true;
                }

                if (line.Contains("Checking for available updates", StringComparison.OrdinalIgnoreCase) ||
                    line.Contains("Verifying installation", StringComparison.OrdinalIgnoreCase) ||
                    line.Contains("Updating", StringComparison.OrdinalIgnoreCase) ||
                    line.Contains("Looks like steam didn't shutdown cleanly", StringComparison.OrdinalIgnoreCase))
                {
                    sawBootstrapUpdateActivity = true;
                }

                var (percent, status) = ParseSteamCmdLine(line, modId);
                if (status is not null)
                {
                    var isPostSuccessProgress =
                        sawSuccessfulDownload &&
                        percent >= 0 &&
                        status.StartsWith("Downloading", StringComparison.OrdinalIgnoreCase);

                    if (!isPostSuccessProgress)
                        RaiseProgress(modId, "", percent, status);
                }

                if (TryExtractDownloadedPath(line, out var path))
                    downloadedPathFromOutput = path;

                if (line.Contains("error", StringComparison.OrdinalIgnoreCase))
                    errors.Add(line.Trim());
            };

            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null)
                    return;

                _log.Warning("[steamcmd-fallback stderr] {Line}", e.Data);
                RaiseLog($"[steamcmd-fallback stderr] {e.Data}");
                errors.Add(e.Data.Trim());
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync(ct);

            var candidatePaths = BuildCandidateDownloadPaths(
                appId,
                modId,
                downloadBasePath,
                steamCmdDir,
                downloadedPathFromOutput);

            foreach (var path in candidatePaths)
            {
                if (Directory.Exists(path))
                    return (true, path, null);
            }

            if (allowBootstrapRetry && !sawSuccessfulDownload && sawBootstrapUpdateActivity)
            {
                RaiseProgress(modId, "", -1, "SteamCMD bootstrap/update detected, retrying command...");
                RaiseLog("SteamCMD appears to be doing first-run bootstrap/update; retrying command once automatically");

                return await RunSteamCmdSingleAttemptAsync(
                    modId,
                    appId,
                    steamCmdPath,
                    steamCmdDir,
                    forceInstallDir,
                    downloadBasePath,
                    command,
                    ct,
                    allowBootstrapRetry: false);
            }

            var error = process.ExitCode == 0
                ? "SteamCMD fallback exited but no downloaded folder was found."
                : $"SteamCMD fallback exited with code {process.ExitCode}.";

            if (errors.Count > 0)
                error += " Output: " + string.Join(" || ", errors);

            return (false, null, error);
        }
        catch (OperationCanceledException)
        {
            return (false, null, "Download cancelled.");
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Exception in direct SteamCMD fallback for mod {Id}", modId);
            return (false, null, ex.Message);
        }
    }

    private static bool IsSteamCmdPrompt(string line)
    {
        var trimmed = line.Trim();
        return string.Equals(trimmed, "Steam>", StringComparison.OrdinalIgnoreCase) ||
               trimmed.EndsWith("Steam>", StringComparison.OrdinalIgnoreCase);
    }

    private void ShutdownSteamCmdSessionCore()
    {
        lock (_steamCmdStateLock)
        {
            _steamCmdCommandTcs?.TrySetResult(new SteamCmdSessionResult(false, null, "SteamCMD session was reset."));
            _steamCmdCommandTcs = null;
            _steamCmdCommandState = null;
        }

        try
        {
            _steamCmdSessionInput?.WriteLine("quit");
            _steamCmdSessionInput?.Flush();
        }
        catch
        {
            // Best effort shutdown.
        }

        try
        {
            if (_steamCmdSessionProcess is not null && !_steamCmdSessionProcess.HasExited)
            {
                if (!_steamCmdSessionProcess.WaitForExit(1500))
                    _steamCmdSessionProcess.Kill(true);
            }
        }
        catch
        {
            // Best effort shutdown.
        }

        _steamCmdSessionInput?.Dispose();
        _steamCmdSessionInput = null;
        _steamCmdSessionReady = null;
        _steamCmdSessionProcess?.Dispose();
        _steamCmdSessionProcess = null;
        _steamCmdSessionExePath = null;
        _steamCmdSessionWorkingDir = null;
        _steamCmdSessionForceInstallDir = null;
    }

    private static List<string> BuildCandidateDownloadPaths(
        string appId,
        string modId,
        string downloadBasePath,
        string steamCmdDir,
        string? outputPath)
    {
        var candidates = new List<string>();
        var dedupe = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
                return;
            var normalized = path.Trim().Trim('"');
            if (dedupe.Add(normalized))
                candidates.Add(normalized);
        }

        Add(outputPath);
        Add(Path.Combine(downloadBasePath, "steamapps", "workshop", "content", appId, modId));
        Add(Path.Combine(steamCmdDir, "steamapps", "workshop", "content", appId, modId));

        return candidates;
    }

    private static bool TryExtractDownloadedPath(string line, out string? path)
    {
        path = null;

        var match = Regex.Match(
            line,
            "Downloaded item\\s+\\d+\\s+to\\s+\"?(?<path>[A-Za-z]:[^\"\\r\\n]+)\"?",
            RegexOptions.IgnoreCase);

        if (!match.Success)
            return false;

        path = match.Groups["path"].Value;
        return !string.IsNullOrWhiteSpace(path);
    }

    private async Task<string?> TryDetectWorkshopAppIdAsync(string modId, CancellationToken ct)
    {
        const string url = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

        var formData = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("itemcount", "1"),
            new KeyValuePair<string, string>("publishedfileids[0]", modId),
        });

        try
        {
            using var response = await _http.PostAsync(url, formData, ct);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);

            if (!doc.RootElement.TryGetProperty("response", out var responseEl))
                return null;
            if (!responseEl.TryGetProperty("publishedfiledetails", out var detailsEl))
                return null;
            if (detailsEl.ValueKind != JsonValueKind.Array || detailsEl.GetArrayLength() == 0)
                return null;

            var item = detailsEl[0];
            if (item.TryGetProperty("consumer_app_id", out var consumerAppId))
            {
                var appId = consumerAppId.GetRawText().Trim('"');
                if (!string.IsNullOrWhiteSpace(appId) && appId != "0")
                    return appId;
            }

            if (item.TryGetProperty("creator_app_id", out var creatorAppId))
            {
                var appId = creatorAppId.GetRawText().Trim('"');
                if (!string.IsNullOrWhiteSpace(appId) && appId != "0")
                    return appId;
            }
        }
        catch (Exception ex)
        {
            _log.Debug(ex, "Could not auto-detect app id for workshop item {Id}", modId);
        }

        return null;
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

    private void RaiseLog(string message)
    {
        LogLine?.Invoke(this, message);
    }
}
