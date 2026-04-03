# Python Updater Usage

This updater is a clean-room Python implementation of the same update flow used by the current updater process.

## Features

- Writes update status to:
  - `%LOCALAPPDATA%\\StellarisModManager\\updates\\update-status.json`
- Waits for parent process (`--parent-pid`) to exit, then force-kills after timeout
- Downloads installer from `--download-url`
- Performs stale-asset fallback using GitHub release metadata from `--release-url`
- Runs Inno Setup installer silently
- Relaunches app using `--app-exe`
- Supports retry/cancel in a themed updater UI
- Supports optional update checks (`--check-only`)

## Apply Update Mode

```powershell
python Updater/python_updater.py \
  --apply-update \
  --parent-pid 1234 \
  --app-exe "C:\\Program Files\\Stellaris Mod Manager\\StellarisModManager.exe" \
  --download-url "https://github.com/ricarrrdoaraujo/StellarisModManager/releases/download/v1.0.8/StellarisModManager-Setup.exe" \
  --release-url "https://github.com/ricarrrdoaraujo/StellarisModManager/releases/tag/v1.0.8" \
  --target-version "1.0.8" \
  --startup-signal "%LOCALAPPDATA%\\StellarisModManager\\updates\\updater-started.signal" \
  --cleanup-root "%LOCALAPPDATA%\\StellarisModManager\\updates\\tmp-updater"
```

## Check-Only Mode

```powershell
python Updater/python_updater.py --check-only --current-version "1.0.7"
```

Optional check flags:

- `--api-base` (default: `https://stellarisync.rrmtools.uk`)
- `--github-repo` (default: `ricarrrdoaraujo/StellarisModManager`)
- `--include-prerelease`
