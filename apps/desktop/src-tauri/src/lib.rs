use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

/// 0=normal, 1=yielding (capture UI / toast 양보 중)
static YIELD_STATE: AtomicU8 = AtomicU8::new(0);
/// 영역 선택(Win+Shift+S) 진행 중 — 클릭 통과를 강제로 유지
static IN_REGION_SELECT: AtomicBool = AtomicBool::new(false);
/// 캡처 UI 동안 프론트 캐릭터 이동 정지
static CAPTURE_FREEZE: AtomicBool = AtomicBool::new(false);
/// 사용자가 트레이/설정으로 오버레이를 켠 상태인지
static OVERLAY_USER_VISIBLE: AtomicBool = AtomicBool::new(true);
/// 마지막 click-through 적용값 (중복 set_ignore_cursor_events 방지)
static CLICK_THROUGH: AtomicU8 = AtomicU8::new(255);
/// 캡처 종료 후에도 토스트가 보이도록 양보를 유지할 시각
static YIELD_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// 이번 양보 세션이 시작된 시각 (하드 상한용)
static YIELD_STARTED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// MAX_YIELD 소진 후, 캡처 UI가 꺼질 때까지 재양보 금지
static YIELD_EXHAUSTED: AtomicBool = AtomicBool::new(false);
/// 캡처 직후 토스트/캡처보드용 유예
const TOAST_GRACE: Duration = Duration::from_secs(8);
/// ScreenClippingHost 잔류 등으로 양보가 끝나지 않는 것 방지
const MAX_YIELD: Duration = Duration::from_secs(15);
/// 핫키 후 ScreenClippingHost 기동 대기 (이 시간만 강제 표시 유지)
const HOST_SPAWN_WAIT: Duration = Duration::from_millis(1200);
/// 영역 선택 종료로 보기 전, 감지 끊김을 무시하는 시간 (이 동안 이동 정지 유지)
const CAPTURE_END_DEBOUNCE: Duration = Duration::from_millis(900);

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    // 캡처 양보 중에는 클릭 통과 상태를 건드리지 않음
    if YIELD_STATE.load(Ordering::SeqCst) != 0 {
        return Ok(());
    }
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;

    // 영역 선택 중 캐릭터 위에서 클릭 통과가 꺼지면 SnippingTool이 마우스를 뺏겨
    // 캡처보드/토스트가 안 뜸 → 이 동안은 항상 통과 유지
    let enabled = if IN_REGION_SELECT.load(Ordering::SeqCst) {
        true
    } else {
        enabled
    };

    let next = if enabled { 1 } else { 0 };
    let prev = CLICK_THROUGH.swap(next, Ordering::SeqCst);
    if prev != next {
        overlay
            .set_ignore_cursor_events(enabled)
            .map_err(|e| e.to_string())?;
    }
    // ignore_cursor 전환이 z-order를 떨어뜨릴 수 있어 매번 최상단 재적용
    if YIELD_STATE.load(Ordering::SeqCst) == 0 && OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        let _ = overlay.set_always_on_top(true);
        promote_overlay_zorder(&overlay);
    }
    Ok(())
}

#[tauri::command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    // 오버레이 alwaysOnTop은 유지 — 끄면 다른 일반 앱에 가려짐.
    // 설정 창도 alwaysOnTop + focus로 오버레이 위에 올림.

    let created = app.get_webview_window("settings").is_none();
    let win = match app.get_webview_window("settings") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
            .title("MoniBuddy")
            .inner_size(920.0, 720.0)
            .resizable(true)
            .visible(true)
            .build()
            .map_err(|e| e.to_string())?,
    };
    if created {
        attach_settings_close_handler(&app);
    }

    let _ = win.unminimize();
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    // 설정 연 뒤에도 오버레이 topmost 스타일 유지
    restore_overlay_topmost(&app);
    Ok(())
}

fn restore_overlay_topmost(app: &AppHandle) {
    if !OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    if YIELD_STATE.load(Ordering::SeqCst) != 0 {
        return;
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_always_on_top(true);
        promote_overlay_zorder(&overlay);
    }
}

fn attach_settings_close_handler(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        return;
    };
    let app = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // X → 파괴하지 않고 숨김 (트레이에서 다시 열기)
            api.prevent_close();
            if let Some(w) = app.get_webview_window("settings") {
                let _ = w.hide();
                let _ = w.set_always_on_top(false);
            }
            restore_overlay_topmost(&app);
        }
    });
}

