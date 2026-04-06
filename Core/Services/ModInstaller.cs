using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Serilog;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Utils;

namespace StellarisModManager.Core.Services;

/// <summary>
/// Metadata parsed from a Stellaris .mod descriptor file.
/// </summary>
public class ModDescriptor
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;   // relative or absolute path to mod folder
    public string? Version { get; set; }
    public string? SupportedVersion { get; set; }
    public List<string> Tags { get; set; } = new();
    public string? RemoteFileId { get; set; }           // Steam Workshop ID
    public string? Picture { get; set; }
}

/// <summary>
/// Installs, parses, and uninstalls Stellaris mods.
/// </summary>
public class ModInstaller
{
    private static readonly Serilog.ILogger _log = Log.ForContext<ModInstaller>();
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(20) };

    /// <summary>
    /// Copies downloaded mod files into the Stellaris mods folder and
    /// generates a .mod descriptor, then returns the resulting <see cref="Mod"/> object.
    ///
    /// SteamCMD downloads to:
    ///   {downloadedPath}/  (already the mod root, e.g. steamapps/workshop/content/281990/{modId}/)
    ///
    /// Copies to:
    ///   {modsPath}/{workshopId}/
    ///
    /// Creates descriptor at:
    ///   {modsPath}/{workshopId}.mod
    /// </summary>
    public async Task<Mod> InstallModAsync(
        string workshopId,
        string downloadedPath,
        string modsPath,
        WorkshopModInfo? modInfo = null)
    {
        var sourceDir = ResolveDownloadedModRoot(downloadedPath, workshopId);
        if (!string.Equals(sourceDir, downloadedPath, StringComparison.OrdinalIgnoreCase))
            _log.Information("Normalized mod source for {Id}: {Old} -> {New}", workshopId, downloadedPath, sourceDir);

        var targetDir = System.IO.Path.Combine(modsPath, workshopId);
        Directory.CreateDirectory(modsPath);

        // Always start from a clean target to prevent stale files from older versions.
        if (Directory.Exists(targetDir))
            await Task.Run(() => DeleteDirectoryRobust(targetDir));

        Directory.CreateDirectory(targetDir);

        _log.Information("Installing mod {Id} from {Src} to {Dst}", workshopId, sourceDir, targetDir);

        // Copy files (overwrites existing)
        await Task.Run(() => CopyDirectory(sourceDir, targetDir));

        // Find/parse descriptor inside the downloaded directory
        var srcDescriptorPath = FindDescriptorFile(sourceDir);
        ModDescriptor descriptor;

        if (srcDescriptorPath is not null)
        {
            var content = await File.ReadAllTextAsync(srcDescriptorPath);
            descriptor = DescriptorParser.Parse(content);

            if (!string.IsNullOrWhiteSpace(descriptor.SupportedVersion))
            {
                _ = StellarisyncClient.ReportModVersionAsync(workshopId, descriptor.SupportedVersion);
            }
        }
        else
        {
            // Build a descriptor from workshop info
            descriptor = new ModDescriptor
            {
                Name = modInfo?.Title ?? workshopId,
                Version = "unknown",
                SupportedVersion = "*",
                RemoteFileId = workshopId,
                Tags = modInfo?.Tags ?? new List<string>(),
            };
        }

        // The path in the .mod file is relative to the mods root
        descriptor.Path = $"mod/{workshopId}";
        descriptor.RemoteFileId ??= workshopId;
        if (string.IsNullOrWhiteSpace(descriptor.Name))
            descriptor.Name = modInfo?.Title ?? workshopId;

        // Write the .mod descriptor alongside the mod folder
        var descriptorFilePath = System.IO.Path.Combine(modsPath, $"{workshopId}.mod");
        WriteDescriptor(descriptor, descriptorFilePath);

        // Ensure mod folder also has a descriptor.mod for tooling parity across runtimes/sources.
        var folderDescriptorPath = System.IO.Path.Combine(targetDir, "descriptor.mod");
        if (!File.Exists(folderDescriptorPath))
            WriteDescriptor(descriptor, folderDescriptorPath);

        await EnsureThumbnailAsync(targetDir, sourceDir, descriptor, modInfo);

        _log.Information("Wrote descriptor to {Path}", descriptorFilePath);

        // Build and return Mod object
        var mod = new Mod
        {
            SteamWorkshopId = workshopId,
            Name = descriptor.Name,
            Version = descriptor.Version ?? string.Empty,
            InstalledPath = targetDir,
            DescriptorPath = descriptorFilePath,
            IsEnabled = true,
            LoadOrder = 0,
            InstalledAt = DateTime.UtcNow,
            LastUpdatedAt = modInfo is not null
                ? DateTimeOffset.FromUnixTimeSeconds(modInfo.TimeUpdated).UtcDateTime
                : null,
            ThumbnailUrl = modInfo?.PreviewImageUrl,
            Description = modInfo?.Description,
            TotalSubscribers = modInfo?.TotalSubscribers,
            GameVersion = descriptor.SupportedVersion,
            Tags = modInfo?.Tags is { Count: > 0 }
                ? System.Text.Json.JsonSerializer.Serialize(modInfo.Tags)
                : null,
        };

        return mod;
    }

    /// <summary>
    /// Parses a .mod descriptor file and extracts metadata.
    /// </summary>
    public ModDescriptor ParseDescriptor(string descriptorPath)
    {
        var content = File.ReadAllText(descriptorPath);
        return DescriptorParser.Parse(content);
    }

    /// <summary>
    /// Writes a .mod descriptor file in Clausewitz format.
    /// </summary>
    public void WriteDescriptor(ModDescriptor descriptor, string descriptorFilePath)
    {
        var content = DescriptorParser.Serialize(descriptor);
        File.WriteAllText(descriptorFilePath, content);
    }

    /// <summary>
    /// Deletes all mod files from disk (both the mod folder and the .mod descriptor).
    /// </summary>
    public async Task UninstallModAsync(Mod mod)
    {
        _log.Information("Uninstalling mod {Name} ({Id})", mod.Name, mod.SteamWorkshopId);

        string? detachedDirectory = null;

        if (Directory.Exists(mod.InstalledPath))
        {
            detachedDirectory = TryDetachDirectoryForAsyncDeletion(mod.InstalledPath);

            if (detachedDirectory is null)
                await Task.Run(() => DeleteDirectoryRobust(mod.InstalledPath));
        }

        if (File.Exists(mod.DescriptorPath))
            await Task.Run(() => DeleteFileRobust(mod.DescriptorPath));

        if (!string.IsNullOrWhiteSpace(detachedDirectory))
        {
            var queuedPath = detachedDirectory;
            _ = Task.Run(() =>
            {
                try
                {
                    DeleteDirectoryRobust(queuedPath);
                }
                catch (Exception ex)
                {
                    _log.Warning(ex, "Background delete failed for detached mod directory {Path}", queuedPath);
                }
            });
        }
    }

    /// <summary>
    /// Returns true if the mod's installed folder and descriptor file both exist on disk.
    /// </summary>
    public bool VerifyModInstallation(Mod mod)
    {
        return Directory.Exists(mod.InstalledPath) && File.Exists(mod.DescriptorPath);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private static void CopyDirectory(string sourceDir, string destDir)
    {
        Directory.CreateDirectory(destDir);

        foreach (var file in Directory.GetFiles(sourceDir))
        {
            var destFile = System.IO.Path.Combine(destDir, System.IO.Path.GetFileName(file));
            File.Copy(file, destFile, overwrite: true);
        }

        foreach (var subDir in Directory.GetDirectories(sourceDir))
        {
            var subDirName = System.IO.Path.GetFileName(subDir);
            CopyDirectory(subDir, System.IO.Path.Combine(destDir, subDirName));
        }
    }

    private static string? FindDescriptorFile(string directory)
    {
        // Look for descriptor.mod inside the mod directory
        var descriptorMod = System.IO.Path.Combine(directory, "descriptor.mod");
        if (File.Exists(descriptorMod))
            return descriptorMod;

        // Also check for any .mod file in the root
        foreach (var f in Directory.GetFiles(directory, "*.mod"))
            return f;

        var nestedDescriptor = FindDescriptorFileRecursive(directory, maxDepth: 6);
        if (!string.IsNullOrWhiteSpace(nestedDescriptor))
            return nestedDescriptor;

        return null;
    }

    private static string ResolveDownloadedModRoot(string downloadedPath, string workshopId)
    {
        if (LooksLikeModRoot(downloadedPath))
            return downloadedPath;

        var nestedIdPath = System.IO.Path.Combine(downloadedPath, workshopId);
        if (LooksLikeModRoot(nestedIdPath))
            return nestedIdPath;

        var nestedWorkshopPath = System.IO.Path.Combine(downloadedPath, "mod", workshopId);
        if (LooksLikeModRoot(nestedWorkshopPath))
            return nestedWorkshopPath;

        var descriptorPath = FindDescriptorFileRecursive(downloadedPath, maxDepth: 6);
        if (!string.IsNullOrWhiteSpace(descriptorPath))
        {
            var descriptorDir = System.IO.Path.GetDirectoryName(descriptorPath);
            if (!string.IsNullOrWhiteSpace(descriptorDir))
                return descriptorDir;
        }

        return downloadedPath;
    }

    private static bool LooksLikeModRoot(string path)
    {
        if (!Directory.Exists(path))
            return false;

        if (File.Exists(System.IO.Path.Combine(path, "descriptor.mod")))
            return true;

        try
        {
            foreach (var _ in Directory.EnumerateFiles(path, "*.mod", SearchOption.TopDirectoryOnly))
                return true;

            foreach (var marker in new[] { "common", "events", "gfx", "interface", "localisation", "map" })
            {
                if (Directory.Exists(System.IO.Path.Combine(path, marker)))
                    return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static string? FindDescriptorFileRecursive(string rootPath, int maxDepth)
    {
        if (!Directory.Exists(rootPath))
            return null;

        var queue = new Queue<(string Path, int Depth)>();
        queue.Enqueue((rootPath, 0));

        while (queue.Count > 0)
        {
            var (currentPath, depth) = queue.Dequeue();
            try
            {
                var descriptorPath = System.IO.Path.Combine(currentPath, "descriptor.mod");
                if (File.Exists(descriptorPath))
                    return descriptorPath;

                if (depth >= maxDepth)
                    continue;

                foreach (var child in Directory.EnumerateDirectories(currentPath))
                {
                    var name = System.IO.Path.GetFileName(child);
                    if (name.StartsWith(".", StringComparison.Ordinal))
                        continue;

                    queue.Enqueue((child, depth + 1));
                }
            }
            catch
            {
                // Best-effort scan only.
            }
        }

        return null;
    }

    private static async Task EnsureThumbnailAsync(
        string targetDir,
        string sourceDir,
        ModDescriptor descriptor,
        WorkshopModInfo? modInfo)
    {
        var desiredPictureName = string.IsNullOrWhiteSpace(descriptor.Picture)
            ? "thumbnail.png"
            : descriptor.Picture!;

        var targetPicturePath = System.IO.Path.Combine(targetDir, desiredPictureName);
        if (File.Exists(targetPicturePath))
            return;

        var sourcePicturePath = System.IO.Path.Combine(sourceDir, desiredPictureName);
        if (File.Exists(sourcePicturePath))
        {
            File.Copy(sourcePicturePath, targetPicturePath, overwrite: true);
            return;
        }

        var fallbackSourceThumbnail = FindThumbnailFile(sourceDir);
        if (!string.IsNullOrWhiteSpace(fallbackSourceThumbnail))
        {
            File.Copy(fallbackSourceThumbnail, targetPicturePath, overwrite: true);
            return;
        }

        if (string.IsNullOrWhiteSpace(modInfo?.PreviewImageUrl))
            return;

        try
        {
            var bytes = await _http.GetByteArrayAsync(modInfo.PreviewImageUrl);
            if (bytes.Length > 0)
                await File.WriteAllBytesAsync(targetPicturePath, bytes);
        }
        catch
        {
            // Best-effort thumbnail fetch only.
        }
    }

    private static string? FindThumbnailFile(string rootDir)
    {
        if (!Directory.Exists(rootDir))
            return null;

        foreach (var name in new[] { "thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg", "thumbnail.webp" })
        {
            var direct = System.IO.Path.Combine(rootDir, name);
            if (File.Exists(direct))
                return direct;
        }

        try
        {
            foreach (var file in Directory.EnumerateFiles(rootDir, "thumbnail.*", SearchOption.AllDirectories))
                return file;
        }
        catch
        {
            // Best-effort search only.
        }

        return null;
    }

    private static void DeleteDirectoryRobust(string path)
    {
        if (!Directory.Exists(path))
            return;

        Exception? lastException = null;

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            try
            {
                NormalizeAttributesRecursive(path);
                Directory.Delete(path, recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                lastException = ex;
                Thread.Sleep(TimeSpan.FromMilliseconds(120 * attempt));
            }
        }

        // Fallback: move to a temp quarantine and try deleting there.
        var quarantineRoot = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "StellarisModManager", "DeleteQueue");
        Directory.CreateDirectory(quarantineRoot);
        var quarantinePath = System.IO.Path.Combine(quarantineRoot, Guid.NewGuid().ToString("N"));

        try
        {
            Directory.Move(path, quarantinePath);
            NormalizeAttributesRecursive(quarantinePath);
            Directory.Delete(quarantinePath, recursive: true);
            return;
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
        {
            throw lastException ?? ex;
        }
    }

    private static void DeleteFileRobust(string path)
    {
        if (!File.Exists(path))
            return;

        Exception? lastException = null;

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            try
            {
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
                return;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                lastException = ex;
                Thread.Sleep(TimeSpan.FromMilliseconds(120 * attempt));
            }
        }

        throw lastException ?? new IOException($"Failed to delete file '{path}'.");
    }

    private static string? TryDetachDirectoryForAsyncDeletion(string path)
    {
        try
        {
            if (!Directory.Exists(path))
                return null;

            var parentDir = System.IO.Path.GetDirectoryName(path);
            if (string.IsNullOrWhiteSpace(parentDir) || !Directory.Exists(parentDir))
                return null;

            var queueRoot = System.IO.Path.Combine(parentDir, ".smm-delete-queue");
            Directory.CreateDirectory(queueRoot);

            var sourceName = System.IO.Path.GetFileName(path.TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar));
            if (string.IsNullOrWhiteSpace(sourceName))
                sourceName = "mod";

            var detachedPath = System.IO.Path.Combine(
                queueRoot,
                $"{sourceName}-{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}");

            Directory.Move(path, detachedPath);
            return detachedPath;
        }
        catch
        {
            return null;
        }
    }

    private static void NormalizeAttributesRecursive(string directory)
    {
        foreach (var subDir in Directory.GetDirectories(directory, "*", SearchOption.AllDirectories))
        {
            try
            {
                File.SetAttributes(subDir, FileAttributes.Normal);
            }
            catch
            {
                // Best-effort normalization only.
            }
        }

        foreach (var file in Directory.GetFiles(directory, "*", SearchOption.AllDirectories))
        {
            try
            {
                File.SetAttributes(file, FileAttributes.Normal);
            }
            catch
            {
                // Best-effort normalization only.
            }
        }

        try
        {
            File.SetAttributes(directory, FileAttributes.Normal);
        }
        catch
        {
            // Best-effort normalization only.
        }
    }
}
