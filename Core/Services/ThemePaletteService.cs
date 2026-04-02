using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Media;

namespace StellarisModManager.Core.Services;

public static class ThemePaletteService
{
    private static readonly Dictionary<string, Palette> Palettes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Obsidian Ember"] = new Palette(
            AppBg: "#0D0F12",
            PanelBg: "#171A20",
            SurfaceBg: "#1D2129",
            Border: "#303744",
            TextPrimary: "#E6E9EF",
            TextMuted: "#9CA6B7",
            Accent: "#E88D3D",
            Success: "#6FD7A6",
            Warning: "#E2BE67",
            Danger: "#F08F8F"),

        ["Graphite Moss"] = new Palette(
            AppBg: "#0E1111",
            PanelBg: "#151C1A",
            SurfaceBg: "#1A2421",
            Border: "#2C3A35",
            TextPrimary: "#E3ECE7",
            TextMuted: "#97ABA1",
            Accent: "#56B690",
            Success: "#74D9B4",
            Warning: "#D7BE70",
            Danger: "#E69494"),

        ["Nocturne Slate"] = new Palette(
            AppBg: "#101216",
            PanelBg: "#171B23",
            SurfaceBg: "#1D2430",
            Border: "#2E3A4D",
            TextPrimary: "#E1E8F2",
            TextMuted: "#95A4B8",
            Accent: "#6FA8DC",
            Success: "#79D6AE",
            Warning: "#D9BA73",
            Danger: "#EA9797"),
    };

    public static IReadOnlyList<string> GetPaletteNames() => new List<string>(Palettes.Keys);

    public static void ApplyPalette(string paletteName)
    {
        if (Application.Current is null)
            return;

        if (!Palettes.TryGetValue(paletteName, out var palette))
            palette = Palettes["Obsidian Ember"];

        SetBrush("Theme.AppBg", palette.AppBg);
        SetBrush("Theme.PanelBg", palette.PanelBg);
        SetBrush("Theme.SurfaceBg", palette.SurfaceBg);
        SetBrush("Theme.Border", palette.Border);
        SetBrush("Theme.TextPrimary", palette.TextPrimary);
        SetBrush("Theme.TextMuted", palette.TextMuted);
        SetBrush("Theme.Accent", palette.Accent);
        SetBrush("Theme.Success", palette.Success);
        SetBrush("Theme.Warning", palette.Warning);
        SetBrush("Theme.Danger", palette.Danger);
    }

    private static void SetBrush(string key, string color)
    {
        if (Application.Current is null)
            return;

        Application.Current.Resources[key] = new SolidColorBrush(Color.Parse(color));
    }

    private sealed record Palette(
        string AppBg,
        string PanelBg,
        string SurfaceBg,
        string Border,
        string TextPrimary,
        string TextMuted,
        string Accent,
        string Success,
        string Warning,
        string Danger);
}
