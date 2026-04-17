//! Obsidian Ember palette — mirrored from ElectronSpike/src/renderer/styles.css.
//! Keep these in sync if the Electron theme changes.

use eframe::egui::{self, Color32, Stroke};

pub const BG_BASE: Color32 = Color32::from_rgb(0x0A, 0x0C, 0x10);
pub const BG_1: Color32 = Color32::from_rgb(0x0E, 0x11, 0x17);
pub const BG_2: Color32 = Color32::from_rgb(0x14, 0x18, 0x20);
pub const BG_3: Color32 = Color32::from_rgb(0x1A, 0x1F, 0x2A);
pub const BG_4: Color32 = Color32::from_rgb(0x21, 0x27, 0x35);

pub const TEXT_STRONG: Color32 = Color32::from_rgb(0xF1, 0xF5, 0xF9);
pub const TEXT_MUTED: Color32 = Color32::from_rgb(0x94, 0xA3, 0xB8);
pub const TEXT_DIM: Color32 = Color32::from_rgb(0x64, 0x74, 0x8B);

pub const ACCENT: Color32 = Color32::from_rgb(0x0E, 0xA5, 0xE9);
pub const ACCENT_HOVER: Color32 = Color32::from_rgb(0x38, 0xBD, 0xF8);
pub const ACCENT_SOFT: Color32 = Color32::from_rgba_premultiplied(0x0E, 0xA5, 0xE9, 0x26);
pub const ACCENT_BORDER: Color32 = Color32::from_rgba_premultiplied(0x0E, 0xA5, 0xE9, 0x4D);

pub const DANGER: Color32 = Color32::from_rgb(0xEF, 0x44, 0x44);
pub const SUCCESS: Color32 = Color32::from_rgb(0x22, 0xC5, 0x5E);

pub const BORDER: Color32 = Color32::from_rgb(0x1F, 0x25, 0x30);

pub fn install(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    let visuals = &mut style.visuals;

    visuals.dark_mode = true;
    visuals.override_text_color = Some(TEXT_STRONG);

    visuals.panel_fill = BG_BASE;
    visuals.window_fill = BG_BASE;
    visuals.extreme_bg_color = BG_1;
    visuals.faint_bg_color = BG_2;
    visuals.code_bg_color = BG_2;

    // Default widget (unselected / normal): cards
    let w = &mut visuals.widgets;
    w.noninteractive.bg_fill = BG_2;
    w.noninteractive.weak_bg_fill = BG_1;
    w.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    w.noninteractive.fg_stroke = Stroke::new(1.0, TEXT_MUTED);

    w.inactive.bg_fill = BG_3;
    w.inactive.weak_bg_fill = BG_3;
    w.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    w.inactive.fg_stroke = Stroke::new(1.0, TEXT_STRONG);
    w.inactive.rounding = egui::Rounding::same(6.0);

    w.hovered.bg_fill = BG_4;
    w.hovered.weak_bg_fill = BG_4;
    w.hovered.bg_stroke = Stroke::new(1.0, ACCENT_BORDER);
    w.hovered.fg_stroke = Stroke::new(1.5, TEXT_STRONG);
    w.hovered.rounding = egui::Rounding::same(6.0);

    w.active.bg_fill = ACCENT_SOFT;
    w.active.weak_bg_fill = ACCENT_SOFT;
    w.active.bg_stroke = Stroke::new(1.0, ACCENT_BORDER);
    w.active.fg_stroke = Stroke::new(1.5, ACCENT);
    w.active.rounding = egui::Rounding::same(6.0);

    w.open.bg_fill = BG_3;
    w.open.weak_bg_fill = BG_3;
    w.open.bg_stroke = Stroke::new(1.0, BORDER);
    w.open.fg_stroke = Stroke::new(1.0, TEXT_STRONG);

    visuals.selection.bg_fill = ACCENT;
    visuals.selection.stroke = Stroke::new(1.0, TEXT_STRONG);

    visuals.hyperlink_color = ACCENT_HOVER;

    style.spacing.item_spacing = egui::vec2(12.0, 10.0);
    style.spacing.button_padding = egui::vec2(14.0, 8.0);
    style.spacing.window_margin = egui::Margin::same(0.0);

    ctx.set_style(style);
}
