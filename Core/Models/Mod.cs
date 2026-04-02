using System;
using System.Collections.Generic;

namespace StellarisModManager.Core.Models;

/// <summary>
/// Represents an installed Stellaris mod.
/// </summary>
public class Mod
{
    public int Id { get; set; }
    public string SteamWorkshopId { get; set; } = string.Empty;  // Steam Workshop file ID (e.g. "123456789")
    public string Name { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;          // from descriptor.mod
    public string InstalledPath { get; set; } = string.Empty;    // full path to mod folder
    public string DescriptorPath { get; set; } = string.Empty;   // path to .mod file
    public bool IsEnabled { get; set; }
    public int LoadOrder { get; set; }
    public DateTime InstalledAt { get; set; }
    public DateTime? LastUpdatedAt { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? Description { get; set; }
    public long? TotalSubscribers { get; set; }
    public string? GameVersion { get; set; }      // supported_version from descriptor
    public bool IsMultiplayerSafe { get; set; }   // true if only UI/gfx/music
    public string? Tags { get; set; }             // JSON array of tags

    // Navigation
    public List<ModProfileEntry> ProfileEntries { get; set; } = new();
}
