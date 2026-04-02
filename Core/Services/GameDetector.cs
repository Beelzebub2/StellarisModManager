using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Serilog;

namespace StellarisModManager.Core.Services;

/// <summary>
/// Detects the Stellaris game installation path and related metadata.
/// </summary>
public class GameDetector
{
    private static readonly Serilog.ILogger _log = Log.ForContext<GameDetector>();

    // Steam App ID for Stellaris
    private const string StellarisAppId = "281990";

    // Common Steam install locations on Windows
    private static readonly string[] CommonSteamPaths =
    {
        @"C:\Program Files (x86)\Steam\steamapps\common\Stellaris",
        @"C:\Program Files\Steam\steamapps\common\Stellaris",
        @"D:\Program Files (x86)\Steam\steamapps\common\Stellaris",
        @"D:\Steam\steamapps\common\Stellaris",
    };

    /// <summary>
    /// Attempts to auto-detect the Stellaris installation directory.
    /// Checks the Windows registry, STEAM_PATH env var, and common paths.
    /// Returns null if not found.
    /// </summary>
    public string? DetectGamePath()
    {
        // 1. Try Steam VDF libraries first (libraryfolders.vdf + appmanifest_281990.acf).
        var vdfPath = TrySteamVdfDetect();
        if (vdfPath is not null)
        {
            _log.Information("Detected Stellaris via Steam VDF: {Path}", vdfPath);
            return vdfPath;
        }

        // 2. Try Windows registry (Steam uninstall entry)
        var regPath = TryRegistryDetect();
        if (regPath is not null)
        {
            _log.Information("Detected Stellaris via registry: {Path}", regPath);
            return regPath;
        }

        // 3. Try STEAM_PATH environment variable
        var steamEnv = Environment.GetEnvironmentVariable("STEAM_PATH");
        if (!string.IsNullOrWhiteSpace(steamEnv))
        {
            var candidate = Path.Combine(steamEnv, "steamapps", "common", "Stellaris");
            if (IsValidGamePath(candidate))
            {
                _log.Information("Detected Stellaris via STEAM_PATH env: {Path}", candidate);
                return candidate;
            }
        }

        // 4. Try common well-known paths
        foreach (var path in CommonSteamPaths)
        {
            if (IsValidGamePath(path))
            {
                _log.Information("Detected Stellaris at common path: {Path}", path);
                return path;
            }
        }

        _log.Warning("Could not auto-detect Stellaris installation.");
        return null;
    }

    /// <summary>
    /// Returns the default Stellaris mods folder:
    /// %USERPROFILE%\Documents\Paradox Interactive\Stellaris\mod
    /// </summary>
    public string GetDefaultModsPath()
    {
        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Path.Combine(docs, "Paradox Interactive", "Stellaris", "mod");
    }

    /// <summary>
    /// Reads the game version from launcher-settings.json inside the game directory,
    /// or falls back to reading the .exe file version metadata.
    /// </summary>
    public string? DetectGameVersion(string gamePath)
    {
        if (string.IsNullOrWhiteSpace(gamePath))
            return null;

        // Try launcher-settings.json first
        var launcherSettings = Path.Combine(gamePath, "launcher-settings.json");
        if (File.Exists(launcherSettings))
        {
            try
            {
                var json = File.ReadAllText(launcherSettings);
                using var doc = JsonDocument.Parse(json);

                // Try "rawVersion" or "version" property
                if (doc.RootElement.TryGetProperty("rawVersion", out var rawVer))
                    return rawVer.GetString();

                if (doc.RootElement.TryGetProperty("version", out var ver))
                    return ver.GetString();
            }
            catch (Exception ex)
            {
                _log.Warning(ex, "Failed to parse launcher-settings.json at {Path}", launcherSettings);
            }
        }

        // Fall back to .exe file version
        var exePath = Path.Combine(gamePath, "stellaris.exe");
        if (!File.Exists(exePath))
            exePath = Path.Combine(gamePath, "Stellaris.exe");

        if (File.Exists(exePath))
        {
            try
            {
                var fvi = System.Diagnostics.FileVersionInfo.GetVersionInfo(exePath);
                if (!string.IsNullOrWhiteSpace(fvi.ProductVersion))
                    return fvi.ProductVersion;
                if (!string.IsNullOrWhiteSpace(fvi.FileVersion))
                    return fvi.FileVersion;
            }
            catch (Exception ex)
            {
                _log.Warning(ex, "Failed to read version from {Exe}", exePath);
            }
        }

        return null;
    }

    /// <summary>
    /// Searches for steamcmd.exe in common locations.
    /// Returns the full path if found, otherwise null.
    /// </summary>
    public string? DetectSteamCmdPath()
    {
        var candidates = new[]
        {
            @"C:\steamcmd\steamcmd.exe",
            @"C:\Program Files (x86)\Steam\steamcmd.exe",
            @"C:\Program Files\Steam\steamcmd.exe",
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "StellarisModManager", "steamcmd", "steamcmd.exe"),
        };

