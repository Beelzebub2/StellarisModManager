using System;
using System.Collections.Generic;

namespace StellarisModManager.Core.Models;

/// <summary>
/// A named collection of mods with a specific load order.
/// </summary>
public class ModProfile
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;  // e.g. "Multiplayer Safe", "Solo Full"
    public string? SharedProfileId { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<ModProfileEntry> Entries { get; set; } = new();
}

public class ModProfileEntry
{
    public int Id { get; set; }
    public int ProfileId { get; set; }
    public int ModId { get; set; }
    public bool IsEnabled { get; set; }
    public int LoadOrder { get; set; }
    public ModProfile Profile { get; set; } = null!;
    public Mod Mod { get; set; } = null!;
}
