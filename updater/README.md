# smm-updater

Native update companion for the Stellaris Mod Manager. The main Electron app
spawns this binary when the user clicks **Update now**, then quits cleanly.
This process owns the download, integrity check, and installer hand-off.

## Design at a glance

- **Language:** Rust + [egui / eframe](https://crates.io/crates/eframe).
- **Theme:** Obsidian Ember palette, mirrored from
  `ElectronSpike/src/renderer/styles.css` in [`src/theme.rs`](src/theme.rs).
- **Downloader:** `ureq` with four parallel HTTP Range requests when the
  server supports ranges and the payload is ≥ 8 MB. Each chunk retries up to
  three times with exponential backoff.
- **Integrity:** SHA-256 (`sha2` crate). If no hash is supplied, the check is
  skipped and a warning is logged.
- **Installer execution:** The Inno Setup installer is launched in silent
  background mode; the updater keeps the window open and shows explicit
  activity states for closing the app, running the installer, relaunching, and
  cleanup. Only download and hash verification show measured progress.
- **Logs:** `%LOCALAPPDATA%\StellarisModManager\updater.log`.

## Usage

```
smm-updater.exe \
  --url https://github.com/.../StellarisModManager-Setup-1.2.3.exe \
  --version 1.2.3 \
  --sha256 0123abcd... \
  --release-url https://github.com/Beelzebub/StellarisModManager/releases/tag/v1.2.3
```

The Electron main process builds this command line in
`ElectronSpike/src/main/services/appUpdater.ts::startAppUpdate()`.

## Visual testing (no network)

```
# Full simulated lifecycle
smm-updater.exe --demo

# Speed things up / slow down
smm-updater.exe --demo --demo-speed 2.0

# Freeze on one phase for screenshots
smm-updater.exe --demo --phase connecting
smm-updater.exe --demo --phase downloading
smm-updater.exe --demo --phase verifying
smm-updater.exe --demo --phase waiting-for-app
smm-updater.exe --demo --phase launching
smm-updater.exe --demo --phase installing
smm-updater.exe --demo --phase relaunching
smm-updater.exe --demo --phase cleaning-up
smm-updater.exe --demo --phase done
smm-updater.exe --demo --phase failed
```

## Smoke test (--demo UI)

Quick local verification for the updater window without touching the network:

```powershell
cargo run --release -- --demo
```

Pass criteria:

- The updater window appears and advances through Connecting, Downloading,
  Verifying, Closing app, Installing update, Relaunching app, Cleaning up,
  then Done.
- The window auto-closes shortly after Done.
- `%LOCALAPPDATA%\StellarisModManager\updater.log` contains a fresh
  `mode=demo` startup line.

## Building

Prereqs: Rust 1.79+, Windows 10 or 11 (other platforms build but are not
shipped).

```
cargo build --release
```

The binary lands at `target/release/smm-updater.exe`. The repo-root
`build-installer.bat` runs this automatically and copies the output next to
`Stellaris Mod Manager.exe` so Inno Setup bundles it. The installer ships the
updater alongside the main app.

## Structure

| File              | Role                                               |
|-------------------|----------------------------------------------------|
| `src/main.rs`     | Entry point, window creation, thread wiring        |
| `src/cli.rs`      | Argument parsing (`clap`)                          |
| `src/app.rs`      | egui state machine + widgets                       |
| `src/theme.rs`    | Obsidian Ember palette + egui style install        |
| `src/events.rs`   | Worker → UI event enum                             |
| `src/worker.rs`   | Real download/verify/launch pipeline               |
| `src/download.rs` | Parallel chunk HTTP downloader                     |
| `src/verify.rs`   | SHA-256 streaming                                  |
| `src/install.rs`  | Installer spawn + browser-open fallback            |
| `src/demo.rs`     | Simulated lifecycle for visual testing             |
| `src/log.rs`      | File + stderr logging                              |
| `assets/`         | Icon, Windows manifest, resource file              |
