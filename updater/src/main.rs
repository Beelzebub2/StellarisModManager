// On Windows release builds, don't spawn a console window behind the GUI.
#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod artifacts;
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
use std::{fs, io::Cursor};

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

    let mut viewport = egui::ViewportBuilder::default()
        .with_title("Stellaris Mod Manager — Update")
        .with_inner_size([780.0, 500.0])
        .with_min_inner_size([560.0, 360.0])
        .with_resizable(true)
        .with_decorations(true);

    if let Some(icon) = load_window_icon() {
        viewport = viewport.with_icon(icon);
    }

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
    decode_ico(include_bytes!("../assets/app.ico")).or_else(|| {
        // Fallback to sidecar app.ico for local/dev launches.
        let exe = std::env::current_exe().ok()?;
        let ico = exe.parent()?.join("app.ico");
        let bytes = fs::read(&ico).ok()?;
        decode_ico(&bytes)
    })
}

fn decode_ico(bytes: &[u8]) -> Option<egui::IconData> {
    let image = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?
        .to_rgba8();

    Some(egui::IconData {
        width: image.width(),
        height: image.height(),
        rgba: image.into_raw(),
    })
}
