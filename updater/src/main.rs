// On Windows release builds, don't spawn a console window behind the GUI.
#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod cli;
mod demo;
mod download;
mod events;
mod install;
mod log;
mod theme;
mod verify;
mod worker;

use std::sync::mpsc;

use clap::Parser;
use eframe::egui;

use crate::app::UpdaterApp;
use crate::cli::Cli;

fn main() -> eframe::Result<()> {
    let cli = Cli::parse();
    if let Err(e) = cli.validate() {
        eprintln!("smm-updater: {e}\nTry --help for usage.");
        std::process::exit(2);
    }

    log::init();
    log::info(&format!(
        "mode={} url={:?} version={:?} sha256={} release_url={:?} phase={:?}",
        if cli.demo { "demo" } else { "real" },
        cli.url,
        cli.version,
        cli.sha256.is_some(),
        cli.release_url,
        cli.phase,
    ));

    let (tx, rx) = mpsc::channel();

    let worker = if cli.demo {
        demo::spawn(cli.clone(), tx)
    } else {
        worker::spawn_real(cli.clone(), tx)
    };

    let icon = load_window_icon();

    let viewport = egui::ViewportBuilder::default()
        .with_title("Stellaris Mod Manager — Update")
        .with_inner_size([520.0, 330.0])
        .with_min_inner_size([520.0, 330.0])
        .with_resizable(false)
        .with_decorations(true)
        .with_maximize_button(false)
        .with_icon(icon.unwrap_or_default());

    let options = eframe::NativeOptions {
        viewport,
        centered: true,
        ..Default::default()
    };

    eframe::run_native(
        "smm-updater",
        options,
        Box::new(move |cc| {
            Ok(Box::new(UpdaterApp::new(cli, rx, worker, &cc.egui_ctx)))
        }),
    )
}

fn load_window_icon() -> Option<egui::IconData> {
    // The .ico is embedded in the binary via assets/app.rc for the taskbar,
    // but egui needs raw RGBA for its viewport icon. We attempt to read the
    // bundled icon from alongside the exe; if missing, skip.
    let exe = std::env::current_exe().ok()?;
    let ico = exe.parent()?.join("app.ico");
    let bytes = std::fs::read(&ico).ok()?;
    decode_ico(&bytes)
}

fn decode_ico(_bytes: &[u8]) -> Option<egui::IconData> {
    // egui does not ship an .ico decoder. Leaving this as None means the
    // Windows embedded RT_ICON (from app.rc) still provides the exe icon and
    // taskbar icon. We skip setting a runtime viewport icon to avoid pulling
    // in the `image` crate for ~nothing.
    None
}