#[tauri::command]
fn toggle_overlay(app: AppHandle, visible: bool) -> Result<(), String> {
    OVERLAY_USER_VISIBLE.store(visible, Ordering::SeqCst);
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    if visible {
        if YIELD_STATE.load(Ordering::SeqCst) == 0 {
            restore_overlay_foreground(&overlay);
        }
    } else {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_cursor_pos(app: AppHandle) -> Result<(f64, f64), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    let cursor = overlay.cursor_position().map_err(|e| e.to_string())?;
    let origin = overlay.outer_position().map_err(|e| e.to_string())?;
    let scale = overlay.scale_factor().map_err(|e| e.to_string())?;
    let x = (cursor.x as f64 - origin.x as f64) / scale;
    let y = (cursor.y as f64 - origin.y as f64) / scale;
    Ok((x, y))
}

#[tauri::command]
fn is_capture_freeze() -> bool {
    CAPTURE_FREEZE.load(Ordering::SeqCst)
}

fn notify_capture_freeze(app: &AppHandle, frozen: bool) {
    let prev = CAPTURE_FREEZE.swap(frozen, Ordering::SeqCst);
    if prev == frozen {
        return;
    }
    let _ = app.emit("capture-freeze", frozen);
}

fn setup_overlay(app: &AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay missing".to_string())?;

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let _ = overlay.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        let _ = overlay.set_size(tauri::PhysicalSize::new(size.width, size.height));
    }

    let _ = overlay.set_always_on_top(true);
    promote_overlay_zorder(&overlay);
    let _ = overlay.set_ignore_cursor_events(true);
    Ok(())
}

fn extend_capture_yield() {
    if YIELD_EXHAUSTED.load(Ordering::SeqCst) {
        return;
    }
    let now = Instant::now();
    let mut started = YIELD_STARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
    let mut until = YIELD_UNTIL.lock().unwrap_or_else(|e| e.into_inner());

    let start = started.get_or_insert(now);
    let hard_end = *start + MAX_YIELD;
    if now >= hard_end {
        *until = None;
        *started = None;
        YIELD_EXHAUSTED.store(true, Ordering::SeqCst);
        return;
    }
    let soft_end = now + TOAST_GRACE;
    *until = Some(if soft_end < hard_end { soft_end } else { hard_end });
}

fn clear_capture_yield() {
    let mut until = YIELD_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    *until = None;
    let mut started = YIELD_STARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
    *started = None;
}

fn capture_yield_active() -> bool {
    let mut until = YIELD_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    match *until {
        Some(t) if Instant::now() < t => true,
        Some(_) => {
            *until = None;
            let mut started = YIELD_STARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
            *started = None;
            false
        }
        None => {
            let mut started = YIELD_STARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
            *started = None;
            false
        }
    }
}

fn apply_capture_yield(app: &AppHandle, should_yield: bool) {
    let next = if should_yield { 1 } else { 0 };
    let prev = YIELD_STATE.swap(next, Ordering::SeqCst);
    if prev == next {
        return;
    }
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };

    if should_yield {
        IN_REGION_SELECT.store(false, Ordering::SeqCst);
        // hide만으로 토스트 확보 — HWND_BOTTOM 강등은 복구 후에도 창이 뒤로 남는 원인
        let _ = overlay.set_always_on_top(false);
        let _ = overlay.hide();
    } else if OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        restore_overlay_foreground(&overlay);
    }
}

/// alwaysOnTop + TOPMOST로 다른 앱 뒤에 깔리지 않게
fn restore_overlay_foreground(overlay: &tauri::WebviewWindow) {
    let _ = overlay.show();
    let _ = overlay.set_always_on_top(true);
    promote_overlay_zorder(overlay);
    let _ = overlay.set_ignore_cursor_events(true);
    CLICK_THROUGH.store(255, Ordering::SeqCst);
}

#[cfg(windows)]
fn promote_overlay_zorder(overlay: &tauri::WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: isize,
            hwnd_insert_after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
        fn SetWindowLongW(hwnd: isize, index: i32, new_long: i32) -> i32;
    }
    const HWND_TOPMOST: isize = -1;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOPMOST: i32 = 0x0000_0008;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    let Ok(hwnd) = overlay.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as isize;
    unsafe {
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOPMOST);
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(not(windows))]
fn promote_overlay_zorder(_overlay: &tauri::WebviewWindow) {}

