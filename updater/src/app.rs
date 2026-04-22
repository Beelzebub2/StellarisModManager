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
    Activity {
        phase: Phase,
        elapsed_secs: Option<u64>,
    },
    Downloading {
        downloaded: u64,
        total: u64,
        bytes_per_sec: f64,
        eta_secs: u64,
    },
    Verifying {
        checked: u64,
        total: u64,
    },
    Done { auto_close_at: Instant },
    Failed(String),
}

pub struct UpdaterApp {
    cli: Cli,
    rx: Receiver<UpdateEvent>,
    worker: Option<WorkerHandle>,
    state: UiState,
    current_step: usize,
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
            state: UiState::Activity {
                phase: Phase::Connecting,
                elapsed_secs: None,
            },
            current_step: step_index_for_phase(Phase::Connecting),
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
            UpdateEvent::Phase(phase) => {
                self.current_step = step_index_for_phase(phase);
                self.state = match phase {
                    Phase::Downloading => UiState::Downloading {
                        downloaded: 0,
                        total: 0,
                        bytes_per_sec: 0.0,
                        eta_secs: 0,
                    },
                    Phase::Verifying => UiState::Verifying {
                        checked: 0,
                        total: 0,
                    },
                    _ => UiState::Activity {
                        phase,
                        elapsed_secs: None,
                    },
                };
            }
            UpdateEvent::DownloadProgress {
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
                self.current_step = step_index_for_phase(Phase::Downloading);
            }
            UpdateEvent::VerifyProgress { checked, total } => {
                self.state = UiState::Verifying { checked, total };
                self.current_step = step_index_for_phase(Phase::Verifying);
            }
            UpdateEvent::ActivityTick { phase, elapsed_secs } => {
                self.state = UiState::Activity {
                    phase,
                    elapsed_secs: Some(elapsed_secs),
                };
                self.current_step = step_index_for_phase(phase);
            }
            UpdateEvent::Done => {
                self.state = UiState::Done {
                    auto_close_at: Instant::now() + Duration::from_secs(3),
                };
                self.current_step = UPDATE_STEPS.len().saturating_sub(1);
            }
            UpdateEvent::Failed(msg) => {
                self.state = UiState::Failed(msg);
            }
        }
    }
}

fn step_index_for_phase(phase: Phase) -> usize {
    match phase {
        Phase::Connecting => 0,
        Phase::Downloading => 1,
        Phase::Verifying => 2,
        Phase::WaitingForApp => 3,
        Phase::Launching | Phase::Installing => 4,
        Phase::Relaunching => 5,
        Phase::CleaningUp => 6,
    }
}

fn progress_mode_label(state: &UiState) -> &'static str {
    match state {
        UiState::Downloading { .. } | UiState::Verifying { .. } => "Measured progress",
        UiState::Activity { .. } => "Activity only",
        UiState::Done { .. } => "Completed",
        UiState::Failed(_) => "Action required",
    }
}

fn phase_heading(phase: Phase) -> &'static str {
    match phase {
        Phase::Connecting => "Connecting",
        Phase::Downloading => "Downloading",
        Phase::Verifying => "Verifying",
        Phase::WaitingForApp => "Closing app",
        Phase::Launching | Phase::Installing => "Installing update",
        Phase::Relaunching => "Relaunching app",
        Phase::CleaningUp => "Cleaning up",
    }
}

fn phase_detail(phase: Phase) -> &'static str {
    match phase {
        Phase::Connecting => "Contacting the download server.",
        Phase::Downloading => "Transferring the installer with real byte-level progress.",
        Phase::Verifying => "Checking the installer hash before it is allowed to run.",
        Phase::WaitingForApp => {
            "Waiting for Stellaris Mod Manager to exit so Windows releases the executable lock."
        }
        Phase::Launching => "Starting the installer. Windows may show a UAC prompt.",
        Phase::Installing => {
            "The installer is running in the background. Windows does not expose a reliable percentage here, so this stage stays activity-based until it finishes."
        }
        Phase::Relaunching => "Starting the updated app.",
        Phase::CleaningUp => "Removing staged updater files and temporary logs.",
    }
}

