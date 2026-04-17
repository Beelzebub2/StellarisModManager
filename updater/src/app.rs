use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::{Duration, Instant};

use eframe::egui::{self, Align, Color32, FontId, Layout, Margin, Response, RichText, Rounding, Stroke};

use crate::cli::Cli;
use crate::events::{Phase, UpdateEvent};
use crate::install;
use crate::theme;
use crate::worker::WorkerHandle;

#[derive(Debug, Clone)]
enum UiState {
    Connecting,
    Downloading {
        downloaded: u64,
        total: u64,
        bytes_per_sec: f64,
        eta_secs: u64,
    },
    Verifying(f32),
    Launching,
    Done { auto_close_at: Instant },
    Failed(String),
}

pub struct UpdaterApp {
    cli: Cli,
    rx: Receiver<UpdateEvent>,
    worker: Option<WorkerHandle>,
    state: UiState,
    started: Instant,
}

impl UpdaterApp {
    pub fn new(
        cli: Cli,
        rx: Receiver<UpdateEvent>,
        worker: WorkerHandle,
        ctx: &egui::Context,
    ) -> Self {
        theme::install(ctx);
        Self {
            cli,
            rx,
            worker: Some(worker),
            state: UiState::Connecting,
            started: Instant::now(),
        }
    }

    fn drain_events(&mut self) {
        loop {
            match self.rx.try_recv() {
                Ok(ev) => self.apply_event(ev),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }
    }

    fn apply_event(&mut self, ev: UpdateEvent) {
        match ev {
            UpdateEvent::Phase(Phase::Connecting) => {
                self.state = UiState::Connecting;
            }
            UpdateEvent::Phase(Phase::Downloading) => {
                if !matches!(self.state, UiState::Downloading { .. }) {
                    self.state = UiState::Downloading {
                        downloaded: 0,
                        total: 0,
                        bytes_per_sec: 0.0,
                        eta_secs: 0,
                    };
                }
            }
            UpdateEvent::Phase(Phase::Verifying) => {
                self.state = UiState::Verifying(0.0);
            }
            UpdateEvent::Phase(Phase::Launching) => {
                self.state = UiState::Launching;
            }
            UpdateEvent::Progress {
                downloaded,
                total,
                bytes_per_sec,
                eta_secs,
            } => {
                self.state = UiState::Downloading {
                    downloaded,
                    total,
                    bytes_per_sec,
                    eta_secs,
                };
            }
            UpdateEvent::VerifyProgress(p) => {
                self.state = UiState::Verifying(p);
            }
            UpdateEvent::Done => {
                self.state = UiState::Done {
                    auto_close_at: Instant::now() + Duration::from_secs(2),
                };
            }
            UpdateEvent::Failed(msg) => {
                self.state = UiState::Failed(msg);
            }
        }
    }
}

impl eframe::App for UpdaterApp {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.drain_events();
        ctx.request_repaint_after(Duration::from_millis(60));

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(theme::BG_BASE).inner_margin(0.0))
            .show(ctx, |ui| render_window(ui, self, frame));

        // Auto-close after Done
        if let UiState::Done { auto_close_at } = self.state {
            if Instant::now() >= auto_close_at {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        if let Some(h) = self.worker.take() {
            h.cancel
                .store(true, std::sync::atomic::Ordering::Relaxed);
            // Don't block on join — worker threads are cooperative.
            drop(h);
        }
    }
}

fn render_window(ui: &mut egui::Ui, app: &mut UpdaterApp, frame: &mut eframe::Frame) {
    // Outer padded container for a "card" feel on top of BG_BASE.
    egui::Frame::none()
        .inner_margin(Margin::symmetric(28.0, 24.0))
        .show(ui, |ui| {
            render_header(ui, app);
            ui.add_space(18.0);
            render_body(ui, app);
            ui.add_space(16.0);
            render_footer(ui, app, frame);
        });
}

fn render_header(ui: &mut egui::Ui, app: &UpdaterApp) {
    ui.horizontal(|ui| {
        // Small accent dot
        let (rect, _) = ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
        ui.painter().circle_filled(rect.center(), 5.0, theme::ACCENT);

        ui.add_space(6.0);
        ui.vertical(|ui| {
            ui.label(
                RichText::new("Stellaris Mod Manager")
                    .color(theme::TEXT_STRONG)
                    .font(FontId::proportional(15.0))
                    .strong(),
            );
            let sub = match app.cli.version.as_deref() {
                Some(v) => format!("Updating to v{v}"),
                None => "Update".to_string(),
            };
            ui.label(
                RichText::new(sub)
                    .color(theme::TEXT_MUTED)
                    .font(FontId::proportional(12.0)),
            );
        });
    });
}

fn render_body(ui: &mut egui::Ui, app: &UpdaterApp) {
    // Card: rounded, slightly lighter than base
    egui::Frame::none()
        .fill(theme::BG_1)
        .stroke(Stroke::new(1.0, theme::BORDER))
        .rounding(Rounding::same(10.0))
        .inner_margin(Margin::symmetric(20.0, 18.0))
        .show(ui, |ui| {
            ui.set_min_height(130.0);
            match &app.state {
                UiState::Connecting => render_connecting(ui),
                UiState::Downloading {
                    downloaded,
                    total,
                    bytes_per_sec,
                    eta_secs,
                } => render_downloading(ui, *downloaded, *total, *bytes_per_sec, *eta_secs),
                UiState::Verifying(p) => render_verifying(ui, *p),
                UiState::Launching => render_launching(ui),
                UiState::Done { .. } => render_done(ui),
                UiState::Failed(msg) => render_failed(ui, msg),
            }
        });
}

fn render_connecting(ui: &mut egui::Ui) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Connecting", theme::ACCENT);
        ui.add_space(10.0);
        ui.label(
            RichText::new("Contacting the download server…")
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(13.0)),
        );
        ui.add_space(16.0);
        indeterminate_bar(ui);
    });
}

