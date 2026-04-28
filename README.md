

<p align="center">
		<img src="ElectronSpike/assets/splash-art.png" alt="Stellaris Mod Manager Banner" width="600"/>
</p>

<p align="center">
	<strong>⚠️ This project is a work in progress! ⚠️</strong><br>
	<em>Many advanced features, such as suggested load order and mod merger, are still under development and may not be fully functional yet.</em>
</p>

# Stellaris Mod Manager

[![Build Installer](https://img.shields.io/github/actions/workflow/status/Beelzebub2/StellarisModManager/release-installer.yml?label=build%20installer)](https://github.com/Beelzebub2/StellarisModManager/actions/workflows/release-installer.yml)
[![Issues](https://img.shields.io/github/issues/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/issues)
[![Release](https://img.shields.io/github/v/release/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/releases)


<p align="center"><b>Desktop mod manager for Stellaris built with Electron, Vite, React, and TypeScript.</b></p>

## Features

- **Library:** Manage installed mods, toggle enabled/disabled, drag-and-drop load order
- **Profiles:** Create, rename, and switch profiles; share profiles via a public ID
- **Version browser:** Browse and install Steam Workshop mods filtered by your game version
- **Auto-detection:** Reads your game path to detect the installed Stellaris version automatically
- **Compatibility reports:** Report per-version compatibility and see community consensus
- **Updates:** Check for mod updates and reinstall in bulk
- **Optional sync API:** Stellarisync Node.js service for community compatibility data

## Quick start

### Requirements

- Node.js 20+ (Node.js 22.12+ is recommended for warning-free native rebuild tooling)
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
build.bat build          :: compile Electron main/preload and Vite renderer
build.bat check          :: typecheck main/preload and renderer
```

### Package a distributable

```bat
cd ElectronSpike
npm run pack
```

Output is written to `ElectronSpike/release/`.

## Settings: Game version detection

Set the **Game path** in Settings and the app will read `launcher-settings.json` from the game directory to detect your installed version. The detected version is shown in the Settings page and automatically pre-selects the correct version in the Version Browser tab. Detection runs when you:

- Type a path and move focus out of the field
- Pick a folder via the **Browse…** button
- Click **Auto-detect** or save settings

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first so the design can be discussed before implementation.
