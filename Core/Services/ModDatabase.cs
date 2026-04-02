using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using StellarisModManager.Core.Models;

namespace StellarisModManager.Core.Services;

/// <summary>
/// EF Core DbContext for the Stellaris Mod Manager database.
/// DB is stored at %APPDATA%/StellarisModManager/mods.db
/// </summary>
public class ModDbContext : DbContext
{
    public DbSet<Mod> Mods { get; set; } = null!;
    public DbSet<ModProfile> Profiles { get; set; } = null!;
    public DbSet<ModProfileEntry> ProfileEntries { get; set; } = null!;
    public DbSet<GameInstall> GameInstalls { get; set; } = null!;

    private static string GetDbPath()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "StellarisModManager");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "mods.db");
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.UseSqlite($"Data Source={GetDbPath()}");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Mod
        modelBuilder.Entity<Mod>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.Property(m => m.SteamWorkshopId).IsRequired();
            entity.Property(m => m.Name).IsRequired();
            entity.Property(m => m.Version).IsRequired();
            entity.Property(m => m.InstalledPath).IsRequired();
            entity.Property(m => m.DescriptorPath).IsRequired();
            entity.HasIndex(m => m.SteamWorkshopId).IsUnique();
        });

        // ModProfile
        modelBuilder.Entity<ModProfile>(entity =>
        {
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Name).IsRequired();
        });

        // ModProfileEntry — join between Profile and Mod
        modelBuilder.Entity<ModProfileEntry>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.Profile)
                  .WithMany(p => p.Entries)
                  .HasForeignKey(e => e.ProfileId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Mod)
                  .WithMany(m => m.ProfileEntries)
                  .HasForeignKey(e => e.ModId)
                  .OnDelete(DeleteBehavior.Cascade);

            // Unique constraint: a mod appears only once per profile
            entity.HasIndex(e => new { e.ProfileId, e.ModId }).IsUnique();
        });

        // GameInstall
        modelBuilder.Entity<GameInstall>(entity =>
        {
            entity.HasKey(g => g.Id);
            entity.Property(g => g.GamePath).IsRequired();
            entity.Property(g => g.ModsPath).IsRequired();
            entity.Property(g => g.GameVersion).IsRequired();
        });
    }
}

/// <summary>
/// Repository / service layer wrapping ModDbContext.
/// Creates a fresh DbContext per operation to avoid long-lived context issues
/// in a non-DI desktop application.
/// </summary>
public class ModDatabase
{
    private readonly Func<ModDbContext> _contextFactory;

    /// <summary>
    /// Default constructor — uses the standard %APPDATA% path.
    /// </summary>
    public ModDatabase()
    {
        _contextFactory = () => new ModDbContext();
    }

    /// <summary>
    /// Constructor for testing — supply a custom context factory.
    /// </summary>
    public ModDatabase(Func<ModDbContext> contextFactory)
    {
        _contextFactory = contextFactory;
    }

    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /// <summary>
    /// Ensures the database and schema exist (EnsureCreated — no migrations).
    /// </summary>
    public async Task InitializeAsync()
    {
        await using var ctx = _contextFactory();
        await ctx.Database.EnsureCreatedAsync();
    }

    // -------------------------------------------------------------------------
    // Mod CRUD
    // -------------------------------------------------------------------------

    public async Task<List<Mod>> GetAllModsAsync()
    {
        await using var ctx = _contextFactory();
        return await ctx.Mods
            .OrderBy(m => m.LoadOrder)
            .ThenBy(m => m.Name)
            .ToListAsync();
    }

    public async Task<Mod?> GetModByWorkshopIdAsync(string workshopId)
    {
        await using var ctx = _contextFactory();
        return await ctx.Mods
            .FirstOrDefaultAsync(m => m.SteamWorkshopId == workshopId);
    }

    public async Task<Mod> AddModAsync(Mod mod)
    {
        await using var ctx = _contextFactory();
        mod.InstalledAt = DateTime.UtcNow;
        ctx.Mods.Add(mod);
        await ctx.SaveChangesAsync();
        return mod;
    }

    public async Task UpdateModAsync(Mod mod)
    {
        await using var ctx = _contextFactory();
        mod.LastUpdatedAt = DateTime.UtcNow;
        ctx.Mods.Update(mod);
        await ctx.SaveChangesAsync();
    }

    public async Task DeleteModAsync(int modId)
    {
        await using var ctx = _contextFactory();
        var mod = await ctx.Mods.FindAsync(modId);
        if (mod is not null)
        {
            ctx.Mods.Remove(mod);
            await ctx.SaveChangesAsync();
        }
    }