/// 캡처 세션 중 강제 표시 (양보 상태와 무관하게 show + topmost)
fn force_overlay_visible_for_capture(app: &AppHandle) {
    YIELD_STATE.store(0, Ordering::SeqCst);
    IN_REGION_SELECT.store(true, Ordering::SeqCst);
    if !OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };
    let _ = overlay.show();
    let _ = overlay.set_always_on_top(true);
    promote_overlay_zorder(&overlay);
    // SnippingTool이 캐릭터 위 드래그도 받을 수 있게 항상 클릭 통과
    let _ = overlay.set_ignore_cursor_events(true);
    CLICK_THROUGH.store(1, Ordering::SeqCst);
}

#[cfg(windows)]
mod capture_detect {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
        fn GetAsyncKeyState(v_key: i32) -> i16;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn CloseHandle(handle: isize) -> i32;
        fn QueryFullProcessImageNameW(
            process: isize,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
        fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const TH32CS_SNAPPROCESS: u32 = 0x00000002;
    const INVALID_HANDLE_VALUE: isize = -1;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    /// 영역 선택 중에만 뜨는 호스트 (캡처보드/편집 UI인 SnippingTool 등은 제외)
    const REGION_SELECT_PROCESSES: &[&str] = &["screenclippinghost"];

    fn wide_to_string(buf: &[u16]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..len])
            .to_string_lossy()
            .to_lowercase()
    }

    fn name_matches_any(name: &str, hints: &[&str]) -> bool {
        hints.iter().any(|h| name.contains(h))
    }

    fn process_name_for_pid(pid: u32) -> Option<String> {
        unsafe {
            if pid == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle == 0 {
                return None;
            }
            let mut buf = [0u16; 512];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            let full = wide_to_string(&buf[..size as usize]);
            Some(
                full.rsplit(['\\', '/'])
                    .next()
                    .unwrap_or(full.as_str())
                    .to_string(),
            )
        }
    }

    fn foreground_process_name() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            process_name_for_pid(pid)
        }
    }

    fn any_process_matching(hints: &[&str]) -> bool {
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == 0 || snap == INVALID_HANDLE_VALUE {
                return false;
            }
            let mut entry = ProcessEntry32W {
                dw_size: std::mem::size_of::<ProcessEntry32W>() as u32,
                cnt_usage: 0,
                th32_process_id: 0,
                th32_default_heap_id: 0,
                th32_module_id: 0,
                cnt_threads: 0,
                th32_parent_process_id: 0,
                pc_pri_class_base: 0,
                dw_flags: 0,
                sz_exe_file: [0; 260],
            };
            let mut found = false;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    let name = wide_to_string(&entry.sz_exe_file);
                    if name_matches_any(&name, hints) {
                        found = true;
                        break;
                    }
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
            found
        }
    }

    pub fn capture_hotkey_down() -> bool {
        unsafe {
            let win = GetAsyncKeyState(0x5B) as u16 & 0x8000 != 0
                || GetAsyncKeyState(0x5C) as u16 & 0x8000 != 0;
            let shift = GetAsyncKeyState(0x10) as u16 & 0x8000 != 0;
            let s = GetAsyncKeyState(0x53) as u16 & 0x8000 != 0;
            let print_screen = GetAsyncKeyState(0x2C) as u16 & 0x8000 != 0;
            print_screen || (win && shift && s)
        }
    }

    pub fn screen_clipping_host_running() -> bool {
        any_process_matching(REGION_SELECT_PROCESSES)
    }

    /// 영역 선택(ScreenClippingHost / 핫키)만 — 캡처보드·토스트 구간은 제외
    pub fn region_select_active() -> bool {
        if capture_hotkey_down() {
            return true;
        }
        if screen_clipping_host_running() {
            return true;
        }
        if let Some(name) = foreground_process_name() {
            if name_matches_any(&name, REGION_SELECT_PROCESSES) {
                return true;
            }
        }
        false
    }
}

#[cfg(not(windows))]
mod capture_detect {
    pub fn region_select_active() -> bool {
        false
    }

    pub fn screen_clipping_host_running() -> bool {
        false
    }
}

