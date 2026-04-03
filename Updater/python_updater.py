#!/usr/bin/env python3
"""
Stellaris Mod Manager Python Updater

Clean-room implementation of the updater workflow:
- Wait for parent app process to exit
- Download installer with GitHub fallback for stale release assets
- Run Inno Setup installer silently
- Relaunch app and write status updates
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import queue
import subprocess
import sys
import threading
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

try:
    import tkinter as tk
    from tkinter import ttk
except Exception as exc:
    print(f"tkinter is required for updater UI: {exc}", file=sys.stderr)
    sys.exit(1)


DEFAULT_STELLARISYNC_BASE_URL = "https://stellarisync.rrmtools.uk"
DEFAULT_GITHUB_REPO = "Beelzebub2/StellarisModManager"
DEFAULT_SETUP_NAME = "StellarisModManager-Setup.exe"


class UpdateCancelled(Exception):
    pass


class UpdateError(Exception):
    pass


@dataclass
class ReleaseInfo:
    version: str
    release_url: str
    download_url: str
    changelog: str = ""
    critical: bool = False
    source: str = ""
    released_at: str = ""


@dataclass
class UpdateRequest:
    parent_pid: int
    app_exe_path: str
    download_url: str
    release_url: str
    target_version: str
    startup_signal_path: str
    cleanup_root: str


class Theme:
    APP_BG = "#121820"
    PANEL_BG = "#1a2330"
    CARD_BG = "#1e2a3a"
    BORDER = "#2a3648"
    TEXT_PRIMARY = "#f4f8ff"
    TEXT_MUTED = "#a8b4c7"
    ACCENT = "#22b8ff"
    SUCCESS = "#6fd7a6"
    WARN = "#e2be67"
    ERROR = "#f08f8f"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_updates_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        root = Path(local_app_data)
    else:
        root = Path.home() / "AppData" / "Local"

    updates_dir = root / "StellarisModManager" / "updates"
    updates_dir.mkdir(parents=True, exist_ok=True)
    return updates_dir


def get_status_file() -> Path:
    return get_updates_dir() / "update-status.json"


def write_status(step: str, message: str, target_version: Optional[str], success: bool) -> None:
    payload = {
        "Step": step,
        "Message": message,
        "TargetVersion": target_version,
        "Success": success,
        "UpdatedAtUtc": utc_now_iso(),
    }
    try:
        get_status_file().write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception:
        # Best-effort status reporting.
        pass


def clean_string(value: Optional[str], max_len: int = 256) -> str:
    if not value:
        return ""
    return str(value).strip()[:max_len]


def parse_semver(version: str) -> Tuple[int, int, int]:
    text = clean_string(version)
    base = text.split("+", 1)[0].split("-", 1)[0]
    parts = base.split(".")

    out: List[int] = []
    for i in range(3):
        if i < len(parts):
            try:
                out.append(int(parts[i]))
            except ValueError:
                out.append(0)
        else:
            out.append(0)

    return out[0], out[1], out[2]


def is_newer_version(candidate: str, current: str) -> bool:
    return parse_semver(candidate) > parse_semver(current)


def parse_release_tag_url(release_url: str) -> Optional[Tuple[str, str, str]]:
    try:
        parsed = urlparse(release_url)
        if parsed.netloc.lower() != "github.com":
            return None

        segments = [segment for segment in parsed.path.split("/") if segment]
        if len(segments) < 5:
            return None

        if segments[2].lower() != "releases" or segments[3].lower() != "tag":
            return None

        owner, repo, tag = segments[0], segments[1], segments[4]
        if owner and repo and tag:
            return owner, repo, tag
        return None
    except Exception:
        return None


def try_file_name_from_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(url)
        name = os.path.basename(parsed.path)
        return name or None
    except Exception:
        return None


def build_request(url: str, accept_json: bool = False) -> Request:
    headers = {
        "User-Agent": "StellarisModManagerPythonUpdater/1.0",
        "Accept": "application/vnd.github+json" if accept_json else "*/*",
    }
    return Request(url=url, headers=headers)


def fetch_json(url: str, timeout_sec: int = 30) -> dict:
    req = build_request(url, accept_json=True)
    with urlopen(req, timeout=timeout_sec) as response:
        raw = response.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise UpdateError(f"Invalid JSON payload from {url}")
        return data


def fetch_latest_from_stellarisync(base_url: str) -> Optional[ReleaseInfo]:
    endpoint = base_url.rstrip("/") + "/app-release/latest"
    try:
        data = fetch_json(endpoint)
    except Exception:
        return None

    download_url = clean_string(data.get("downloadUrl"), 1000)
    release_url = clean_string(data.get("releaseUrl"), 1000)
    version = clean_string(data.get("version"), 120)

    if not (download_url and release_url and version):
        return None

    return ReleaseInfo(
        version=version,
        release_url=release_url,
        download_url=download_url,
        changelog=clean_string(data.get("changelog"), 40000),
        critical=bool(data.get("critical") is True),
        source=clean_string(data.get("source"), 120),
        released_at=clean_string(data.get("releasedAt"), 120),
    )


def fetch_latest_from_github(repo: str, include_prerelease: bool = False) -> Optional[ReleaseInfo]:
    owner_repo = clean_string(repo, 200)
    if "/" not in owner_repo:
        return None

    if include_prerelease:
        endpoint = f"https://api.github.com/repos/{owner_repo}/releases?per_page=20"
    else:
        endpoint = f"https://api.github.com/repos/{owner_repo}/releases/latest"

    try:
        req = build_request(endpoint, accept_json=True)
        with urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8", errors="replace")
            payload = json.loads(raw)
    except Exception:
        return None

    if include_prerelease and isinstance(payload, list):
        chosen = None
        for rel in payload:
            if not isinstance(rel, dict):
                continue
            if rel.get("draft"):
                continue
            chosen = rel
            break
        data = chosen
    elif isinstance(payload, dict):
        data = payload
    else:
        data = None

    if not isinstance(data, dict):
        return None

    assets = data.get("assets")
    download_url = ""
    if isinstance(assets, list):
        for asset in assets:
            if not isinstance(asset, dict):
                continue
            name = clean_string(asset.get("name"), 512)
            if not name.lower().endswith(".exe"):
                continue
            download_url = clean_string(asset.get("browser_download_url"), 1200)
            if download_url:
                break

    if not download_url:
        return None

    version = clean_string(data.get("tag_name"), 120) or clean_string(data.get("name"), 120)
    version = version.lstrip("vV")

    return ReleaseInfo(
        version=version,
        release_url=clean_string(data.get("html_url"), 1000),
        download_url=download_url,
        changelog=clean_string(data.get("body"), 40000),
        critical=False,
        source="github",
        released_at=clean_string(data.get("published_at"), 120),
    )


def resolve_fallback_download_url(release_url: str) -> Optional[str]:
    parsed = parse_release_tag_url(release_url)
    if not parsed:
        return None

    owner, repo, tag = parsed
    endpoint = (
        f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{quote(tag, safe='')}"
    )

    try:
        data = fetch_json(endpoint)
    except Exception:
        return None

    assets = data.get("assets")
    if not isinstance(assets, list):
        return None

    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = clean_string(asset.get("name"), 512)
        if not name.lower().endswith(".exe"):
            continue
        browser_url = clean_string(asset.get("browser_download_url"), 1200)
        if browser_url:
            return browser_url

    return None


def is_stale_asset_http_status(status_code: Optional[int]) -> bool:
    return status_code in (403, 404, 410)


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    WAIT_TIMEOUT = 0x102

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not handle:
        return False

    try:
        wait_result = kernel32.WaitForSingleObject(handle, 0)
        return wait_result == WAIT_TIMEOUT
    finally:
        kernel32.CloseHandle(handle)


def kill_process_tree(pid: int) -> None:
    if pid <= 0:
        return

    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW

    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=flags,
        )
    except Exception:
        pass


def schedule_cleanup(cleanup_root: str) -> None:
    root = clean_string(cleanup_root, 1000)
    if not root:
        return

    script_path = Path(sys.argv[0]).resolve()
    escaped_script = str(script_path).replace('"', '""')
    escaped_root = root.replace('"', '""')
    command = (
        f"/c timeout /t 2 /nobreak >nul & "
        f"del /f /q \"{escaped_script}\" & "
        f"rmdir /s /q \"{escaped_root}\""
    )

    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW

    try:
        subprocess.Popen(
            ["cmd.exe", command],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
    except Exception:
        pass


def safe_delete(path: str) -> None:
    try:
        p = Path(path)
        if p.exists() and p.is_file():
            p.unlink()
    except Exception:
        pass


def start_app(app_exe_path: str) -> bool:
    path = clean_string(app_exe_path, 1000)
    if not path:
        return False

    app_file = Path(path)
    if not app_file.exists():
        return False

    working_dir = str(app_file.parent)
    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW

    try:
        subprocess.Popen(
            [str(app_file)],
            cwd=working_dir,
            creationflags=flags,
            shell=False,
        )
        return True
    except Exception:
        return False


class UpdaterEngine:
    def __init__(self, request: UpdateRequest, cancel_event: threading.Event):
        self.request = request
        self.cancel_event = cancel_event
        self.installer_proc: Optional[subprocess.Popen] = None

    def _check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise UpdateCancelled("Update cancelled by user.")

    def try_write_startup_signal(self) -> None:
        startup_path = clean_string(self.request.startup_signal_path, 1000)
        if not startup_path:
            return

        try:
            signal_file = Path(startup_path)
            signal_file.parent.mkdir(parents=True, exist_ok=True)
            signal_file.write_text(utc_now_iso(), encoding="utf-8")
        except Exception:
            pass

    def wait_for_parent_exit(
        self,
        progress_callback: Callable[[int], None],
        timeout_sec: float = 90.0,
    ) -> None:
        pid = self.request.parent_pid
        if pid <= 0:
            return

        started = time.monotonic()
        while process_exists(pid):
            self._check_cancelled()
            elapsed = time.monotonic() - started
            percent = int(min(100.0, (elapsed / timeout_sec) * 100.0))
            progress_callback(percent)

            if elapsed >= timeout_sec:
                break

            time.sleep(0.25)

        if process_exists(pid):
            kill_process_tree(pid)

        time.sleep(0.5)

    def download_installer(
        self,
        step_callback: Callable[[str, str, int], None],
        chunk_callback: Callable[[int, Optional[int], int], None],
    ) -> str:
        self._check_cancelled()

        version_folder = clean_string(self.request.target_version, 120) or "latest"
        base_dir = get_updates_dir() / version_folder
        base_dir.mkdir(parents=True, exist_ok=True)

        download_url = self.request.download_url
        target_name = try_file_name_from_url(download_url)
        if not target_name or not target_name.lower().endswith(".exe"):
            target_name = DEFAULT_SETUP_NAME

        target_path = base_dir / target_name
        used_fallback = False

        while True:
            try:
                step_callback("Downloading", "Downloading installer package...", 12)
                self._download_file(download_url, target_path, chunk_callback)
                return str(target_path)
            except HTTPError as ex:
                if used_fallback or not is_stale_asset_http_status(ex.code):
                    raise

                fallback = resolve_fallback_download_url(self.request.release_url)
                if not fallback or fallback.lower() == download_url.lower():
                    raise

                fallback_name = try_file_name_from_url(fallback)
                if fallback_name and fallback_name.lower().endswith(".exe"):
                    target_path = base_dir / fallback_name

                download_url = fallback
                used_fallback = True
            except URLError:
                raise

    def _download_file(
        self,
        url: str,
        target_path: Path,
        chunk_callback: Callable[[int, Optional[int], int], None],
    ) -> None:
        req = build_request(url, accept_json=False)

        with urlopen(req, timeout=60) as response:
            length_text = response.headers.get("Content-Length")
            total_bytes: Optional[int]
            try:
                total_bytes = int(length_text) if length_text else None
            except ValueError:
                total_bytes = None

            downloaded = 0
            with open(target_path, "wb") as out:
                while True:
                    self._check_cancelled()
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break

                    out.write(chunk)
                    downloaded += len(chunk)

                    if total_bytes and total_bytes > 0:
                        percent = int((downloaded * 100) / total_bytes)
                    else:
                        percent = 0

                    chunk_callback(downloaded, total_bytes, max(0, min(100, percent)))

    def get_installer_log_path(self, installer_path: str) -> Path:
        installer_dir = Path(installer_path).parent
        installer_dir.mkdir(parents=True, exist_ok=True)
        return installer_dir / "installer-run.log"

    def run_installer(
        self,
        installer_path: str,
        progress_callback: Callable[[int], None],
    ) -> int:
        file_path = Path(installer_path)
        if not file_path.exists():
            raise UpdateError("Installer file not found.")

        log_path = self.get_installer_log_path(installer_path)
        args = [
            str(file_path),
            "/VERYSILENT",
            "/SUPPRESSMSGBOXES",
            "/NORESTART",
            "/CLOSEAPPLICATIONS",
            "/SP-",
            f"/LOG={str(log_path)}",
        ]

        flags = 0
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            flags = subprocess.CREATE_NO_WINDOW

        self.installer_proc = subprocess.Popen(
            args,
            cwd=str(file_path.parent),
            shell=False,
            creationflags=flags,
        )

        started_at = time.monotonic()
        while True:
            self._check_cancelled()
            assert self.installer_proc is not None
            code = self.installer_proc.poll()
            if code is not None:
                return code

            estimated = estimate_installer_progress(log_path, started_at)
            progress_callback(estimated)
            time.sleep(0.35)

    def cancel_installer(self) -> None:
        proc = self.installer_proc
        if proc is None:
            return

        try:
            code = proc.poll()
            if code is None:
                kill_process_tree(proc.pid)
        except Exception:
            pass


def count_lines(path: Path) -> int:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as infile:
            return sum(1 for _ in infile)
    except Exception:
        return 0


def estimate_installer_progress(log_path: Path, started_at_monotonic: float) -> int:
    elapsed = max(0.0, time.monotonic() - started_at_monotonic)
    time_factor = min(1.0, elapsed / 120.0)

    log_lines = count_lines(log_path)
    log_factor = min(1.0, float(log_lines) / 150.0)

    blended = (time_factor * 0.55) + (log_factor * 0.45)
    value = 25 + int(round(blended * 60.0))
    return max(25, min(85, value))


class UpdaterWindow:
    def __init__(self, request: UpdateRequest):
        self.request = request
        self.root = tk.Tk()
        self.root.title("Stellaris Mod Manager Updater")
        self.root.configure(bg="#0a121d")
        self.root.resizable(False, False)
        self.root.overrideredirect(True)

        win_w, win_h = 540, 340
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = (screen_w - win_w) // 2
        y = (screen_h - win_h) // 2
        self.root.geometry(f"{win_w}x{win_h}+{x}+{y}")
        self.root.attributes("-topmost", True)
        self.root.after(3000, lambda: self.root.attributes("-topmost", False))

        self.colors = {
            "bg": "#0a1119",
            "panel": "#101a26",
            "panel_border": "#23354a",
            "panel_hover": "#18283a",
            "rail": "#0c1622",
            "text_primary": "#e8f3ff",
            "text_secondary": "#a8bfd8",
            "text_muted": "#7f9ab6",
            "text_subtle": "#56708d",
            "accent": "#31b4ff",
            "accent_hover": "#56c4ff",
            "accent_dark": "#1a7fb8",
            "success": "#66d19b",
            "warn": "#e0b964",
            "error": "#f07e8d",
            "progress_trough": "#162536",
            "step_done": "#66d19b",
            "step_active": "#31b4ff",
            "step_pending": "#4f6782",
        }

        self.status_queue: "queue.Queue[Tuple[str, Any]]" = queue.Queue()
        self.cancel_event = threading.Event()
        self.worker: Optional[threading.Thread] = None
        self.engine = UpdaterEngine(request, self.cancel_event)
        self.is_running = False
        self.retry_mode = False
        self.scheduled_cleanup = False
        self.installer_path = ""
        self.stage_defs: List[Tuple[str, str]] = [
            ("close", "Close App"),
            ("download", "Download Update"),
            ("install", "Install Update"),
            ("verify", "Verify Install"),
            ("done", "Done"),
        ]
        self.stage_icon_labels: dict[str, tk.Label] = {}
        self.stage_text_labels: dict[str, tk.Label] = {}
        self.active_stage_index = -1

        self._drag_x = 0
        self._drag_y = 0
        self._progress_current = 0.0
        self._progress_target = 0.0
        self._tick_ms = 8
        self._lerp_speed = 0.1

        self._build_ui()
        self._apply_window_icon()
        self._wire_events()

    def _build_ui(self) -> None:
        self.style = ttk.Style(self.root)
        try:
            self.style.theme_use("clam")
        except tk.TclError:
            pass

        self.style.configure(
            "Stellaris.Horizontal.TProgressbar",
            troughcolor=self.colors["progress_trough"],
            bordercolor=self.colors["progress_trough"],
            background=self.colors["accent"],
            lightcolor=self.colors["accent"],
            darkcolor=self.colors["accent_dark"],
            thickness=10,
            troughrelief="flat",
            relief="flat",
        )

        outer = tk.Frame(self.root, bg=self.colors["panel_border"])
        outer.pack(fill=tk.BOTH, expand=True, padx=1, pady=1)

        card = tk.Frame(outer, bg=self.colors["panel"], bd=0)
        card.pack(fill=tk.BOTH, expand=True)

        title_bar = tk.Frame(card, bg=self.colors["bg"], height=32, bd=0)
        title_bar.pack(fill=tk.X, side=tk.TOP)
        title_bar.pack_propagate(False)
        title_bar.bind("<ButtonPress-1>", self._on_drag_start)
        title_bar.bind("<B1-Motion>", self._on_drag_motion)

        title_bar_label = tk.Label(
            title_bar,
            text="  Stellaris Mod Manager Updater",
            fg=self.colors["text_muted"],
            bg=self.colors["bg"],
            font=("Segoe UI", 9),
            anchor="w",
        )
        title_bar_label.pack(side=tk.LEFT, fill=tk.Y, padx=(4, 0))
        title_bar_label.bind("<ButtonPress-1>", self._on_drag_start)
        title_bar_label.bind("<B1-Motion>", self._on_drag_motion)

        self.close_btn = tk.Label(
            title_bar,
            text=" ✕ ",
            fg=self.colors["text_muted"],
            bg=self.colors["bg"],
            font=("Segoe UI", 11),
            cursor="hand2",
        )
        self.close_btn.pack(side=tk.RIGHT, padx=(0, 2))
        self.close_btn.bind("<Enter>", lambda _e: self.close_btn.configure(fg=self.colors["error"], bg="#2a1515"))
        self.close_btn.bind("<Leave>", lambda _e: self.close_btn.configure(fg=self.colors["text_muted"], bg=self.colors["bg"]))
        self.close_btn.bind("<ButtonRelease-1>", lambda _e: self.on_close())

        tk.Frame(card, bg=self.colors["accent"], height=2, bd=0).pack(fill=tk.X, side=tk.TOP)

        body = tk.Frame(card, bg=self.colors["panel"], bd=0)
        body.pack(fill=tk.BOTH, expand=True)

        rail = tk.Frame(body, bg=self.colors["rail"], width=170, bd=0)
        rail.pack(side=tk.LEFT, fill=tk.Y)
        rail.pack_propagate(False)

        rail_pad = tk.Frame(rail, bg=self.colors["rail"], bd=0)
        rail_pad.pack(fill=tk.BOTH, expand=True, padx=16, pady=(24, 16))

        tk.Label(
            rail_pad,
            text="Update steps",
            fg=self.colors["text_muted"],
            bg=self.colors["rail"],
            font=("Segoe UI", 9),
            anchor="w",
        ).pack(anchor="w", pady=(0, 12))

        for key, label in self.stage_defs:
            row = tk.Frame(rail_pad, bg=self.colors["rail"], bd=0)
            row.pack(anchor="w", fill=tk.X, pady=3)

            icon_lbl = tk.Label(
                row,
                text=" ",
                fg=self.colors["step_pending"],
                bg=self.colors["rail"],
                font=("Consolas", 11),
                width=2,
                anchor="w",
            )
            icon_lbl.pack(side=tk.LEFT)

            text_lbl = tk.Label(
                row,
                text=label,
                fg=self.colors["step_pending"],
                bg=self.colors["rail"],
                font=("Segoe UI", 10),
                anchor="w",
            )
            text_lbl.pack(side=tk.LEFT)

            self.stage_icon_labels[key] = icon_lbl
            self.stage_text_labels[key] = text_lbl

        target = self.request.target_version.strip() or "latest"
        tk.Label(
            rail_pad,
            text=f"-> v{target}",
            fg=self.colors["text_subtle"],
            bg=self.colors["rail"],
            font=("Segoe UI", 9),
            anchor="w",
        ).pack(side=tk.BOTTOM, anchor="w")

        right = tk.Frame(body, bg=self.colors["panel"], bd=0)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        content = tk.Frame(right, bg=self.colors["panel"], padx=24, pady=24, bd=0)
        content.pack(fill=tk.BOTH, expand=True)

        self.step_label = tk.Label(
            content,
            text="Stellaris Update Helper",
            fg=self.colors["accent"],
            bg=self.colors["panel"],
            font=("Segoe UI Semibold", 15),
            anchor="w",
        )
        self.step_label.pack(anchor="w")

        self.status_var = tk.StringVar(value="Preparing update...")
        self.detail_var = tk.StringVar(value="")

        self.status_chip = tk.Label(
            content,
            textvariable=self.status_var,
            fg=self.colors["text_primary"],
            bg=self.colors["panel"],
            font=("Segoe UI", 11),
            anchor="w",
        )
        self.status_chip.pack(anchor="w", pady=(16, 0))

        self.details_label = tk.Label(
            content,
            textvariable=self.detail_var,
            fg=self.colors["text_secondary"],
            bg=self.colors["panel"],
            font=("Segoe UI", 9),
            wraplength=300,
            justify="left",
            anchor="w",
        )
        self.details_label.pack(anchor="w", pady=(6, 16))

        self.progress = ttk.Progressbar(
            content,
            orient="horizontal",
            mode="determinate",
            style="Stellaris.Horizontal.TProgressbar",
            maximum=100,
        )
        self.progress.pack(fill=tk.X)
        self.progress.configure(value=0)

        self.buttons_frame = tk.Frame(content, bg=self.colors["panel"])
        self.buttons_frame.pack(anchor="e", fill=tk.X, pady=(20, 0))

        self.retry_btn = tk.Button(
            self.buttons_frame,
            text="Retry install",
            command=self.on_retry,
            bg=self.colors["accent"],
            fg=self.colors["bg"],
            relief="flat",
            activebackground=self.colors["accent_hover"],
            activeforeground=self.colors["bg"],
            padx=16,
            pady=8,
            font=("Segoe UI Semibold", 10),
            bd=0,
            cursor="hand2",
            highlightthickness=0,
        )
        self.retry_btn.pack(side=tk.RIGHT)
        self.retry_btn.pack_forget()

        self.cancel_btn = tk.Button(
            self.buttons_frame,
            text="Cancel",
            command=self.on_cancel,
            bg=self.colors["panel"],
            fg=self.colors["accent"],
            relief="flat",
            activebackground=self.colors["panel_hover"],
            activeforeground=self.colors["accent"],
            padx=16,
            pady=8,
            font=("Segoe UI Semibold", 10),
            bd=0,
            cursor="hand2",
            highlightthickness=0,
        )
        self.cancel_btn.pack(side=tk.RIGHT, padx=(0, 8))

    def _apply_window_icon(self) -> None:
        icon_path = self._resolve_icon_path()
        if not icon_path:
            return

        try:
            self.root.iconbitmap(icon_path)
        except Exception:
            pass

    def _resolve_icon_path(self) -> str:
        script_dir = Path(__file__).resolve().parent
        exe_dir = Path(clean_string(self.request.app_exe_path, 1000)).resolve().parent

        candidates = [
            script_dir / "assets" / "logo.ico",
            script_dir / "logo.ico",
            exe_dir / "app.ico",
            exe_dir / "UI" / "Assets" / "app.ico",
            exe_dir / "assets" / "logo.ico",
            exe_dir / "logo.ico",
        ]

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return ""

    def _wire_events(self) -> None:
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def start(self) -> None:
        self.run_flow(wait_for_parent=True)
        self.root.after(120, self._pump_queue)
        self.root.mainloop()

    def run_flow(self, wait_for_parent: bool) -> None:
        if self.is_running:
            return

        self.is_running = True
        self.retry_mode = False
        self.cancel_event.clear()
        self.retry_btn.pack_forget()
        self.cancel_btn.configure(text="Cancel")
        self.status_var.set("Starting update process...")
        self.detail_var.set("Bootstrapping updater helper...")
        self._set_stage_for_step("starting", "")
        self._progress_current = 0.0
        self._progress_target = 0.0
        self.progress.configure(value=0)

        self.worker = threading.Thread(target=self._worker_main, args=(wait_for_parent,), daemon=True)
        self.worker.start()

    def _worker_main(self, wait_for_parent: bool) -> None:
        req = self.request
        try:
            self.engine.try_write_startup_signal()
            write_status("starting", "Updater started.", req.target_version, False)
            self._emit_step("Starting", "Updater started.", 2)

            if wait_for_parent:
                write_status("closing", "Waiting for app to close.", req.target_version, False)
                self._emit_step("Closing app", "Waiting for app process to close...", 8)

                self.engine.wait_for_parent_exit(self._on_parent_wait_progress)

            self._check_cancelled()

            write_status("downloading", "Downloading installer package.", req.target_version, False)
            installer_path = self.engine.download_installer(self._emit_step, self._on_download_progress)
            self.installer_path = installer_path

            self._check_cancelled()

            write_status("installing", "Running installer in background.", req.target_version, False)
            self._emit_step("Installing", "Launching silent installer...", 25)

            exit_code = self.engine.run_installer(installer_path, self._on_install_progress)
            if exit_code != 0:
                raise UpdateError(f"Installer failed with exit code {exit_code}.")

            self._check_cancelled()

            write_status("verifying", "Verifying updated installation.", req.target_version, False)
            self._emit_step("Verifying", "Validating installation and preparing relaunch...", 92)
            time.sleep(0.45)

            write_status("relaunching", "Update installed. Relaunching app.", req.target_version, True)
            self._emit_step("Relaunching", "Starting updated app...", 100)

            relaunched = start_app(req.app_exe_path)
            safe_delete(installer_path)

            if not relaunched:
                raise UpdateError("Update installed, but relaunch failed. Start the app manually.")

            self.status_queue.put(("complete", None))
        except UpdateCancelled:
            write_status("cancelled", "Update cancelled by user.", req.target_version, False)
            self.status_queue.put(("cancelled", "Update was cancelled."))
        except Exception as exc:
            message = str(exc).strip() or "Unknown updater error."
            write_status("failed", message, req.target_version, False)
            self.status_queue.put(("failed", message))
        finally:
            self.status_queue.put(("finished", None))

    def _check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise UpdateCancelled()

    def _on_parent_wait_progress(self, percent: int) -> None:
        mapped = 8 + int(max(0, min(100, percent)) / 8)
        self._emit_step("Closing app", "Waiting for app process to close...", mapped)

    def _on_download_progress(self, downloaded: int, total: Optional[int], percent: int) -> None:
        if total and total > 0:
            mb_done = downloaded / (1024 * 1024)
            mb_total = total / (1024 * 1024)
            detail = f"Downloading installer... {percent}% ({mb_done:.1f}/{mb_total:.1f} MB)"
            mapped = 10 + int(percent * 0.15)
        else:
            mb_done = downloaded / (1024 * 1024)
            detail = f"Downloading installer... {mb_done:.1f} MB"
            mapped = 12

        self._emit_step("Downloading", detail, mapped)

    def _on_install_progress(self, percent: int) -> None:
        bounded = max(25, min(85, percent))
        self._emit_step("Installing", f"Installing silently in background... {bounded}%", bounded)

    def _emit_step(self, step: str, details: str, progress: int) -> None:
        self.status_queue.put(("step", (step, details, max(0, min(100, progress)))))

    def _set_stage_state(self, stage_key: str, state: str) -> None:
        icon_lbl = self.stage_icon_labels.get(stage_key)
        text_lbl = self.stage_text_labels.get(stage_key)
        if not icon_lbl or not text_lbl:
            return

        if state == "done":
            icon_lbl.configure(text="✓", fg=self.colors["step_done"])
            text_lbl.configure(fg=self.colors["step_done"])
        elif state == "active":
            icon_lbl.configure(text=">", fg=self.colors["step_active"])
            text_lbl.configure(fg=self.colors["text_primary"])
        elif state == "error":
            icon_lbl.configure(text="!", fg=self.colors["error"])
            text_lbl.configure(fg=self.colors["error"])
        elif state == "cancel":
            icon_lbl.configure(text="!", fg=self.colors["warn"])
            text_lbl.configure(fg=self.colors["warn"])
        else:
            icon_lbl.configure(text=" ", fg=self.colors["step_pending"])
            text_lbl.configure(fg=self.colors["step_pending"])

    def _set_stage_for_step(self, step: str, state: str) -> None:
        step_key = step.strip().lower()
        stage_map = {
            "starting": 0,
            "closing app": 0,
            "downloading": 1,
            "installing": 2,
            "verifying": 3,
            "relaunching": 4,
        }

        if step_key in stage_map:
            self.active_stage_index = stage_map[step_key]

        if state in ("error", "cancel"):
            if 0 <= self.active_stage_index < len(self.stage_defs):
                active_key = self.stage_defs[self.active_stage_index][0]
                self._set_stage_state(active_key, state)
            return

        for idx, (key, _label) in enumerate(self.stage_defs):
            if idx < self.active_stage_index:
                self._set_stage_state(key, "done")
            elif idx == self.active_stage_index:
                self._set_stage_state(key, "active")
            else:
                self._set_stage_state(key, "pending")

    def _mark_complete(self) -> None:
        self.active_stage_index = len(self.stage_defs)
        for key, _label in self.stage_defs:
            self._set_stage_state(key, "done")

    def _pump_queue(self) -> None:
        while True:
            try:
                item_type, payload = self.status_queue.get_nowait()
            except queue.Empty:
                break

            if item_type == "step":
                step, details, progress = payload  # type: ignore[misc]
                self.status_var.set(step)
                self.detail_var.set(details)
                self._progress_target = float(progress)
                self._set_stage_for_step(step, "active")
            elif item_type == "failed":
                message = str(payload)
                self.status_var.set("Update failed")
                self.detail_var.set(message)
                self._progress_target = 100.0
                self._set_stage_for_step("", "error")
                self.retry_btn.pack(side=tk.RIGHT)
                self.cancel_btn.configure(text="Close")
                self.retry_mode = True
            elif item_type == "cancelled":
                message = str(payload)
                self.status_var.set("Update cancelled")
                self.detail_var.set(message)
                self._progress_target = 0.0
                self._set_stage_for_step("", "cancel")
                self.retry_btn.pack(side=tk.RIGHT)
                self.cancel_btn.configure(text="Close")
                self.retry_mode = True
            elif item_type == "complete":
                self.status_var.set("Update complete")
                self.detail_var.set("Stellaris Mod Manager has been updated successfully.")
                self._progress_target = 100.0
                self._mark_complete()
                self.root.after(900, self._close_after_success)
            elif item_type == "finished":
                self.is_running = False

        diff = self._progress_target - self._progress_current
        if abs(diff) > 0.15:
            self._progress_current += diff * self._lerp_speed
        else:
            self._progress_current = self._progress_target

        self.progress.configure(value=self._progress_current)

        self.root.after(self._tick_ms, self._pump_queue)

    def _close_after_success(self) -> None:
        self._ensure_cleanup_scheduled()
        self.root.destroy()

    def on_retry(self) -> None:
        if self.is_running:
            return

        self.cancel_event = threading.Event()
        self.engine = UpdaterEngine(self.request, self.cancel_event)
        self.run_flow(wait_for_parent=False)

    def on_cancel(self) -> None:
        if self.retry_mode:
            self._ensure_cleanup_scheduled()
            self.root.destroy()
            return

        if self.cancel_event.is_set():
            return

        self.cancel_event.set()
        self.engine.cancel_installer()

    def on_close(self) -> None:
        if self.is_running:
            self.cancel_event.set()
            self.engine.cancel_installer()
            return

        self._ensure_cleanup_scheduled()
        self.root.destroy()

    def _on_drag_start(self, event) -> None:
        self._drag_x = event.x
        self._drag_y = event.y

    def _on_drag_motion(self, event) -> None:
        x = self.root.winfo_x() + (event.x - self._drag_x)
        y = self.root.winfo_y() + (event.y - self._drag_y)
        self.root.geometry(f"+{x}+{y}")

    def _ensure_cleanup_scheduled(self) -> None:
        if self.scheduled_cleanup:
            return

        cleanup_root = clean_string(self.request.cleanup_root, 1000)
        if cleanup_root:
            schedule_cleanup(cleanup_root)
            self.scheduled_cleanup = True


def parse_update_request(args: argparse.Namespace) -> Optional[UpdateRequest]:
    if not args.apply_update:
        return None

    app_exe = clean_string(args.app_exe, 1000)
    download_url = clean_string(args.download_url, 2000)

    if not app_exe or not download_url:
        return None

    return UpdateRequest(
        parent_pid=max(0, int(args.parent_pid or 0)),
        app_exe_path=app_exe,
        download_url=download_url,
        release_url=clean_string(args.release_url, 2000),
        target_version=clean_string(args.target_version, 120),
        startup_signal_path=clean_string(args.startup_signal, 1000),
        cleanup_root=clean_string(args.cleanup_root, 1000),
    )


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stellaris Mod Manager Python Updater",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--apply-update", action="store_true", help="Run update apply flow")
    parser.add_argument("--parent-pid", type=int, default=0, help="Parent process ID to wait for")
    parser.add_argument("--app-exe", default="", help="Path to StellarisModManager.exe")
    parser.add_argument("--download-url", default="", help="Installer download URL")
    parser.add_argument("--release-url", default="", help="Release page URL")
    parser.add_argument("--target-version", default="", help="Target version")
    parser.add_argument("--startup-signal", default="", help="Path to startup signal file")
    parser.add_argument("--cleanup-root", default="", help="Path to updater cleanup root")

    parser.add_argument("--check-only", action="store_true", help="Only check for updates and print JSON")
    parser.add_argument("--current-version", default="", help="Current app semantic version")
    parser.add_argument("--api-base", default=DEFAULT_STELLARISYNC_BASE_URL, help="Stellarisync base URL")
    parser.add_argument("--github-repo", default=DEFAULT_GITHUB_REPO, help="Fallback GitHub repo owner/name")
    parser.add_argument(
        "--include-prerelease",
        action="store_true",
        help="When using GitHub fallback, allow prerelease channel",
    )

    return parser.parse_args(argv)


def run_check_only(args: argparse.Namespace) -> int:
    release = fetch_latest_from_stellarisync(args.api_base)
    if release is None:
        release = fetch_latest_from_github(args.github_repo, include_prerelease=args.include_prerelease)

    if release is None:
        payload = {
            "ok": False,
            "message": "Update service unavailable.",
            "updatedAtUtc": utc_now_iso(),
        }
        print(json.dumps(payload, indent=2))
        return 2

    current_version = clean_string(args.current_version, 120)
    is_update_available = bool(current_version and is_newer_version(release.version, current_version))

    payload = {
        "ok": True,
        "isUpdateAvailable": is_update_available,
        "currentVersion": current_version,
        "latestVersion": release.version,
        "releaseUrl": release.release_url,
        "downloadUrl": release.download_url,
        "critical": release.critical,
        "source": release.source,
        "releasedAt": release.released_at,
        "updatedAtUtc": utc_now_iso(),
    }
    print(json.dumps(payload, indent=2))
    return 0 if release else 2


def run_apply_mode(args: argparse.Namespace) -> int:
    request = parse_update_request(args)
    if request is None:
        write_status("failed", "Updater arguments are incomplete.", None, False)
        print("Missing required arguments for --apply-update.", file=sys.stderr)
        return 2

    window = UpdaterWindow(request)
    window.start()
    return 0


def main(argv: List[str]) -> int:
    args = parse_args(argv)

    if args.check_only:
        return run_check_only(args)

    if args.apply_update:
        return run_apply_mode(args)

    # Default behavior mirrors updater-only executable contract.
    print("Nothing to do. Use --apply-update or --check-only.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:
        write_status("failed", f"Update install failed: {exc}", None, False)
        print(f"Fatal updater error: {exc}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
