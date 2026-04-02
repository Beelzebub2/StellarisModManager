# Version Browser Tab — Design Spec

## Overview

A new "Versions" tab in the main navigation sidebar that lets users browse their installed mods grouped by supported Stellaris game version. The tab uses a dropdown version selector with a scrollable grid of compact mod cards showing thumbnails, names, and version badges.

## Version Detection & Grouping

### Sources (in priority order)

1. **`Mod.GameVersion`** — the `supported_version` field from the mod descriptor (e.g. `"3.12.*"`, `"4.0.2"`)
2. **Fallback**: scan `Mod.Tags` (JSON array) and `Mod.Description` for version-like patterns (regex: `\b\d+\.\d+(\.\d+)?\b`)

### Normalization

- Strip wildcards and patch versions → major.minor (e.g. `"3.12.*"` → `"3.12"`, `"4.0.2"` → `"4.0"`)
- Mods with no detectable version go into an "Unknown" group

### Known Versions Dictionary

A static dictionary mapping normalized versions to friendly names:

```
"4.1"  → "Stellaris 4.1"
"4.0"  → "The Machine Age"
"3.12" → "Andromeda"
"3.11" → "Canis Minor"
"3.10" → "Pyxis"
"3.9"  → "Caelum"
"3.8"  → "Gemini"
"3.7"  → "Canis Minor"
"3.6"  → "Orion"
"3.5"  → "Fornax"
"3.4"  → "Cepheus"
"3.3"  → "Libra"
"3.2"  → "Herbert"
"3.1"  → "Lem"
"3.0"  → "Dick"
```

Versions not in the dictionary display as `"Stellaris X.Y"`. Sort descending (newest first), "Unknown" always last.

## Layout

### Top Toolbar

- **Version dropdown** (left): Shows `"Version Name (N mods)"` for the selected version. Dropdown lists all detected versions with mod counts.
- **Search box** (right): Filters mods within the selected version by name. Case-insensitive substring match.

### Mod Grid

- Scrollable `WrapPanel` or `ItemsRepeater` with `UniformGridLayout`
- Responsive — fills available width, wraps cards to new rows
- Cards sorted alphabetically by name within each version group

### Mod Card (Compact)

- **Fixed size**: ~160x180px approximately
- **Thumbnail**: Top portion, loaded from `Mod.ThumbnailUrl`. Fallback: a styled placeholder with the mod's first letter
- **Title**: Below thumbnail, mod name (truncated with ellipsis if long)
- **Version badge**: Small accent-colored badge showing the raw `GameVersion` value

## Architecture

### New Files

- `UI/ViewModels/VersionBrowserViewModel.cs` — ViewModel with version grouping, filtering, dropdown logic
- `UI/Views/VersionBrowserView.axaml` — XAML view with dropdown, search, and card grid

### Modified Files

- `UI/ViewModels/MainViewModel.cs` — Add `VersionBrowserViewModel` property, navigation command, and `IsVersionBrowserActive` flag
- `UI/Views/MainWindow.axaml` — Add nav button in sidebar for "Versions" tab
- `App.axaml` — Add `DataTemplate` mapping `VersionBrowserViewModel` → `VersionBrowserView`

### Helper

- `Core/Utils/StellarisVersions.cs` — Static dictionary of known version names + normalization method

### Data Flow

1. On tab activation, `VersionBrowserViewModel` calls `ModDatabase.GetAllModsAsync()`
2. Groups mods by normalized version using `StellarisVersions.Normalize(mod.GameVersion)`
3. Populates version dropdown items (sorted descending, Unknown last)
4. Default selection: version with the most mods
5. On version change or search text change, filters and repopulates the displayed card collection

### No Database Changes

All data already exists on the `Mod` model (`GameVersion`, `ThumbnailUrl`, `Name`, `Tags`, `Description`). No schema changes needed.

## Styling

- Follows existing theme system (`DynamicResource` brushes)
- Cards use `Theme.SurfaceBg` background, `Theme.Border` border, `CornerRadius="8"`
- Version badge uses `Theme.Accent` background
- Thumbnail placeholder uses `Theme.PanelBg` with centered letter in `Theme.TextMuted`
- Consistent with Library and Settings view patterns (12px padding, Inter font)

## Interaction Details

- Version dropdown change → immediate grid update (no button needed)
- Search is live — filters as user types
- Cards are display-only (no enable/disable from this tab; that's the Library tab's job)
- If a mod has no thumbnail URL, show a placeholder with the first letter of the mod name on a gradient background
