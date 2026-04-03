# Stellaris Mod Manager

[![Build Installer](https://img.shields.io/github/actions/workflow/status/Beelzebub2/StellarisModManager/release-installer.yml?label=build%20installer)](https://github.com/Beelzebub2/StellarisModManager/actions/workflows/release-installer.yml)
[![Issues](https://img.shields.io/github/issues/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/issues)
[![Release](https://img.shields.io/github/v/release/Beelzebub2/StellarisModManager)](https://github.com/Beelzebub2/StellarisModManager/releases)

Desktop mod manager for Stellaris built with Avalonia and .NET 8.

## What it does

- Manage installed mods and load order
- Browse workshop mods by game version
- Check updates and export/import mod lists
- Report per-version compatibility (worked or not worked)
- Optional Stellarisync API service for community sync data

## Quick start

### Requirements

- Windows
- .NET 8 SDK
- Node.js 18+ (only if you run the Stellarisync API)

### Run the desktop app

```bat
run.bat Debug
```

### Build release output

```bat
build.bat Release 1.0.0
```

Build artifacts are written to `Output/StellarisModManager`.

### Run the Stellarisync API (optional)

```bash
cd Stellarisync
npm install
npm start
```

## Project layout

- `Core/` - domain models and services
- `UI/` - Avalonia views and viewmodels
- `Updater/` - updater tooling
- `Stellarisync/` - lightweight Node.js sync API
- `.github/workflows/` - CI/release automation

## Contributing

Issues and pull requests are welcome. For larger changes, open an issue first so the design can be discussed before implementation.

## Open source notes

This repository is prepared for open source collaboration. If you want a specific license, add a `LICENSE` file (for example MIT) and the license badge will update automatically.
