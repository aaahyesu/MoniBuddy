use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

/// 0=normal, 1=yielding (hidden for capture/toast)
static YIELD_STATE: AtomicU8 = AtomicU8::new(0);
/// 사용자가 트레이/설정으로 오버레이를 켠 상태인지
static OVERLAY_USER_VISIBLE: AtomicBool = AtomicBool::new(true);
/// 캡처 종료 후에도 토스트가 보이도록 양보를 유지할 시각
static YIELD_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
const TOAST_GRACE: Duration = Duration::from_secs(8);

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    // 캡처 양보 중에는 클릭 통과 상태를 건드리지 않음
    if YIELD_STATE.load(Ordering::SeqCst) != 0 {
        return Ok(());
    }
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    overlay
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    // 전체화면 alwaysOnTop 오버레이가 설정 창을 가리지 않게
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_always_on_top(false);
    }

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
            overlay.show().map_err(|e| e.to_string())?;
            let _ = overlay.set_always_on_top(true);
            let _ = overlay.set_ignore_cursor_events(true);
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
    let _ = overlay.set_ignore_cursor_events(true);
    Ok(())
}

fn extend_capture_yield() {
    let mut until = YIELD_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    *until = Some(Instant::now() + TOAST_GRACE);
}

fn capture_yield_active() -> bool {
    let mut until = YIELD_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    match *until {
        Some(t) if Instant::now() < t => true,
        Some(_) => {
            *until = None;
            false
        }
        None => false,
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
        // 전체화면 오버레이는 alwaysOnTop만 꺼도 토스트를 가림 → 잠시 숨김
        let _ = overlay.set_always_on_top(false);
        let _ = overlay.hide();
    } else if OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        let _ = overlay.show();
        let _ = overlay.set_always_on_top(true);
        let _ = overlay.set_ignore_cursor_events(true);
    }
}

#[cfg(windows)]
mod capture_detect {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
        fn GetWindowTextLengthW(hwnd: isize) -> i32;
        fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetClassNameW(hwnd: isize, lp_class_name: *mut u16, n_max_count: i32) -> i32;
        fn GetAsyncKeyState(v_key: i32) -> i16;
        fn EnumWindows(cb: unsafe extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
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
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    const CAPTURE_PROCESS_HINTS: &[&str] = &[
        "screenclippinghost",
        "snippingtool",
        "screensketch",
        "sharex",
        "greenshot",
        "lightshot",
        "picpick",
        "flameshot",
    ];

    const EPHEMERAL_CAPTURE_HOSTS: &[&str] = &["screenclippinghost"];

    const CAPTURE_TITLE_HINTS: &[&str] = &[
        "snipping",
        "snip & sketch",
        "screen sketch",
        "캡처",
        "자르기",
        "스크린샷",
        "screenshot",
    ];

    fn wide_to_string(buf: &[u16]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..len])
            .to_string_lossy()
            .to_lowercase()
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

    fn foreground_title_and_class() -> (String, String) {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 {
                return (String::new(), String::new());
            }
            let title_len = GetWindowTextLengthW(hwnd).max(0) as usize + 1;
            let mut title_buf = vec![0u16; title_len.max(1)];
            GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
            let mut class_buf = [0u16; 256];
            GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
            (wide_to_string(&title_buf), wide_to_string(&class_buf))
        }
    }

    unsafe extern "system" fn enum_capture_host_cb(hwnd: isize, lparam: isize) -> i32 {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if let Some(name) = process_name_for_pid(pid) {
            if EPHEMERAL_CAPTURE_HOSTS.iter().any(|h| name.contains(h)) {
                let found = lparam as *mut bool;
                if !found.is_null() {
                    *found = true;
                }
                return 0; // stop
            }
        }
        1
    }

    fn ephemeral_capture_host_running() -> bool {
        let mut found = false;
        unsafe {
            EnumWindows(enum_capture_host_cb, &mut found as *mut bool as isize);
        }
        found
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

    pub fn capture_ui_active() -> bool {
        if capture_hotkey_down() {
            return true;
        }
        if let Some(name) = foreground_process_name() {
            if CAPTURE_PROCESS_HINTS.iter().any(|h| name.contains(h)) {
                return true;
            }
        }
        let (title, class_name) = foreground_title_and_class();
        if CAPTURE_TITLE_HINTS
            .iter()
            .any(|h| title.contains(h) || class_name.contains(h))
        {
            return true;
        }
        ephemeral_capture_host_running()
    }
}

#[cfg(not(windows))]
mod capture_detect {
    pub fn capture_ui_active() -> bool {
        false
    }
}

fn spawn_capture_yield_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut was_active = false;
        loop {
            let active = std::panic::catch_unwind(capture_detect::capture_ui_active).unwrap_or(false);
            if active {
                extend_capture_yield();
                was_active = true;
            } else if was_active {
                // 캡처 직후 알림 토스트(수 초)까지 가리지 않도록 유예
                extend_capture_yield();
                was_active = false;
            }

            let yielding = capture_yield_active();
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                apply_capture_yield(&app, yielding);
            }));
            thread::sleep(Duration::from_millis(120));
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
            get_cursor_pos
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
                                    let _ = overlay.show();
                                    let _ = overlay.set_always_on_top(true);
                                    let _ = overlay.set_ignore_cursor_events(true);
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