fn phase_elapsed_label(phase: Phase, elapsed_secs: Option<u64>) -> Option<String> {
    elapsed_secs.map(|secs| match phase {
        Phase::Installing => format!("running {}", format_eta(secs)),
        Phase::WaitingForApp => format!("waiting {}", format_eta(secs)),
        _ => format!("elapsed {}", format_eta(secs)),
    })
}

impl eframe::App for UpdaterApp {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.drain_events();
        ctx.request_repaint_after(Duration::from_millis(60));

        egui::SidePanel::left("steps_panel")
            .frame(egui::Frame::none().fill(theme::BG_1).inner_margin(Margin::symmetric(14.0, 20.0)).stroke(Stroke::new(0.0, Color32::TRANSPARENT)))
            .exact_width(220.0)
            .resizable(false)
            .show(ctx, |ui| {
                render_steps_sidebar(ui, self);
            });

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(theme::BG_BASE).inner_margin(Margin::symmetric(24.0, 24.0)))
            .show(ctx, |ui| {
                render_main_content(ui, self, frame);
            });

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

        if let Some(root) = self.cli.cleanup_root.as_deref() {
            let root = std::path::Path::new(root);
            if !root.as_os_str().is_empty() {
                install::schedule_self_delete(root);
            }
        }
    }
}

