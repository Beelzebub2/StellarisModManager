using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace StellarisModManager.Core.Services;

public sealed class BackgroundUpdateRequest
{
    public int ParentPid { get; init; }
    public string InstallerPath { get; init; } = string.Empty;
    public string AppExePath { get; init; } = string.Empty;
    public string TargetVersion { get; init; } = string.Empty;
    public string CleanupRoot { get; init; } = string.Empty;
}

internal static class BackgroundUpdaterRuntime
{
    private static readonly object PendingLock = new();
    private static BackgroundUpdateRequest? _pendingRequest;

    public static bool TryConfigureUpdaterMode(string[] args)
    {
        var request = ParseRequest(args);
        if (request is null)
            return false;

        lock (PendingLock)
        {
            _pendingRequest = request;
        }

        return true;
    }

    public static bool TryTakePendingRequest(out BackgroundUpdateRequest? request)
    {
        lock (PendingLock)
        {
            request = _pendingRequest;
            _pendingRequest = null;
            return request is not null;
        }
    }

    public static string GetInstallerLogPath(BackgroundUpdateRequest request)
    {
        var installerDir = Path.GetDirectoryName(request.InstallerPath);
        if (string.IsNullOrWhiteSpace(installerDir))
            installerDir = Path.GetTempPath();

        Directory.CreateDirectory(installerDir);
        return Path.Combine(installerDir, "installer-run.log");
    }

    public static async Task WaitForParentExitAsync(
        BackgroundUpdateRequest request,
        CancellationToken cancellationToken,
        Action<int>? reportProgress = null)
    {
        var pid = request.ParentPid;
        if (pid <= 0)
            return;

        Process? parent = null;
        try
        {
            parent = Process.GetProcessById(pid);
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

            while (!cancellationToken.IsCancellationRequested)
            {
                if (SafeHasExited(parent))
                    break;

                var elapsed = DateTime.UtcNow - startedAt;
                var percent = (int)Math.Round(Math.Min(100, (elapsed.TotalSeconds / timeout.TotalSeconds) * 100), MidpointRounding.AwayFromZero);
                reportProgress?.Invoke(percent);

                if (elapsed >= timeout)
                    break;

                await Task.Delay(250, cancellationToken);
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

            await Task.Delay(500, cancellationToken);
        }
        finally
        {
            parent.Dispose();
        }
    }

    public static Process? StartInstallerProcess(BackgroundUpdateRequest request, string logPath)
    {
        if (string.IsNullOrWhiteSpace(request.InstallerPath) || !File.Exists(request.InstallerPath))
            return null;

        var startInfo = new ProcessStartInfo
        {
            FileName = request.InstallerPath,
            Arguments = $"/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /SP- /LOG=\"{logPath}\"",
            WorkingDirectory = Path.GetDirectoryName(request.InstallerPath) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        return Process.Start(startInfo);
    }

    public static int EstimateInstallerProgressPercent(string logPath, DateTimeOffset startedAtUtc)
    {
        var elapsedSeconds = Math.Max(0, (DateTimeOffset.UtcNow - startedAtUtc).TotalSeconds);
        var timeFactor = Math.Min(1.0, elapsedSeconds / 120.0);

        var logLines = CountLogLinesSafe(logPath);
        var logFactor = Math.Min(1.0, logLines / 150.0);

        // Blend elapsed-time and installer-log growth into a bounded estimate.
        var blended = (timeFactor * 0.55) + (logFactor * 0.45);
        var value = 25 + (int)Math.Round(blended * 60, MidpointRounding.AwayFromZero);

        return Math.Clamp(value, 25, 85);
    }

    public static void WriteStatus(string step, string message, string? targetVersion, bool success)
    {
        AppUpdateStatusStore.Write(new AppUpdateApplyStatus
        {
            Step = step,
            Message = message,
            TargetVersion = targetVersion,
            Success = success
        });
    }

    public static bool TryStartMainApp(string appExePath)
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

    public static void TryDeleteFile(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return;

        try
        {
            File.Delete(path);
        }
        catch
        {
            // File may still be locked by AV scanning.
        }
    }

    public static void ScheduleSelfDelete(string? cleanupRoot)
    {
        var selfPath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(selfPath))
            return;

        var root = string.IsNullOrWhiteSpace(cleanupRoot)
            ? (Path.GetDirectoryName(selfPath) ?? string.Empty)
            : cleanupRoot;

        var escapedSelf = selfPath.Replace("\"", "\"\"");
        var escapedRoot = root.Replace("\"", "\"\"");
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
            // Cleanup is best-effort.
        }
    }

    private static BackgroundUpdateRequest? ParseRequest(string[] args)
    {
        if (!HasFlag(args, "--apply-update"))
            return null;

        var parentPid = GetIntArg(args, "--parent-pid");
        var installerPath = GetStringArg(args, "--installer");
        var appExePath = GetStringArg(args, "--app-exe");
        var targetVersion = GetStringArg(args, "--target-version") ?? string.Empty;
        var cleanupRoot = GetStringArg(args, "--cleanup-root") ?? string.Empty;

        if (string.IsNullOrWhiteSpace(installerPath) || string.IsNullOrWhiteSpace(appExePath))
        {
            WriteStatus("failed", "Updater arguments are incomplete.", targetVersion, false);
            return null;
        }

        return new BackgroundUpdateRequest
        {
            ParentPid = parentPid,
            InstallerPath = installerPath,
            AppExePath = appExePath,
            TargetVersion = targetVersion,
            CleanupRoot = cleanupRoot,
        };
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

    private static int CountLogLinesSafe(string path)
    {
        try
        {
            if (!File.Exists(path))
                return 0;

            var count = 0;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(stream);

            while (reader.ReadLine() is not null)
                count++;

            return count;
        }
        catch
        {
            return 0;
        }
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
