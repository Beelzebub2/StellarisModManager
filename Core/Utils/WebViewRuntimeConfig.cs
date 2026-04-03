using System;
using System.IO;
using System.Reflection;
using Avalonia.Controls;

namespace StellarisModManager.Core.Utils;

internal static class WebViewRuntimeConfig
{
    private static readonly string UserDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StellarisModManager",
        "WebView2");

    public static void ApplyWritableProfile(WebViewEnvironmentRequestedEventArgs args)
    {
        try
        {
            Directory.CreateDirectory(UserDataFolder);

            // Keep this reflection-based so we remain compatible across package revisions.
            TrySetStringProperty(args, "UserDataFolder", UserDataFolder);
            TrySetStringProperty(args, "ProfileName", "StellarisModManager");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WebViewRuntimeConfig] Failed to configure environment: {ex.Message}");
        }
    }

    private static void TrySetStringProperty(object target, string propertyName, string value)
    {
        var property = target.GetType().GetProperty(
            propertyName,
            BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

        if (property?.CanWrite != true || property.PropertyType != typeof(string))
            return;

        property.SetValue(target, value);
    }
}