        foreach (var path in candidates)
        {
            if (File.Exists(path))
            {
                _log.Information("Found steamcmd at: {Path}", path);
                return path;
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private static string? TryRegistryDetect()
    {
        try
        {
            // HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 281990
            using var key = Registry.LocalMachine.OpenSubKey(
                $@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App {StellarisAppId}");

            if (key is null)
            {
                // Try 32-bit view on a 64-bit OS
                using var key32 = Registry.LocalMachine.OpenSubKey(
                    $@"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App {StellarisAppId}");

                var loc32 = key32?.GetValue("InstallLocation") as string;
                if (!string.IsNullOrWhiteSpace(loc32) && IsValidGamePath(loc32))
                    return loc32;

                return null;
            }

            var location = key.GetValue("InstallLocation") as string;
            if (!string.IsNullOrWhiteSpace(location) && IsValidGamePath(location))
                return location;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Registry lookup for Stellaris failed");
        }

        return null;
    }

    private string? TrySteamVdfDetect()
    {
        foreach (var steamRoot in GetSteamRootCandidates())
        {
            try
            {
                foreach (var libraryPath in GetSteamLibraryPaths(steamRoot))
                {
                    var directPath = Path.Combine(libraryPath, "steamapps", "common", "Stellaris");
                    if (IsValidGamePath(directPath))
                        return directPath;

                    var manifestPath = Path.Combine(libraryPath, "steamapps", $"appmanifest_{StellarisAppId}.acf");
                    if (!File.Exists(manifestPath))
                        continue;

                    var installDir = ReadAcfValue(manifestPath, "installdir");
                    if (string.IsNullOrWhiteSpace(installDir))
                        continue;

                    var manifestResolvedPath = Path.Combine(libraryPath, "steamapps", "common", installDir);
                    if (IsValidGamePath(manifestResolvedPath))
                        return manifestResolvedPath;
                }
            }
            catch (Exception ex)
            {
                _log.Debug(ex, "Steam VDF detection failed for Steam root {SteamRoot}", steamRoot);
            }
        }

        return null;
    }

    private static IEnumerable<string> GetSteamRootCandidates()
    {
        var roots = new List<string>();

        static void AddIfValid(List<string> target, string? candidate)
        {
            if (string.IsNullOrWhiteSpace(candidate))
                return;

            try
            {
                var full = Path.GetFullPath(candidate);
                if (Directory.Exists(full))
                    target.Add(full);
            }
            catch
            {
                // Ignore invalid paths.
            }
        }

        AddIfValid(roots, Environment.GetEnvironmentVariable("STEAM_PATH"));

        try
        {
            using var keyCu = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            AddIfValid(roots, keyCu?.GetValue("SteamPath") as string);
            AddIfValid(roots, keyCu?.GetValue("InstallPath") as string);
        }
        catch
        {
            // Ignore registry failures.
        }

        try
        {
            using var keyLm = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\WOW6432Node\Valve\Steam");
            AddIfValid(roots, keyLm?.GetValue("InstallPath") as string);
        }
        catch
        {
            // Ignore registry failures.
        }

        AddIfValid(roots, @"C:\Program Files (x86)\Steam");
        AddIfValid(roots, @"C:\Program Files\Steam");
        AddIfValid(roots, @"D:\Steam");

        return roots.Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> GetSteamLibraryPaths(string steamRoot)
    {
        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddLibrary(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
                return;

            var normalized = raw.Replace("\\\\", "\\").Trim();
            if (string.IsNullOrWhiteSpace(normalized))
                return;

            try
            {
                var full = Path.GetFullPath(normalized);
                if (Directory.Exists(full))
                    results.Add(full);
            }
            catch
            {
                // Ignore invalid paths.
            }
        }

        AddLibrary(steamRoot);

        var libraryVdf = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(libraryVdf))
            return results;

        string content;
        try
        {
            content = File.ReadAllText(libraryVdf);
        }
        catch
        {
            return results;
        }

        // Newer Steam format stores libraries as: "path" "D:\\SteamLibrary"
        foreach (Match match in Regex.Matches(content, "\"path\"\\s+\"(?<path>[^\"]+)\"", RegexOptions.IgnoreCase))
            AddLibrary(match.Groups["path"].Value);

        // Older format can store numbered keys directly as paths.
        foreach (Match match in Regex.Matches(content, "^\\s*\"\\d+\"\\s+\"(?<path>[^\"]+)\"", RegexOptions.Multiline))
            AddLibrary(match.Groups["path"].Value);

        return results;
    }

    private static string? ReadAcfValue(string acfPath, string key)
    {
        try
        {
            var content = File.ReadAllText(acfPath);
            var pattern = $"\\\"{Regex.Escape(key)}\\\"\\s+\\\"(?<value>[^\\\"]+)\\\"";
            var match = Regex.Match(content, pattern, RegexOptions.IgnoreCase);
            if (!match.Success)
                return null;

            return match.Groups["value"].Value.Replace("\\\\", "\\").Trim();
        }
        catch
        {
            return null;
        }
    }

    private static bool IsValidGamePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            return false;

        // Verify by looking for the executable or a known file
        return File.Exists(Path.Combine(path, "stellaris.exe"))
            || File.Exists(Path.Combine(path, "Stellaris.exe"))
            || File.Exists(Path.Combine(path, "launcher-settings.json"));
    }
}