    // -------------------------------------------------------------------------
    // Enable / Disable & Load Order
    // -------------------------------------------------------------------------

    public async Task SetModEnabledAsync(int modId, bool enabled)
    {
        await using var ctx = _contextFactory();
        var mod = await ctx.Mods.FindAsync(modId);
        if (mod is not null)
        {
            mod.IsEnabled = enabled;
            await ctx.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Bulk-updates the load order for a list of (modId, order) pairs.
    /// </summary>
    public async Task UpdateLoadOrderAsync(List<(int modId, int order)> updates)
    {
        await using var ctx = _contextFactory();
        var ids = updates.Select(u => u.modId).ToList();
        var mods = await ctx.Mods.Where(m => ids.Contains(m.Id)).ToListAsync();

        foreach (var mod in mods)
        {
            var entry = updates.FirstOrDefault(u => u.modId == mod.Id);
            mod.LoadOrder = entry.order;
        }

        await ctx.SaveChangesAsync();
    }

    // -------------------------------------------------------------------------
    // Profiles
    // -------------------------------------------------------------------------

    public async Task<List<ModProfile>> GetProfilesAsync()
    {
        await using var ctx = _contextFactory();
        return await ctx.Profiles
            .Include(p => p.Entries)
            .ThenInclude(e => e.Mod)
            .OrderBy(p => p.Name)
            .ToListAsync();
    }

    public async Task<ModProfile> CreateProfileAsync(string name)
    {
        await using var ctx = _contextFactory();
        var profile = new ModProfile
        {
            Name = name,
            IsActive = false,
            CreatedAt = DateTime.UtcNow
        };
        ctx.Profiles.Add(profile);
        await ctx.SaveChangesAsync();
        return profile;
    }

    public async Task DeleteProfileAsync(int profileId)
    {
        await using var ctx = _contextFactory();
        var profile = await ctx.Profiles.FindAsync(profileId);
        if (profile is not null)
        {
            ctx.Profiles.Remove(profile);
            await ctx.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Activates the specified profile: sets it as active, deactivates all others,
    /// and updates the global mod IsEnabled / LoadOrder from the profile entries.
    /// </summary>
    public async Task ActivateProfileAsync(int profileId)
    {
        await using var ctx = _contextFactory();

        // Deactivate all profiles
        var allProfiles = await ctx.Profiles.ToListAsync();
        foreach (var p in allProfiles)
            p.IsActive = false;

        // Activate target profile
        var target = allProfiles.FirstOrDefault(p => p.Id == profileId)
            ?? throw new InvalidOperationException($"Profile {profileId} not found.");
        target.IsActive = true;

        // Load entries for this profile
        var entries = await ctx.ProfileEntries
            .Where(e => e.ProfileId == profileId)
            .ToListAsync();

        if (entries.Count > 0)
        {
            var modIds = entries.Select(e => e.ModId).ToList();
            var mods = await ctx.Mods.ToListAsync();

            // Disable all mods first, then apply profile settings
            foreach (var mod in mods)
            {
                mod.IsEnabled = false;
            }

            foreach (var entry in entries)
            {
                var mod = mods.FirstOrDefault(m => m.Id == entry.ModId);
                if (mod is not null)
                {
                    mod.IsEnabled = entry.IsEnabled;
                    mod.LoadOrder = entry.LoadOrder;
                }
            }
        }

        await ctx.SaveChangesAsync();
    }

    // -------------------------------------------------------------------------
    // Game Install
    // -------------------------------------------------------------------------

    public async Task<GameInstall?> GetGameInstallAsync()
    {
        await using var ctx = _contextFactory();
        return await ctx.GameInstalls.FirstOrDefaultAsync();
    }

    public async Task SaveGameInstallAsync(GameInstall install)
    {
        await using var ctx = _contextFactory();

        if (install.Id == 0)
        {
            // Check if one already exists (single-row table)
            var existing = await ctx.GameInstalls.FirstOrDefaultAsync();
            if (existing is not null)
            {
                existing.GamePath = install.GamePath;
                existing.ModsPath = install.ModsPath;
                existing.GameVersion = install.GameVersion;
                existing.SteamCmdPath = install.SteamCmdPath;
                existing.SteamCmdDownloadPath = install.SteamCmdDownloadPath;
            }
            else
            {
                ctx.GameInstalls.Add(install);
            }
        }
        else
        {
            ctx.GameInstalls.Update(install);
        }

        await ctx.SaveChangesAsync();
    }
}
