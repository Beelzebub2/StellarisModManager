using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Serilog;
using StellarisModManager.Core.Models;

namespace StellarisModManager.Core.Services;

// -------------------------------------------------------------------------
// Data transfer objects
// -------------------------------------------------------------------------

/// <summary>
/// Top-level container for an exported mod list JSON file.
/// </summary>
public class ModListExport
{
    public string Version { get; set; } = "1.0";
    public DateTime ExportedAt { get; set; }
    public string? GameVersion { get; set; }
    public List<ExportedMod> Mods { get; set; } = new();
}

/// <summary>
/// Minimal mod entry stored in the export file.
/// </summary>
public class ExportedMod
{
    public string WorkshopId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsEnabled { get; set; }
    public int LoadOrder { get; set; }
}

// -------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------

/// <summary>
/// Exports and imports mod lists as JSON files.
/// </summary>
public class ModExportImport
{
    private static readonly Serilog.ILogger _log = Log.ForContext<ModExportImport>();

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // -------------------------------------------------------------------------
    // Export
    // -------------------------------------------------------------------------

    /// <summary>
    /// Serializes <paramref name="mods"/> to a JSON file at <paramref name="filePath"/>.
    /// Optionally includes the <paramref name="gameVersion"/> string.
    /// </summary>
    public async Task ExportModListAsync(
        List<Mod> mods,
        string filePath,
        string? gameVersion = null)
    {
        var export = new ModListExport
        {
            ExportedAt = DateTime.UtcNow,
            GameVersion = gameVersion,
        };

        foreach (var mod in mods)
        {
            export.Mods.Add(new ExportedMod
            {
                WorkshopId = mod.SteamWorkshopId,
                Name = mod.Name,
                IsEnabled = mod.IsEnabled,
                LoadOrder = mod.LoadOrder,
            });
        }

        var json = JsonSerializer.Serialize(export, _jsonOptions);
        await File.WriteAllTextAsync(filePath, json);

        _log.Information("Exported {Count} mods to {Path}", export.Mods.Count, filePath);
    }

    /// <summary>
    /// Reads a mod list JSON file and returns the ordered list of Workshop IDs
    /// that should be installed.  Throws if the file cannot be parsed.
    /// </summary>
    public async Task<List<string>> ImportModListAsync(string filePath)
    {
        if (!File.Exists(filePath))
            throw new FileNotFoundException("Mod list file not found.", filePath);

        var json = await File.ReadAllTextAsync(filePath);

        ModListExport? export;
        try
        {
            export = JsonSerializer.Deserialize<ModListExport>(json, _jsonOptions);
        }
        catch (JsonException ex)
        {
            _log.Error(ex, "Failed to parse mod list from {Path}", filePath);
            throw new InvalidDataException($"Could not parse mod list file: {ex.Message}", ex);
        }

        if (export is null || export.Mods is null)
            throw new InvalidDataException("Mod list file is empty or has an unexpected format.");

        var ids = new List<string>();
        foreach (var mod in export.Mods)
        {
            if (!string.IsNullOrWhiteSpace(mod.WorkshopId))
                ids.Add(mod.WorkshopId);
        }

        _log.Information("Imported {Count} mod IDs from {Path}", ids.Count, filePath);
        return ids;
    }

    /// <summary>
    /// Same as <see cref="ImportModListAsync(string)"/> but also returns the full
    /// <see cref="ModListExport"/> object so the caller can inspect metadata.
    /// </summary>
    public async Task<ModListExport> ImportModListFullAsync(string filePath)
    {
        if (!File.Exists(filePath))
            throw new FileNotFoundException("Mod list file not found.", filePath);

        var json = await File.ReadAllTextAsync(filePath);

        ModListExport? export;
        try
        {
            export = JsonSerializer.Deserialize<ModListExport>(json, _jsonOptions);
        }
        catch (JsonException ex)
        {
            _log.Error(ex, "Failed to parse mod list from {Path}", filePath);
            throw new InvalidDataException($"Could not parse mod list file: {ex.Message}", ex);
        }

        if (export is null)
            throw new InvalidDataException("Mod list file is empty or has an unexpected format.");

        return export;
    }
}
