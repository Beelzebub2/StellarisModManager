using System;
using System.Reflection;
using System.Text.RegularExpressions;

namespace StellarisModManager.Core.Services;

public static class AppVersionInfo
{
    private static readonly Regex SemverRegex = new(@"\d+\.\d+\.\d+", RegexOptions.Compiled);

    public static string GetSemanticVersion()
    {
        var infoVersion = Assembly.GetEntryAssembly()?
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;

        if (string.IsNullOrWhiteSpace(infoVersion))
            return "1.0.0";

        var match = SemverRegex.Match(infoVersion);
        return match.Success ? match.Value : "1.0.0";
    }

    public static string GetDisplayVersion()
    {
        var semver = GetSemanticVersion();
        return $"v{semver}";
    }

    public static bool IsNewer(string candidateVersion, string currentVersion)
    {
        var left = ParseSemver(candidateVersion);
        var right = ParseSemver(currentVersion);

        for (var i = 0; i < 3; i++)
        {
            if (left[i] != right[i])
                return left[i] > right[i];
        }

        return false;
    }

    private static int[] ParseSemver(string version)
    {
        var clean = version.Split('+', 2, StringSplitOptions.TrimEntries)[0]
            .Split('-', 2, StringSplitOptions.TrimEntries)[0];

        var parts = clean.Split('.', StringSplitOptions.TrimEntries);
        var parsed = new int[3];

        for (var i = 0; i < parsed.Length; i++)
        {
            if (i < parts.Length && int.TryParse(parts[i], out var value))
                parsed[i] = Math.Max(0, value);
        }

        return parsed;
    }
}