fn render_main_content(ui: &mut egui::Ui, app: &mut UpdaterApp, frame: &mut eframe::Frame) {
    egui::TopBottomPanel::top("main_header")
        .frame(egui::Frame::none().inner_margin(Margin::same(0.0)))
        .show_inside(ui, |ui| {
            render_header(ui, app);
            ui.add_space(16.0);
        });

    egui::TopBottomPanel::bottom("main_footer")
        .frame(egui::Frame::none().inner_margin(Margin::same(0.0)))
        .show_inside(ui, |ui| {
            ui.add_space(16.0);
            render_footer(ui, app, frame);
        });

    egui::CentralPanel::default()
        .frame(egui::Frame::none().inner_margin(Margin::symmetric(0.0, 16.0)))
        .show_inside(ui, |ui| {
            render_body(ui, app);
        });
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum StepStatus {
    Done,
    Active,
    Pending,
    Failed,
}

const UPDATE_STEPS: [&str; 8] = [
    "Connecting",
    "Downloading",
    "Verifying",
    "Closing app",
    "Installing update",
    "Relaunching app",
    "Cleaning up",
    "Finished",
];

fn step_status_for(app: &UpdaterApp, idx: usize) -> StepStatus {
    let current = app.current_step.min(UPDATE_STEPS.len().saturating_sub(1));

    if matches!(app.state, UiState::Done { .. }) {
        return StepStatus::Done;
    }

    if matches!(app.state, UiState::Failed(_)) {
        if idx < current {
            return StepStatus::Done;
        }
        if idx == current {
            return StepStatus::Failed;
        }
        return StepStatus::Pending;
    }

    if idx < current {
        StepStatus::Done
    } else if idx == current {
        StepStatus::Active
    } else {
        StepStatus::Pending
    }
}

fn render_steps_sidebar(ui: &mut egui::Ui, app: &UpdaterApp) {
    ui.label(
        RichText::new("Update Steps")
            .color(theme::TEXT_STRONG)
            .font(FontId::proportional(14.0))
            .strong(),
    );
    ui.add_space(12.0);

    for (idx, label) in UPDATE_STEPS.iter().enumerate() {
        let status = step_status_for(app, idx);
        let (dot_color, text_color) = match status {
            StepStatus::Done => (theme::SUCCESS, theme::TEXT_STRONG),
            StepStatus::Active => (theme::ACCENT, theme::ACCENT_HOVER),
            StepStatus::Pending => (theme::TEXT_DIM, theme::TEXT_MUTED),
            StepStatus::Failed => (theme::DANGER, theme::DANGER),
        };

        let row_fill = if status == StepStatus::Active {
            theme::ACCENT_SOFT
        } else {
            Color32::TRANSPARENT
        };

        egui::Frame::none()
            .fill(row_fill)
            .rounding(Rounding::same(6.0))
            .inner_margin(Margin::symmetric(8.0, 8.0))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let (rect, _) = ui.allocate_exact_size(egui::vec2(10.0, 10.0), egui::Sense::hover());
                    ui.painter().circle_filled(rect.center(), 5.0, dot_color);
                    ui.add_space(8.0);
                    ui.label(
                        RichText::new(*label)
                            .color(text_color)
                            .font(FontId::proportional(13.0))
                            .strong(),
                    );
                });
            });
        ui.add_space(4.0);
    }
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

        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            let badge_text = progress_mode_label(&app.state);
            let (fill, border, text) = match &app.state {
                UiState::Failed(_) => (theme::DANGER, theme::DANGER, theme::BG_BASE),
                UiState::Done { .. } => (theme::SUCCESS, theme::SUCCESS, theme::BG_BASE),
                UiState::Downloading { .. } | UiState::Verifying { .. } => {
                    (theme::ACCENT_SOFT, theme::ACCENT_BORDER, theme::ACCENT_HOVER)
                }
                UiState::Activity { .. } => (theme::BG_3, theme::BORDER, theme::TEXT_MUTED),
            };

            egui::Frame::none()
                .fill(fill)
                .stroke(Stroke::new(1.0, border))
                .rounding(Rounding::same(999.0))
                .inner_margin(Margin::symmetric(10.0, 6.0))
                .show(ui, |ui| {
                    ui.label(
                        RichText::new(badge_text)
                            .color(text)
                            .font(FontId::proportional(11.0))
                            .strong(),
                    );
                });
            ui.add_space(10.0);
            ui.label(
                RichText::new(format!(
                    "Step {} of {}",
                    app.current_step.saturating_add(1).min(UPDATE_STEPS.len()),
                    UPDATE_STEPS.len()
                ))
                .color(theme::TEXT_DIM)
                .font(FontId::proportional(11.5)),
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
        .inner_margin(Margin::symmetric(20.0, 16.0))
        .show(ui, |ui| {
            ui.set_min_height(ui.available_height());
            ui.set_width(ui.available_width());
            match &app.state {
                UiState::Downloading {
                    downloaded,
                    total,
                    bytes_per_sec,
                    eta_secs,
                } => render_downloading(ui, *downloaded, *total, *bytes_per_sec, *eta_secs),
                UiState::Verifying { checked, total } => render_verifying(ui, *checked, *total),
                UiState::Activity { phase, elapsed_secs } => {
                    render_activity_phase(ui, *phase, *elapsed_secs)
                }
                UiState::Done { .. } => render_done(ui),
                UiState::Failed(msg) => render_failed(ui, msg),
            }
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
        let left = format!(
            "{} / {}",
            format_bytes(downloaded),
            if total > 0 {
                format_bytes(total)
            } else {
                "—".to_string()
            }
        );

        let right = if total > 0 {
            format!(
                "{:.0}%  ·  {}/s  ·  ETA {}",
                pct * 100.0,
                format_bytes(bytes_per_sec.max(0.0) as u64),
                format_eta(eta_secs)
            )
        } else {
            format!("{}/s", format_bytes(bytes_per_sec.max(0.0) as u64))
        };

        if ui.available_width() >= 560.0 {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(&left)
                        .color(theme::TEXT_STRONG)
                        .font(FontId::proportional(12.5)),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(
                        RichText::new(&right)
                            .color(theme::TEXT_MUTED)
                            .font(FontId::proportional(12.0)),
                    );
                });
            });
        } else {
            ui.label(
                RichText::new(left)
                    .color(theme::TEXT_STRONG)
                    .font(FontId::proportional(12.5)),
            );
            ui.label(
                RichText::new(right)
                    .color(theme::TEXT_MUTED)
                    .font(FontId::proportional(12.0)),
            );
        }
    });
}