fn render_downloading(
    ui: &mut egui::Ui,
    downloaded: u64,
    total: u64,
    bytes_per_sec: f64,
    eta_secs: u64,
) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Downloading", theme::ACCENT);
        ui.add_space(10.0);

        let pct = if total > 0 {
            (downloaded as f32 / total as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };
        progress_bar(ui, pct);

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            let left = format!(
                "{} / {}",
                format_bytes(downloaded),
                if total > 0 {
                    format_bytes(total)
                } else {
                    "—".to_string()
                }
            );
            ui.label(
                RichText::new(left)
                    .color(theme::TEXT_STRONG)
                    .font(FontId::proportional(12.5)),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let right = if total > 0 {
                    format!(
                        "{:.0}%  ·  {}/s  ·  ETA {}",
                        pct * 100.0,
                        format_bytes(bytes_per_sec.max(0.0) as u64),
                        format_eta(eta_secs)
                    )
                } else {
                    format!(
                        "{}/s",
                        format_bytes(bytes_per_sec.max(0.0) as u64)
                    )
                };
                ui.label(
                    RichText::new(right)
                        .color(theme::TEXT_MUTED)
                        .font(FontId::proportional(12.0)),
                );
            });
        });
    });
}

fn render_verifying(ui: &mut egui::Ui, progress: f32) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Verifying", theme::ACCENT);
        ui.add_space(10.0);
        progress_bar(ui, progress.clamp(0.0, 1.0));
        ui.add_space(8.0);
        ui.label(
            RichText::new("Checking integrity of the downloaded installer…")
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(12.5)),
        );
    });
}

fn render_launching(ui: &mut egui::Ui) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Launching installer", theme::ACCENT);
        ui.add_space(10.0);
        ui.label(
            RichText::new("Opening the installer — Windows may show a UAC prompt.")
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(13.0)),
        );
        ui.add_space(16.0);
        indeterminate_bar(ui);
    });
}

fn render_done(ui: &mut egui::Ui) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Handed off to installer", theme::SUCCESS);
        ui.add_space(10.0);
        ui.label(
            RichText::new("The installer is running. This window will close shortly.")
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(13.0)),
        );
    });
}

fn render_failed(ui: &mut egui::Ui, msg: &str) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Update failed", theme::DANGER);
        ui.add_space(10.0);
        ui.label(
            RichText::new(msg)
                .color(theme::TEXT_STRONG)
                .font(FontId::proportional(13.0)),
        );
        ui.add_space(8.0);
        ui.label(
            RichText::new("You can retry, download the installer manually, or close this window.")
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(12.0)),
        );
    });
}

