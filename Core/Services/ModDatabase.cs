using System;
using System.Collections.Generic;
using System.Data;
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
        await EnsureProfileSchemaAsync(ctx);
    }

    private static async Task EnsureProfileSchemaAsync(ModDbContext ctx)
    {
        var conn = ctx.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync();

        if (!await ColumnExistsAsync(conn, "Profiles", "SharedProfileId"))
        {
            await ctx.Database.ExecuteSqlRawAsync("ALTER TABLE Profiles ADD COLUMN SharedProfileId TEXT NULL;");
        }
    }

    private static async Task<bool> ColumnExistsAsync(System.Data.Common.DbConnection conn, string tableName, string columnName)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({tableName});";

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (reader.FieldCount < 2)
                continue;

            var currentName = reader.GetString(1);
            if (string.Equals(currentName, columnName, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
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
        var existing = await ctx.Mods
            .FirstOrDefaultAsync(m => m.SteamWorkshopId == mod.SteamWorkshopId);

        if (existing is null)
        {
            mod.InstalledAt = DateTime.UtcNow;
            ctx.Mods.Add(mod);
            await ctx.SaveChangesAsync();
            return mod;
        }

        // Preserve user state while refreshing installed metadata/content.
        existing.Name = mod.Name;
        existing.Version = mod.Version;
        existing.InstalledPath = mod.InstalledPath;
        existing.DescriptorPath = mod.DescriptorPath;
        existing.ThumbnailUrl = mod.ThumbnailUrl;
        existing.Description = mod.Description;
        existing.GameVersion = mod.GameVersion;
        existing.Tags = mod.Tags;
        existing.LastUpdatedAt = DateTime.UtcNow;

        await ctx.SaveChangesAsync();
        return existing;
    }

    /// <summary>
    /// Removes duplicated workshop-id entries, preserving the newest record and
    /// remapping profile entries to it.
    /// </summary>
    public async Task<int> NormalizeDuplicateWorkshopModsAsync()
    {
        await using var ctx = _contextFactory();

        var duplicates = await ctx.Mods
            .GroupBy(m => m.SteamWorkshopId)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToListAsync();

        if (duplicates.Count == 0)
            return 0;

        var removedCount = 0;

        foreach (var workshopId in duplicates)
        {
            var records = await ctx.Mods
                .Where(m => m.SteamWorkshopId == workshopId)
                .OrderByDescending(m => m.LastUpdatedAt ?? m.InstalledAt)
                .ThenByDescending(m => m.Id)
                .ToListAsync();

            var keeper = records[0];
            var extras = records.Skip(1).ToList();

            foreach (var extra in extras)
            {
                var extraEntries = await ctx.ProfileEntries
                    .Where(e => e.ModId == extra.Id)
                    .ToListAsync();

                foreach (var entry in extraEntries)
                {
                    var alreadyExists = await ctx.ProfileEntries.AnyAsync(e =>
                        e.ProfileId == entry.ProfileId &&
                        e.ModId == keeper.Id);

                    if (!alreadyExists)
                    {
                        ctx.ProfileEntries.Add(new ModProfileEntry
                        {
                            ProfileId = entry.ProfileId,
                            ModId = keeper.Id,
                            IsEnabled = entry.IsEnabled,
                            LoadOrder = entry.LoadOrder
                        });
                    }
                }

                ctx.Mods.Remove(extra);
                removedCount++;
            }
        }

        if (removedCount > 0)
            await ctx.SaveChangesAsync();

        return removedCount;
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

    public async Task RenameProfileAsync(int profileId, string newName)
    {
        await using var ctx = _contextFactory();

        var profile = await ctx.Profiles.FindAsync(profileId)
            ?? throw new InvalidOperationException($"Profile {profileId} not found.");

        profile.Name = newName;
        await ctx.SaveChangesAsync();
    }

    public async Task SetProfileSharedIdAsync(int profileId, string sharedProfileId)
    {
        await using var ctx = _contextFactory();

        var profile = await ctx.Profiles.FindAsync(profileId)
            ?? throw new InvalidOperationException($"Profile {profileId} not found.");

        profile.SharedProfileId = sharedProfileId;
        await ctx.SaveChangesAsync();
    }

    public async Task<List<string>> GetEnabledWorkshopIdsForProfileAsync(int profileId)
    {
        await using var ctx = _contextFactory();

        return await ctx.ProfileEntries
            .Where(e => e.ProfileId == profileId && e.IsEnabled)
            .Include(e => e.Mod)
            .Select(e => e.Mod.SteamWorkshopId)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Distinct()
            .ToListAsync();
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
    /// Replaces all entries for a profile with the provided snapshot.
    /// </summary>
    public async Task SaveProfileEntriesAsync(
        int profileId,
        List<(int modId, bool isEnabled, int loadOrder)> entries)
    {
        await using var ctx = _contextFactory();

        var existing = await ctx.ProfileEntries
            .Where(e => e.ProfileId == profileId)
            .ToListAsync();

        if (existing.Count > 0)
            ctx.ProfileEntries.RemoveRange(existing);

        foreach (var entry in entries)
        {
            ctx.ProfileEntries.Add(new ModProfileEntry
            {
                ProfileId = profileId,
                ModId = entry.modId,
                IsEnabled = entry.isEnabled,
                LoadOrder = entry.loadOrder,
            });
        }

        await ctx.SaveChangesAsync();
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

        // Disable all mods first, then apply profile settings.
        var mods = await ctx.Mods.ToListAsync();
        foreach (var mod in mods)
            mod.IsEnabled = false;

        // Load entries for this profile
        var entries = await ctx.ProfileEntries
            .Where(e => e.ProfileId == profileId)
            .ToListAsync();

        if (entries.Count > 0)
        {
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
