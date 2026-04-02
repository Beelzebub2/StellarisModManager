using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Serilog;
using StellarisModManager.Core.Models;

namespace StellarisModManager.Core.Services;

/// <summary>
/// Syncs enabled mods and load order into Stellaris launcher metadata.
/// Stellaris reads this from dlc_load.json in the user Stellaris folder.
/// </summary>
public class StellarisLauncherSyncService
{
    private static readonly Serilog.ILogger _log = Log.ForContext<StellarisLauncherSyncService>();

    public async Task SyncAsync(string modsPath, IReadOnlyCollection<Mod> mods, CancellationToken ct = default)
    {
        var userStellarisDir = ResolveUserStellarisDirectory(modsPath);
        Directory.CreateDirectory(userStellarisDir);

        var dlcLoadPath = Path.Combine(userStellarisDir, "dlc_load.json");

        var enabledMods = mods
            .Where(m => m.IsEnabled)
            .OrderBy(m => m.LoadOrder)
            .ThenBy(m => m.Name)
            .Select(ToEnabledModEntry)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var disabledDlcs = await ReadExistingDisabledDlcsAsync(dlcLoadPath, ct);

        var payload = new DlcLoadPayload
        {
            DisabledDlcs = disabledDlcs,
            EnabledMods = enabledMods,
        };

        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = true,
        });

        await File.WriteAllTextAsync(dlcLoadPath, json, ct);
        _log.Information("Synced Stellaris launcher mod state to {Path}. Enabled mods: {Count}", dlcLoadPath, enabledMods.Count);
    }

    private static string ResolveUserStellarisDirectory(string modsPath)
    {
        if (!string.IsNullOrWhiteSpace(modsPath))
        {
            try
            {
                var normalized = Path.GetFullPath(modsPath);
                var leaf = Path.GetFileName(normalized.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (string.Equals(leaf, "mod", StringComparison.OrdinalIgnoreCase))
                {
                    var parent = Directory.GetParent(normalized);
                    if (parent is not null)
                        return parent.FullName;
                }
            }
            catch
            {
                // Fall through to default path.
            }
        }

        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Path.Combine(docs, "Paradox Interactive", "Stellaris");
    }

    private static string ToEnabledModEntry(Mod mod)
    {
        var descriptorName = Path.GetFileName(mod.DescriptorPath);
        if (string.IsNullOrWhiteSpace(descriptorName))
            descriptorName = $"{mod.SteamWorkshopId}.mod";

        return $"mod/{descriptorName.Replace('\\', '/')}";
    }

    private static async Task<List<string>> ReadExistingDisabledDlcsAsync(string dlcLoadPath, CancellationToken ct)
    {
        if (!File.Exists(dlcLoadPath))
            return new List<string>();

        try
        {
            var json = await File.ReadAllTextAsync(dlcLoadPath, ct);
            using var doc = JsonDocument.Parse(json);

            if (!doc.RootElement.TryGetProperty("disabled_dlcs", out var disabledEl) ||
                disabledEl.ValueKind != JsonValueKind.Array)
            {
                return new List<string>();
            }

            var values = new List<string>();
            foreach (var item in disabledEl.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    var value = item.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                        values.Add(value);
                }
            }

            return values;
        }
        catch (Exception ex)
        {
            _log.Warning(ex, "Failed to read existing disabled DLC list from {Path}", dlcLoadPath);
            return new List<string>();
        }
    }

    private sealed class DlcLoadPayload
    {
        [JsonPropertyName("disabled_dlcs")]
        public List<string> DisabledDlcs { get; set; } = new();

        [JsonPropertyName("enabled_mods")]
        public List<string> EnabledMods { get; set; } = new();
    }
}
