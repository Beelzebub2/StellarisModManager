using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Serilog;
using StellarisModManager.Core.Models;

namespace StellarisModManager.Core.Services;

/// <summary>
/// Information about a possible mod update.
/// </summary>
public class ModUpdateInfo
{
    public Mod Mod { get; set; } = null!;
    public bool HasUpdate { get; set; }
    public DateTime? WorkshopUpdatedAt { get; set; }
    public string? NewVersion { get; set; }
}

/// <summary>
/// Checks Steam Workshop for mod updates by comparing the workshop TimeUpdated
/// timestamp against the locally stored <see cref="Mod.LastUpdatedAt"/>.
/// </summary>
public class ModUpdateChecker
{
    private static readonly Serilog.ILogger _log = Log.ForContext<ModUpdateChecker>();
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private const string SteamApiUrl =
        "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

    // Steam API allows up to 100 items per request
    private const int BatchSize = 100;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /// <summary>
    /// Checks all <paramref name="installedMods"/> for available updates.
    /// Returns only the mods that have an update waiting on the Workshop.
    /// Mods with no <see cref="Mod.SteamWorkshopId"/> are skipped.
    /// </summary>
    public async Task<List<ModUpdateInfo>> CheckForUpdatesAsync(List<Mod> installedMods)
    {
        var results = new List<ModUpdateInfo>();

        // Filter mods that have a workshop ID
        var workshopMods = new List<Mod>();
        foreach (var mod in installedMods)
        {
            if (!string.IsNullOrWhiteSpace(mod.SteamWorkshopId))
                workshopMods.Add(mod);
        }

        if (workshopMods.Count == 0)
            return results;

        _log.Information("Checking updates for {Count} mods", workshopMods.Count);

        // Process in batches of up to 100
        for (int i = 0; i < workshopMods.Count; i += BatchSize)
        {
            var batch = workshopMods.GetRange(i, Math.Min(BatchSize, workshopMods.Count - i));
            var batchResults = await CheckBatchAsync(batch);
            results.AddRange(batchResults);
        }

        _log.Information("Update check complete. {UpdateCount}/{Total} mods have updates",
            results.Count, workshopMods.Count);

        return results;
    }

    /// <summary>
    /// Checks a single mod for an available update.
    /// Returns null if the mod has no workshop ID or the API call fails.
    /// </summary>
    public async Task<ModUpdateInfo?> CheckModUpdateAsync(Mod mod)
    {
        if (string.IsNullOrWhiteSpace(mod.SteamWorkshopId))
            return null;

        var batch = await CheckBatchAsync(new List<Mod> { mod });
        return batch.Count > 0 ? batch[0] : null;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async Task<List<ModUpdateInfo>> CheckBatchAsync(List<Mod> mods)
    {
        var results = new List<ModUpdateInfo>();

        // Build form-encoded body: itemcount=N & publishedfileids[0]=id0 ...
        var formFields = new List<KeyValuePair<string, string>>
        {
            new("itemcount", mods.Count.ToString())
        };

        for (int j = 0; j < mods.Count; j++)
            formFields.Add(new($"publishedfileids[{j}]", mods[j].SteamWorkshopId));

        var formContent = new FormUrlEncodedContent(formFields);

        string? json = null;
        try
        {
            using var response = await _http.PostAsync(SteamApiUrl, formContent);
            response.EnsureSuccessStatusCode();
            json = await response.Content.ReadAsStringAsync();
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Steam API request failed during update check");
            return results;
        }

        // Parse response
        Dictionary<string, long> workshopTimestamps;
        Dictionary<string, string?> workshopVersions;
        try
        {
            (workshopTimestamps, workshopVersions) = ParseApiResponse(json);
        }
        catch (Exception ex)
        {
            _log.Error(ex, "Failed to parse Steam API update-check response");
            return results;
        }

        foreach (var mod in mods)
        {
            var id = mod.SteamWorkshopId;
            if (!workshopTimestamps.TryGetValue(id, out var wsTimestamp))
                continue;

            var wsUpdatedAt = wsTimestamp > 0
                ? DateTimeOffset.FromUnixTimeSeconds(wsTimestamp).UtcDateTime
                : (DateTime?)null;

            var hasUpdate = wsUpdatedAt.HasValue &&
                            (mod.LastUpdatedAt is null || wsUpdatedAt > mod.LastUpdatedAt.Value);

            if (hasUpdate)
            {
                workshopVersions.TryGetValue(id, out var newVersion);
                results.Add(new ModUpdateInfo
                {
                    Mod = mod,
                    HasUpdate = true,
                    WorkshopUpdatedAt = wsUpdatedAt,
                    NewVersion = newVersion,
                });

                _log.Debug("Mod {Name} ({Id}) has update (workshop: {Ws}, local: {Local})",
                    mod.Name, id, wsUpdatedAt, mod.LastUpdatedAt);
            }
        }

        return results;
    }

    private static (Dictionary<string, long> timestamps, Dictionary<string, string?> versions)
        ParseApiResponse(string json)
    {
        var timestamps = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var versions = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (!root.TryGetProperty("response", out var responseEl))
            return (timestamps, versions);

        if (!responseEl.TryGetProperty("publishedfiledetails", out var details))
            return (timestamps, versions);

        foreach (var item in details.EnumerateArray())
        {
            // result == 1 means success
            var result = item.TryGetProperty("result", out var resultEl) ? resultEl.GetInt32() : 0;
            if (result != 1)
                continue;

            if (!item.TryGetProperty("publishedfileid", out var idEl))
                continue;

            var fileId = idEl.GetString();
            if (string.IsNullOrWhiteSpace(fileId))
                continue;

            long timeUpdated = 0;
            if (item.TryGetProperty("time_updated", out var timeEl))
                timeUpdated = timeEl.GetInt64();

            timestamps[fileId] = timeUpdated;

            // Some mods expose a "version" tag via the tags array
            string? version = null;
            if (item.TryGetProperty("tags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var tagEl in tagsEl.EnumerateArray())
                {
                    if (tagEl.TryGetProperty("tag", out var tagVal))
                    {
                        var tag = tagVal.GetString();
                        if (tag is not null && tag.StartsWith("v", StringComparison.OrdinalIgnoreCase)
                            && tag.Length > 1 && char.IsDigit(tag[1]))
                        {
                            version = tag;
                            break;
                        }
                    }
                }
            }

            versions[fileId] = version;
        }

        return (timestamps, versions);
    }
}