fn render_footer(ui: &mut egui::Ui, app: &mut UpdaterApp, frame: &mut eframe::Frame) {
    let is_failed = matches!(app.state, UiState::Failed(_));
    let is_done = matches!(app.state, UiState::Done { .. });

    ui.horizontal(|ui| {
        ui.label(
            RichText::new(elapsed_label(app.started))
                .color(theme::TEXT_DIM)
                .font(FontId::proportional(11.0)),
        );

        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if is_failed {
                if primary_button(ui, "Close").clicked() {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
                ui.add_space(8.0);
                if let Some(url) = app.cli.release_url.clone() {
                    if secondary_button(ui, "Download manually").clicked() {
                        install::open_in_browser(&url);
                    }
                    ui.add_space(8.0);
                }
            } else if is_done {
                if primary_button(ui, "Close").clicked() {
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            } else {
                if secondary_button(ui, "Cancel").clicked() {
                    if let Some(h) = app.worker.as_ref() {
                        h.cancel
                            .store(true, std::sync::atomic::Ordering::Relaxed);
                    }
                    ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
        });
    });
    let _ = frame;
}

// --- primitives ---

fn phase_label(ui: &mut egui::Ui, text: &str, color: Color32) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(egui::vec2(8.0, 8.0), egui::Sense::hover());
        ui.painter().circle_filled(rect.center(), 4.0, color);
        ui.add_space(6.0);
        ui.label(
            RichText::new(text)
                .color(color)
                .font(FontId::proportional(13.0))
                .strong(),
        );
    });
}

fn progress_bar(ui: &mut egui::Ui, fraction: f32) {
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), 10.0),
        egui::Sense::hover(),
    );
    let painter = ui.painter();
    painter.rect_filled(rect, Rounding::same(5.0), theme::BG_3);

    if fraction > 0.0 {
        let mut fill = rect;
        fill.max.x = rect.min.x + rect.width() * fraction.clamp(0.0, 1.0);
        // Linear-gradient approximation: two overlapping rects
        painter.rect_filled(fill, Rounding::same(5.0), theme::ACCENT);
        // Soft glow on the right edge
        let glow = egui::Rect::from_min_max(
            egui::pos2(fill.max.x - 12.0, fill.min.y),
            egui::pos2(fill.max.x, fill.max.y),
        );
        if glow.max.x > glow.min.x {
            painter.rect_filled(glow, Rounding::same(5.0), theme::ACCENT_HOVER);
        }
    }
}

fn indeterminate_bar(ui: &mut egui::Ui) {
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), 4.0),
        egui::Sense::hover(),
    );
    let painter = ui.painter();
    painter.rect_filled(rect, Rounding::same(2.0), theme::BG_3);

    let t = ui.input(|i| i.time) as f32;
    let cycle = 1.8; // seconds per sweep
    let p = ((t % cycle) / cycle).clamp(0.0, 1.0);
    let bar_w = rect.width() * 0.28;
    let start_x = rect.min.x - bar_w + (rect.width() + bar_w) * p;
    let end_x = (start_x + bar_w).min(rect.max.x);
    let clip_start = start_x.max(rect.min.x);
    if end_x > clip_start {
        let bar = egui::Rect::from_min_max(
            egui::pos2(clip_start, rect.min.y),
            egui::pos2(end_x, rect.max.y),
        );
        painter.rect_filled(bar, Rounding::same(2.0), theme::ACCENT);
    }
    ui.ctx().request_repaint_after(Duration::from_millis(16));
}

fn primary_button(ui: &mut egui::Ui, text: &str) -> Response {
    let btn = egui::Button::new(
        RichText::new(text)
            .color(theme::BG_BASE)
            .font(FontId::proportional(13.0))
            .strong(),
    )
    .fill(theme::ACCENT)
    .stroke(Stroke::new(1.0, theme::ACCENT_BORDER))
    .rounding(Rounding::same(7.0))
    .min_size(egui::vec2(96.0, 32.0));
    ui.add(btn)
}

fn secondary_button(ui: &mut egui::Ui, text: &str) -> Response {
    let btn = egui::Button::new(
        RichText::new(text)
            .color(theme::TEXT_STRONG)
            .font(FontId::proportional(13.0)),
    )
    .fill(theme::BG_3)
    .stroke(Stroke::new(1.0, theme::BORDER))
    .rounding(Rounding::same(7.0))
    .min_size(egui::vec2(96.0, 32.0));
    ui.add(btn)
}

// --- formatting ---

fn format_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.2} GB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.1} MB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.1} KB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}

fn format_eta(secs: u64) -> String {
    if secs == 0 {
        "—".to_string()
    } else if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m {:02}s", secs / 60, secs % 60)
    } else {
        format!("{}h {:02}m", secs / 3600, (secs % 3600) / 60)
    }
}

fn elapsed_label(started: Instant) -> String {
    let s = started.elapsed().as_secs();
    format!("elapsed {}", format_eta(s.max(1)))
}
