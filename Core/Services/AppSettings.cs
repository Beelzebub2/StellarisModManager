using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StellarisModManager.Core.Services;

/// <summary>
/// Simple JSON-backed application settings.
/// Persisted at %APPDATA%/StellarisModManager/settings.json.
/// </summary>
public class AppSettings
{
    private static readonly string SettingsDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "StellarisModManager");

    private static readonly string SettingsPath =
        Path.Combine(SettingsDir, "settings.json");

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // -------------------------------------------------------------------------
    // Properties
    // -------------------------------------------------------------------------

    public string? GamePath { get; set; }
    public string? ModsPath { get; set; }
    public string? SteamCmdPath { get; set; }
    public string? SteamCmdDownloadPath { get; set; }
    public bool AutoDetectGame { get; set; } = true;

    // -------------------------------------------------------------------------
    // Load / Save
    // -------------------------------------------------------------------------

    /// <summary>
    /// Loads settings from disk. Returns a new default instance if the file
    /// does not exist or cannot be parsed.
    /// </summary>
    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                var settings = JsonSerializer.Deserialize<AppSettings>(json, SerializerOptions);
                return settings ?? new AppSettings();
            }
        }
        catch (Exception)
        {
            // Swallow parse / IO errors — return defaults
        }

        return new AppSettings();
    }

    /// <summary>
    /// Saves current settings to disk, creating the directory if necessary.
    /// </summary>
    public void Save()
    {
        Directory.CreateDirectory(SettingsDir);
        var json = JsonSerializer.Serialize(this, SerializerOptions);
        File.WriteAllText(SettingsPath, json);
    }
}
