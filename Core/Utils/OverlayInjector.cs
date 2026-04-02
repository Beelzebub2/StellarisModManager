using System;
using System.IO;
using System.Reflection;

namespace StellarisModManager.Core.Utils;

/// <summary>
/// Provides the JavaScript overlay script that is injected into Steam Workshop pages
/// to add "Install with SMM" buttons on mod listings and detail pages.
/// </summary>
public static class OverlayInjector
{
    private static string? _cachedScript;
    private static readonly object _lock = new();

    /// <summary>
    /// Reads overlay.js from the Assets folder (copied to output directory) and returns
    /// its content. The result is cached after the first read.
    /// </summary>
    public static string GetOverlayScript()
    {
        if (_cachedScript is not null)
            return _cachedScript;

        lock (_lock)
        {
            if (_cachedScript is not null)
                return _cachedScript;

            // Try to load from the output directory (CopyToOutputDirectory = PreserveNewest)
            var exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
            var assetPath = Path.Combine(exeDir, "UI", "Assets", "overlay.js");

            if (File.Exists(assetPath))
            {
                _cachedScript = File.ReadAllText(assetPath);
                return _cachedScript;
            }

            // Fallback: try relative to current directory
            var relativePath = Path.Combine("UI", "Assets", "overlay.js");
            if (File.Exists(relativePath))
            {
                _cachedScript = File.ReadAllText(relativePath);
                return _cachedScript;
            }

            // Last resort: return an empty no-op script so injection doesn't throw
            _cachedScript = "/* overlay.js not found */";
            return _cachedScript;
        }
    }

    /// <summary>
    /// Builds the complete injection script wrapped in a try/catch so errors in
    /// the overlay do not surface as unhandled WebView exceptions.
    /// </summary>
    public static string BuildInjectionScript()
    {
        var script = GetOverlayScript();
        return "try {\n" + script + "\n} catch(e) {\n    console.warn('[SMM overlay] injection error:', e);\n}";
    }

    /// <summary>
    /// Clears the cached script, forcing the next call to re-read the file.
    /// Useful for development/hot-reload scenarios.
    /// </summary>
    public static void InvalidateCache()
    {
        lock (_lock)
        {
            _cachedScript = null;
        }
    }
}