fn render_verifying(ui: &mut egui::Ui, checked: u64, total: u64) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Verifying", theme::ACCENT);
        ui.add_space(10.0);
        let pct = if total > 0 {
            (checked as f32 / total as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };
        progress_bar(ui, pct);
        ui.add_space(8.0);
        let left = format!(
            "{} / {}",
            format_bytes(checked),
            if total > 0 {
                format_bytes(total)
            } else {
                "—".to_string()
            }
        );
        let right = format!("{:.0}%", pct * 100.0);

        if ui.available_width() >= 560.0 {
            ui.horizontal(|ui| {
                ui.label(
                    RichText::new(&left)
                        .color(theme::TEXT_STRONG)
                        .font(FontId::proportional(12.5)),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(
                        RichText::new(&right)
                            .color(theme::TEXT_MUTED)
                            .font(FontId::proportional(12.0)),
                    );
                });
            });
        } else {
            ui.label(
                RichText::new(left)
                    .color(theme::TEXT_STRONG)
                    .font(FontId::proportional(12.5)),
            );
            ui.label(
                RichText::new(right)
                    .color(theme::TEXT_MUTED)
                    .font(FontId::proportional(12.0)),
            );
        }

        ui.add_space(8.0);
        ui.label(
            RichText::new(phase_detail(Phase::Verifying))
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(12.5)),
        );
    });
}

fn render_activity_phase(ui: &mut egui::Ui, phase: Phase, elapsed_secs: Option<u64>) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, phase_heading(phase), theme::ACCENT);
        ui.add_space(10.0);
        ui.label(
            RichText::new(phase_detail(phase))
                .color(theme::TEXT_MUTED)
                .font(FontId::proportional(13.0)),
        );
        ui.add_space(12.0);
        indeterminate_bar(ui);
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.label(
                RichText::new("Live activity")
                    .color(theme::TEXT_STRONG)
                    .font(FontId::proportional(12.0))
                    .strong(),
            );
            if let Some(elapsed) = phase_elapsed_label(phase, elapsed_secs) {
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(
                        RichText::new(elapsed)
                            .color(theme::TEXT_DIM)
                            .font(FontId::proportional(12.0)),
                    );
                });
            }
        });
    });
}

fn render_done(ui: &mut egui::Ui) {
    ui.with_layout(Layout::top_down(Align::LEFT), |ui| {
        phase_label(ui, "Update installed", theme::SUCCESS);
        ui.add_space(10.0);
        ui.label(
            RichText::new("Installation finished successfully. This window will close shortly.")
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

    let render_actions = |ui: &mut egui::Ui| {
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
        } else if secondary_button(ui, "Cancel").clicked() {
            if let Some(h) = app.worker.as_ref() {
                h.cancel
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);
        }
    };

    if ui.available_width() >= 520.0 {
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(elapsed_label(app.started))
                    .color(theme::TEXT_DIM)
                    .font(FontId::proportional(11.0)),
            );

            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                render_actions(ui);
            });
        });
    } else {
        ui.vertical(|ui| {
            ui.label(
                RichText::new(elapsed_label(app.started))
                    .color(theme::TEXT_DIM)
                    .font(FontId::proportional(11.0)),
            );
            ui.add_space(8.0);
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                render_actions(ui);
            });
        });
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::thread;

    fn test_cli() -> Cli {
        Cli {
            url: Some("https://example.com/update.exe".into()),
            version: Some("1.2.3".into()),
            sha256: None,
            release_url: None,
            app_exe: Some("C:\\Program Files\\Stellaris Mod Manager\\Stellaris Mod Manager.exe".into()),
            app_pid: Some(1234),
            cleanup_root: Some("C:\\Temp\\StellarisModManager-updater-test".into()),
            demo: false,
            phase: None,
            demo_speed: 1.0,
        }
    }

    fn test_app() -> UpdaterApp {
        let (_tx, rx) = std::sync::mpsc::channel();
        let worker = WorkerHandle {
            cancel: Arc::new(AtomicBool::new(false)),
            _join: thread::spawn(|| {}),
        };
        UpdaterApp::new(test_cli(), rx, worker, &egui::Context::default())
    }

    #[test]
    fn update_steps_include_explicit_close_relaunch_and_cleanup_stages() {
        assert_eq!(
            &UPDATE_STEPS[..],
            &[
                "Connecting",
                "Downloading",
                "Verifying",
                "Closing app",
                "Installing update",
                "Relaunching app",
                "Cleaning up",
                "Finished",
            ][..]
        );
    }

    #[test]
    fn launching_phase_uses_the_install_step() {
        let mut app = test_app();
        app.apply_event(UpdateEvent::Phase(Phase::Launching));
        assert_eq!(app.current_step, 4);
    }
}
