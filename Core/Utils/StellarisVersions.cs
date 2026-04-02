using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace StellarisModManager.Core.Utils;

/// <summary>
/// Static helper for Stellaris version normalization, display names, and comparison.
/// </summary>
public static class StellarisVersions
{
    private static readonly Regex VersionPattern =
        new(@"\b(\d+\.\d+)(?:\.\d+|\.\*)*\b", RegexOptions.Compiled);
    private static readonly Regex ReleaseLookupPattern =
        new(@"\b(\d+\.\d+(?:\.\d+)?)\b", RegexOptions.Compiled);

    /// <summary>
    /// Maps normalized major.minor version strings to their friendly patch names.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> KnownVersions =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "4.3",  "Cetus" },
            { "4.2",  "Corvus" },
            { "4.1",  "Lyra" },
            { "4.0",  "Phoenix" },
            { "3.14", "Circinus" },
            { "3.13", "Vela" },
            { "3.12", "Andromeda" },
            { "3.11", "Eridanus" },
            { "3.10", "Pyxis" },
            { "3.9",  "Caelum" },
            { "3.8",  "Gemini" },
            { "3.7",  "Canis Minor" },
            { "3.6",  "Orion" },
            { "3.5",  "Fornax" },
            { "3.4",  "Cepheus" },
            { "3.3",  "Libra" },
            { "3.2",  "Herbert" },
            { "3.1",  "Lem" },
            { "3.0",  "Dick" },
            { "2.8",  "Butler" },
            { "2.7",  "Wells" },
            { "2.6",  "Verne" },
            { "2.5",  "Shelley" },
            { "2.4",  "Lee" },
            { "2.3",  "Wolfe" },
            { "2.2",  "Le Guin" },
            { "2.1",  "Niven" },
            { "2.0",  "Cherryh" },
            { "1.9",  "Boulle" },
            { "1.8",  "Čapek" },
            { "1.6",  "Adams" },
            { "1.5",  "Banks" },
            { "1.4",  "Kennedy" },
            { "1.3",  "Heinlein" },
            { "1.2",  "Asimov" },
            { "1.1",  "Clarke" },
            { "1.0",  "Release" },
        };

    /// <summary>
    /// Maps version keys to release dates in UTC. Exact patch keys should be preferred when available.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, DateTimeOffset> KnownReleaseDatesUtc =
        new Dictionary<string, DateTimeOffset>(StringComparer.Ordinal)
        {
            // Versions are based on Stellaris patch history (Paradox Wiki).
            { "4.3",   new DateTimeOffset(2026, 03, 17, 0, 0, 0, TimeSpan.Zero) },
            { "4.2",   new DateTimeOffset(2025, 11, 25, 0, 0, 0, TimeSpan.Zero) },
            { "4.2.4", new DateTimeOffset(2025, 12, 11, 0, 0, 0, TimeSpan.Zero) },
            { "4.1",   new DateTimeOffset(2025, 09, 22, 0, 0, 0, TimeSpan.Zero) },
            { "4.0",   new DateTimeOffset(2025, 05, 05, 0, 0, 0, TimeSpan.Zero) },
            { "3.14",  new DateTimeOffset(2024, 10, 29, 0, 0, 0, TimeSpan.Zero) },
            { "3.13",  new DateTimeOffset(2024, 09, 10, 0, 0, 0, TimeSpan.Zero) },
            { "3.12",  new DateTimeOffset(2024, 05, 06, 0, 0, 0, TimeSpan.Zero) },
            { "3.11",  new DateTimeOffset(2024, 02, 27, 0, 0, 0, TimeSpan.Zero) },
            { "3.10",  new DateTimeOffset(2023, 11, 16, 0, 0, 0, TimeSpan.Zero) },
            { "3.9",   new DateTimeOffset(2023, 09, 12, 0, 0, 0, TimeSpan.Zero) },
            { "3.8",   new DateTimeOffset(2023, 05, 09, 0, 0, 0, TimeSpan.Zero) },
            { "3.7",   new DateTimeOffset(2023, 03, 14, 0, 0, 0, TimeSpan.Zero) },
            { "3.6",   new DateTimeOffset(2022, 11, 29, 0, 0, 0, TimeSpan.Zero) },
            { "3.5",   new DateTimeOffset(2022, 09, 20, 0, 0, 0, TimeSpan.Zero) },
            { "3.4",   new DateTimeOffset(2022, 05, 12, 0, 0, 0, TimeSpan.Zero) },
            { "3.3",   new DateTimeOffset(2022, 02, 23, 0, 0, 0, TimeSpan.Zero) },
            { "3.2",   new DateTimeOffset(2021, 11, 22, 0, 0, 0, TimeSpan.Zero) },
            { "3.1",   new DateTimeOffset(2021, 09, 14, 0, 0, 0, TimeSpan.Zero) },
            { "3.0",   new DateTimeOffset(2021, 04, 15, 0, 0, 0, TimeSpan.Zero) },
            { "2.8",   new DateTimeOffset(2020, 10, 29, 0, 0, 0, TimeSpan.Zero) },
            { "2.7",   new DateTimeOffset(2020, 05, 12, 0, 0, 0, TimeSpan.Zero) },
            { "2.6",   new DateTimeOffset(2020, 03, 17, 0, 0, 0, TimeSpan.Zero) },
            { "2.5",   new DateTimeOffset(2019, 10, 24, 0, 0, 0, TimeSpan.Zero) },
            { "2.4",   new DateTimeOffset(2019, 10, 09, 0, 0, 0, TimeSpan.Zero) },
            { "2.3",   new DateTimeOffset(2019, 06, 04, 0, 0, 0, TimeSpan.Zero) },
            { "2.2",   new DateTimeOffset(2018, 12, 06, 0, 0, 0, TimeSpan.Zero) },
            { "2.1",   new DateTimeOffset(2018, 05, 22, 0, 0, 0, TimeSpan.Zero) },
            { "2.0",   new DateTimeOffset(2018, 02, 22, 0, 0, 0, TimeSpan.Zero) },
            { "1.9",   new DateTimeOffset(2017, 12, 07, 0, 0, 0, TimeSpan.Zero) },
            { "1.8",   new DateTimeOffset(2017, 09, 21, 0, 0, 0, TimeSpan.Zero) },
            { "1.6",   new DateTimeOffset(2017, 05, 09, 0, 0, 0, TimeSpan.Zero) },
            { "1.5",   new DateTimeOffset(2017, 04, 06, 0, 0, 0, TimeSpan.Zero) },
            { "1.4",   new DateTimeOffset(2016, 12, 05, 0, 0, 0, TimeSpan.Zero) },
            { "1.3",   new DateTimeOffset(2016, 10, 20, 0, 0, 0, TimeSpan.Zero) },
            { "1.2",   new DateTimeOffset(2016, 06, 27, 0, 0, 0, TimeSpan.Zero) },
            { "1.1",   new DateTimeOffset(2016, 06, 01, 0, 0, 0, TimeSpan.Zero) },
            { "1.0",   new DateTimeOffset(2016, 05, 09, 0, 0, 0, TimeSpan.Zero) },
        };

    /// <summary>
    /// Extracts the major.minor portion from a version string such as "3.12.*" or "4.0.2".
    /// Returns null if no pattern is found.
    /// </summary>
    public static string? Normalize(string? versionString)
    {
        if (string.IsNullOrWhiteSpace(versionString))
            return null;

        var match = VersionPattern.Match(versionString);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>
    /// Extracts the major.minor version from arbitrary text such as tags or descriptions.
    /// Returns null if no pattern is found.
    /// </summary>
    public static string? ExtractFromText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var match = VersionPattern.Match(text);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>
    /// Returns a display string for a normalized version.
    /// Known versions return "X.Y — Name"; unknown versions return "Stellaris X.Y".
    /// </summary>
    public static string GetDisplayName(string normalizedVersion)
    {
        if (KnownVersions.TryGetValue(normalizedVersion, out var name))
            return $"{normalizedVersion} \u2014 {name}";

        return $"Stellaris {normalizedVersion}";
    }

    /// <summary>
    /// Returns true if the version is 3.0 or newer (recent enough to show by default).
    /// </summary>
    public static bool IsRecent(string normalizedVersion)
    {
        return CompareVersions(normalizedVersion, "3.0") >= 0;
    }

    /// <summary>
    /// Compares two major.minor version strings numerically.
    /// Returns a positive value if <paramref name="a"/> is greater than <paramref name="b"/>,
    /// zero if equal, and a negative value if less.
    /// </summary>
    public static int CompareVersions(string a, string b)
    {
        var (aMajor, aMinor) = ParseMajorMinor(a);
        var (bMajor, bMinor) = ParseMajorMinor(b);

        var majorDiff = aMajor.CompareTo(bMajor);
        return majorDiff != 0 ? majorDiff : aMinor.CompareTo(bMinor);
    }

    /// <summary>
    /// Tries to resolve a release date for an exact patch key (X.Y.Z) first, then falls back to major.minor.
    /// </summary>
    public static bool TryGetReleaseDateUtc(string? versionString, out DateTimeOffset releaseDateUtc)
    {
        releaseDateUtc = default;
        if (string.IsNullOrWhiteSpace(versionString))
            return false;

        var match = ReleaseLookupPattern.Match(versionString);
        if (match.Success)
        {
            var key = match.Groups[1].Value;
            if (KnownReleaseDatesUtc.TryGetValue(key, out releaseDateUtc))
                return true;
        }

        var normalized = Normalize(versionString);
        return !string.IsNullOrWhiteSpace(normalized) &&
               KnownReleaseDatesUtc.TryGetValue(normalized, out releaseDateUtc);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static (int Major, int Minor) ParseMajorMinor(string version)
    {
        var parts = version.Split('.');
        var major = parts.Length > 0 && int.TryParse(parts[0], out var maj) ? maj : 0;
        var minor = parts.Length > 1 && int.TryParse(parts[1], out var min) ? min : 0;
        return (major, minor);
    }
}
