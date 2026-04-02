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
