# Stellaris Mod Manager

[![Build Installer](https://img.shields.io/github/actions/workflow/status/Beelzebub2/StellarisModManager/release-installer.yml?label=build%20installer)](https://github.com/Beelzebub2/StellarisModManager/actions/workflows/release-installer.yml)
[![Issues](https://img.shields.io/github/issues/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/issues)
[![Release](https://img.shields.io/github/v/release/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/releases)

Desktop mod manager for Stellaris built with Electron and TypeScript.

## What it does

- **Library** — manage installed mods, toggle enabled/disabled, drag-and-drop load order
- **Profiles** — create, rename, and switch profiles; share profiles via a public ID
- **Version browser** — browse and install Steam Workshop mods filtered by your game version
- **Auto-detection** — reads your game path to detect the installed Stellaris version automatically
- **Compatibility reports** — report per-version compatibility and see community consensus
- **Updates** — check for mod updates and reinstall in bulk
- **Optional sync API** — Stellarisync Node.js service for community compatibility data

## Quick start

### Requirements

- Node.js 18+
- Windows (primary target; macOS and Linux builds are supported by the bundler but untested)

### Run the desktop app

```bat
cd ElectronSpike
run.bat
```

`run.bat` installs npm dependencies automatically on first run. Pass `--skip-install` to skip that step.

### Build / typecheck

```bat
cd ElectronSpike
build.bat build          :: compile TypeScript
build.bat check          :: typecheck only (no output)
```

### Package a distributable

```bat
cd ElectronSpike
npm run pack
```

Output is written to `ElectronSpike/release/`.

## Settings — game version detection

Set the **Game path** in Settings and the app will read `launcher-settings.json` from the game directory to detect your installed version. The detected version is shown in the Settings page and automatically pre-selects the correct version in the Version Browser tab. Detection runs when you:

- Type a path and move focus out of the field
- Pick a folder via the **Browse…** button
- Click **Auto-detect** or save settings

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first so the design can be discussed before implementation.