fn spawn_capture_yield_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut in_capture_session = false;
        let mut session_started_at: Option<Instant> = None;
        let mut saw_clipping_host = false;
        // 토스트 양보 직후 핫키/감지 깜빡임으로 양보가 취소되지 않게
        let mut suppress_select_until: Option<Instant> = None;
        let mut inactive_since: Option<Instant> = None;
        let mut last_topmost_refresh = Instant::now();

        loop {
            let selecting =
                std::panic::catch_unwind(capture_detect::region_select_active).unwrap_or(false);
            let host_running = std::panic::catch_unwind(
                capture_detect::screen_clipping_host_running,
            )
            .unwrap_or(false);

            let toast_yielding = capture_yield_active();
            let select_suppressed = suppress_select_until
                .is_some_and(|t| Instant::now() < t)
                && !host_running;

            // Host가 한 프레임만 안 잡혀도 세션을 유지 (정지 풀림 방지)
            let active = (selecting || host_running) && !select_suppressed;

            if active {
                if !in_capture_session {
                    clear_capture_yield();
                    YIELD_STATE.store(0, Ordering::SeqCst);
                    session_started_at = Some(Instant::now());
                    saw_clipping_host = false;
                    suppress_select_until = None;
                }
                in_capture_session = true;
                inactive_since = None;
                notify_capture_freeze(&app, true);
                if host_running {
                    saw_clipping_host = true;
                }
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    force_overlay_visible_for_capture(&app);
                }));
            } else if in_capture_session {
                let started = session_started_at.unwrap_or_else(Instant::now);
                let waiting_for_host = !saw_clipping_host && started.elapsed() < HOST_SPAWN_WAIT;
                if waiting_for_host {
                    inactive_since = None;
                    notify_capture_freeze(&app, true);
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        force_overlay_visible_for_capture(&app);
                    }));
                } else {
                    let since = inactive_since.get_or_insert_with(Instant::now);
                    // 감지 끊김 디바운스 동안은 계속 정지 (멈췄다가 다시 움직이던 원인)
                    if since.elapsed() < CAPTURE_END_DEBOUNCE {
                        notify_capture_freeze(&app, true);
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            force_overlay_visible_for_capture(&app);
                        }));
                    } else {
                        notify_capture_freeze(&app, false);
                        IN_REGION_SELECT.store(false, Ordering::SeqCst);
                        extend_capture_yield();
                        suppress_select_until = Some(Instant::now() + TOAST_GRACE);
                        in_capture_session = false;
                        session_started_at = None;
                        saw_clipping_host = false;
                        inactive_since = None;
                    }
                }
            } else if !toast_yielding {
                notify_capture_freeze(&app, false);
                IN_REGION_SELECT.store(false, Ordering::SeqCst);
                YIELD_EXHAUSTED.store(false, Ordering::SeqCst);
                inactive_since = None;
                if suppress_select_until.is_some_and(|t| Instant::now() >= t) {
                    suppress_select_until = None;
                }
                // 다른 창에 가려지지 않도록 주기적으로 TOPMOST 재적용
                if OVERLAY_USER_VISIBLE.load(Ordering::SeqCst)
                    && YIELD_STATE.load(Ordering::SeqCst) == 0
                    && last_topmost_refresh.elapsed() >= Duration::from_millis(500)
                {
                    last_topmost_refresh = Instant::now();
                    if let Some(overlay) = app.get_webview_window("overlay") {
                        let _ = overlay.set_always_on_top(true);
                        promote_overlay_zorder(&overlay);
                    }
                }
            }

            let yielding = !in_capture_session && capture_yield_active();
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                apply_capture_yield(&app, yielding);
            }));
            thread::sleep(Duration::from_millis(80));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            show_settings,
            toggle_overlay,
            get_cursor_pos,
            is_capture_freeze
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            setup_overlay(app.handle())?;
            spawn_capture_yield_watcher(app.handle().clone());

            let show_i = MenuItem::with_id(app, "show", "설정 열기", true, None::<&str>)?;
            let toggle_i =
                MenuItem::with_id(app, "toggle", "오버레이 표시/숨김", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &toggle_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("MoniBuddy — 클릭: 설정 열기")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_settings(app.clone());
                    }
                    "toggle" => {
                        if let Some(overlay) = app.get_webview_window("overlay") {
                            let show = !OVERLAY_USER_VISIBLE.load(Ordering::SeqCst);
                            OVERLAY_USER_VISIBLE.store(show, Ordering::SeqCst);
                            if show {
                                if YIELD_STATE.load(Ordering::SeqCst) == 0 {
                                    restore_overlay_foreground(&overlay);
                                }
                            } else {
                                let _ = overlay.hide();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = show_settings(tray.app_handle().clone());
                    }
                })
                .build(app)?;

            if app.get_webview_window("settings").is_none() {
                let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html".into()))
                    .title("MoniBuddy")
                    .inner_size(920.0, 720.0)
                    .build();
            }
            attach_settings_close_handler(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MoniBuddy");
}
