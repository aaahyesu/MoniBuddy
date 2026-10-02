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
/// 파일 선택 창이 열려 있는 동안 오버레이를 최상단으로 올리지 않음
static FILE_DIALOG_OPEN: AtomicBool = AtomicBool::new(false);
/// z-order promote 쓰로틀 (set_click_through 경로에서는 올리지 않음)
static LAST_Z_PROMOTE_MS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
/// 캡처 종료 후에도 토스트가 보이도록 양보를 유지할 시각
static YIELD_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// 이번 양보 세션이 시작된 시각 (하드 상한용)
static YIELD_STARTED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// MAX_YIELD 소진 후, 캡처 UI가 꺼질 때까지 재양보 금지
static YIELD_EXHAUSTED: AtomicBool = AtomicBool::new(false);
/// 캡처 직후 토스트/캡처보드용 유예 (캡처 "중"에는 숨기지 않음)
const TOAST_GRACE: Duration = Duration::from_secs(5);
/// ScreenClippingHost 잔류 등으로 양보가 끝나지 않는 것 방지
const MAX_YIELD: Duration = Duration::from_secs(15);
/// 핫키 감지 직후 세션 유지 (캐릭터 표시+이동정지, 숨기지 않음)
const HOTKEY_SESSION_HOLD: Duration = Duration::from_secs(12);
/// 핫키 후 ScreenClippingHost 기동 대기
const HOST_SPAWN_WAIT: Duration = Duration::from_millis(1200);
/// 영역 선택 종료 확정 전 감지 끊김 유예
const CAPTURE_END_DEBOUNCE: Duration = Duration::from_millis(500);

#[tauri::command]
fn set_click_through(
    app: AppHandle,
    enabled: bool,
    force: Option<bool>,
) -> Result<(), String> {
    // 파일 선택 창이 위에 있는 동안 클릭 통과로 커서를 가리지 않음
    if FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
        return Ok(());
    }
    // 캡처 양보 중에는 클릭 통과 상태를 건드리지 않음
    if YIELD_STATE.load(Ordering::SeqCst) != 0 {
        // 캐시를 무효화해 양보 종료 후 JS 재요청이 실제 적용되도록
        CLICK_THROUGH.store(255, Ordering::SeqCst);
        // JS가 “적용됨”으로 착각하지 않게 Err — 루프가 재시도함
        return Err("yield-active".into());
    }
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;

    // 영역 선택 중에는 항상 클릭 통과 (캡처 도구가 마우스를 받아야 함)
    let enabled = if IN_REGION_SELECT.load(Ordering::SeqCst) {
        true
    } else {
        enabled
    };

    let next = if enabled { 1 } else { 0 };
    let prev = CLICK_THROUGH.load(Ordering::SeqCst);
    let force = force.unwrap_or(false);
    if force || prev != next {
        overlay
            .set_ignore_cursor_events(enabled)
            .map_err(|e| e.to_string())?;
        // 성공한 뒤에만 캐시 갱신 — 실패 시 다음 호출이 재시도
        CLICK_THROUGH.store(next, Ordering::SeqCst);
    }

    // z-order promote는 여기서 하지 않음.
    // (클릭 통과 루프마다 SetWindowPos → 간헐적 실패/입력 먹통 유발)
    // topmost 유지는 백그라운드 스로틀 루프에서만 수행.
    let _ = app;
    Ok(())
}

#[tauri::command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    // 오버레이 alwaysOnTop은 유지 — 끄면 다른 일반 앱에 가려짐.
    // 설정은 마지막에 올려 오버레이 위에 둔다 (restore_overlay로 다시 덮지 않음).

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
    // 클릭은 설정으로 통과되도록 오버레이 ignore 유지
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_ignore_cursor_events(true);
        CLICK_THROUGH.store(1, Ordering::SeqCst);
    }
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct PickedChatFile {
    name: String,
    mime: String,
    base64: String,
}

/// 투명 오버레이가 파일 창의 부모가 되면 Windows에서 커서가 사라진다.
/// 선택하는 동안 오버레이를 내리고, 부모 없는 대화상자로 연다.
#[tauri::command]
fn pick_chat_file(app: AppHandle, kind: String) -> Result<Option<PickedChatFile>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_dialog = app.clone();
    let kind_for_dialog = kind.clone();
    app.run_on_main_thread(move || {
        let result = {
            let _guard = OverlayDialogGuard::enter(&app_for_dialog);
            pick_unparented_file(&kind_for_dialog)
        };
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    let Some(path) = rx.recv().map_err(|e| e.to_string())?? else {
        return Ok(None);
    };

    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("파일이 너무 커요".into());
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let mime = mime_for_picked(&name, &kind);
    Ok(Some(PickedChatFile {
        name,
        mime,
        base64: encode_base64(&bytes),
    }))
}

fn mime_for_picked(name: &str, kind: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ if kind == "image" => "image/jpeg",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn encode_base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= data.len() {
        let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8) | (data[i + 2] as u32);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        i += 3;
    }
    match data.len() - i {
        1 => {
            let n = (data[i] as u32) << 16;
            out.push(TABLE[((n >> 18) & 63) as usize] as char);
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8);
            out.push(TABLE[((n >> 18) & 63) as usize] as char);
            out.push(TABLE[((n >> 12) & 63) as usize] as char);
            out.push(TABLE[((n >> 6) & 63) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

#[cfg(windows)]
fn pick_unparented_file(kind: &str) -> Result<Option<std::path::PathBuf>, String> {
    #[link(name = "comdlg32")]
    extern "system" {
        fn GetOpenFileNameW(ofn: *mut OpenFileNameW) -> i32;
    }
    #[repr(C)]
    struct OpenFileNameW {
        l_struct_size: u32,
        hwnd_owner: isize,
        h_instance: isize,
        lpstr_filter: *const u16,
        lpstr_custom_filter: *mut u16,
        n_max_cust_filter: u32,
        n_filter_index: u32,
        lpstr_file: *mut u16,
        n_max_file: u32,
        lpstr_file_title: *mut u16,
        n_max_file_title: u32,
        lpstr_initial_dir: *const u16,
        lpstr_title: *const u16,
        flags: u32,
        n_file_offset: u16,
        n_file_extension: u16,
        lpstr_def_ext: *const u16,
        l_cust_data: isize,
        lpfn_hook: isize,
        lp_template_name: *const u16,
        pv_reserved: *mut std::ffi::c_void,
        dw_reserved: u32,
        flags_ex: u32,
    }
    const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
    const OFN_FILEMUSTEXIST: u32 = 0x0000_1000;
    const OFN_EXPLORER: u32 = 0x0008_0000;
    const OFN_NOCHANGEDIR: u32 = 0x0000_0008;

    let filter = if kind == "image" {
        wide_z("이미지\0*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp\0모든 파일\0*.*\0")
    } else {
        wide_z("모든 파일\0*.*\0")
    };
    let title = wide_z(if kind == "image" { "사진 선택\0" } else { "파일 선택\0" });
    let mut file = vec![0u16; 2048];
    let mut ofn = OpenFileNameW {
        l_struct_size: 0,
        hwnd_owner: 0,
        h_instance: 0,
        lpstr_filter: filter.as_ptr(),
        lpstr_custom_filter: std::ptr::null_mut(),
        n_max_cust_filter: 0,
        n_filter_index: 1,
        lpstr_file: file.as_mut_ptr(),
        n_max_file: file.len() as u32,
        lpstr_file_title: std::ptr::null_mut(),
        n_max_file_title: 0,
        lpstr_initial_dir: std::ptr::null(),
        lpstr_title: title.as_ptr(),
        flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        n_file_offset: 0,
        n_file_extension: 0,
        lpstr_def_ext: std::ptr::null(),
        l_cust_data: 0,
        lpfn_hook: 0,
        lp_template_name: std::ptr::null(),
        pv_reserved: std::ptr::null_mut(),
        dw_reserved: 0,
        flags_ex: 0,
    };
    ofn.l_struct_size = std::mem::size_of::<OpenFileNameW>() as u32;
    let ok = unsafe { GetOpenFileNameW(&mut ofn) };
    if ok == 0 {
        return Ok(None);
    }
    let end = file.iter().position(|c| *c == 0).unwrap_or(file.len());
    let text = String::from_utf16_lossy(&file[..end]);
    if text.is_empty() {
        return Ok(None);
    }
    Ok(Some(std::path::PathBuf::from(text)))
}

#[cfg(windows)]
fn wide_z(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn pick_unparented_file(_kind: &str) -> Result<Option<std::path::PathBuf>, String> {
    Err("html-picker".into())
}

struct OverlayDialogGuard<'a> {
    app: &'a AppHandle,
    cursor_bumps: i32,
}

impl<'a> OverlayDialogGuard<'a> {
    fn enter(app: &'a AppHandle) -> Self {
        FILE_DIALOG_OPEN.store(true, Ordering::SeqCst);
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.set_always_on_top(false);
            let _ = overlay.set_ignore_cursor_events(false);
            CLICK_THROUGH.store(0, Ordering::SeqCst);
        }
        Self {
            app,
            cursor_bumps: reveal_cursor(),
        }
    }
}

impl Drop for OverlayDialogGuard<'_> {
    fn drop(&mut self) {
        conceal_cursor(self.cursor_bumps);
        FILE_DIALOG_OPEN.store(false, Ordering::SeqCst);
        if !OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) || YIELD_STATE.load(Ordering::SeqCst) != 0 {
            return;
        }
        if let Some(overlay) = self.app.get_webview_window("overlay") {
            let _ = overlay.set_always_on_top(true);
            LAST_Z_PROMOTE_MS.store(0, Ordering::SeqCst);
            promote_overlay_zorder(&overlay);
            let _ = overlay.set_ignore_cursor_events(true);
            CLICK_THROUGH.store(1, Ordering::SeqCst);
        }
    }
}

#[cfg(windows)]
fn reveal_cursor() -> i32 {
    #[link(name = "user32")]
    extern "system" {
        fn ShowCursor(show: i32) -> i32;
    }
    let mut bumps = 0;
    unsafe {
        let mut count = ShowCursor(1);
        bumps += 1;
        while count < 0 && bumps < 32 {
            count = ShowCursor(1);
            bumps += 1;
        }
    }
    bumps
}

#[cfg(windows)]
fn conceal_cursor(bumps: i32) {
    #[link(name = "user32")]
    extern "system" {
        fn ShowCursor(show: i32) -> i32;
    }
    unsafe {
        for _ in 0..bumps {
            ShowCursor(0);
        }
    }
}

#[cfg(not(windows))]
fn reveal_cursor() -> i32 {
    0
}

#[cfg(not(windows))]
fn conceal_cursor(_bumps: i32) {}

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
        // 오버레이가 보이면 초대는 캐릭터 말풍선으로 — 토스트 불필요
        hide_invite_toast_window(&app);
        if YIELD_STATE.load(Ordering::SeqCst) == 0 {
            restore_overlay_foreground(&overlay);
        }
    } else {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn flip_overlay_visibility(app: AppHandle) -> Result<bool, String> {
    let next = !OVERLAY_USER_VISIBLE.load(Ordering::SeqCst);
    toggle_overlay(app, next)?;
    Ok(next)
}

#[tauri::command]
fn is_overlay_user_visible() -> bool {
    OVERLAY_USER_VISIBLE.load(Ordering::SeqCst)
}

#[tauri::command]
fn is_settings_visible(app: AppHandle) -> bool {
    app.get_webview_window("settings")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn hide_invite_toast_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("invite-toast") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn hide_invite_toast(app: AppHandle) -> Result<(), String> {
    hide_invite_toast_window(&app);
    Ok(())
}

#[tauri::command]
fn show_invite_toast(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("invite-toast")
        .ok_or_else(|| "invite-toast window missing".to_string())?;

    let logical_w = 360.0;
    let logical_h = 168.0;
    let margin = 20.0;
    let taskbar_pad = 48.0;

    let _ = win.set_size(tauri::LogicalSize::new(logical_w, logical_h));

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let screen = monitor.size();
        let origin = monitor.position();
        let scale = monitor.scale_factor();
        let pw = (logical_w * scale).round() as i32;
        let ph = (logical_h * scale).round() as i32;
        let pm = (margin * scale).round() as i32;
        let tb = (taskbar_pad * scale).round() as i32;
        let x = origin.x + screen.width as i32 - pw - pm;
        let y = origin.y + screen.height as i32 - ph - pm - tb;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }

    // 설정/오버레이 alwaysOnTop과 싸울 때 토스트가 가장 위에 오도록
    let _ = win.set_always_on_top(true);
    win.show().map_err(|e| e.to_string())?;
    promote_window_zorder(&win);
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClickDebugInfo {
    click_through_cache: u8,
    yield_state: u8,
    in_region_select: bool,
    overlay_user_visible: bool,
    settings_visible: bool,
}

#[tauri::command]
fn get_click_debug(app: AppHandle) -> ClickDebugInfo {
    ClickDebugInfo {
        click_through_cache: CLICK_THROUGH.load(Ordering::SeqCst),
        yield_state: YIELD_STATE.load(Ordering::SeqCst),
        in_region_select: IN_REGION_SELECT.load(Ordering::SeqCst),
        overlay_user_visible: OVERLAY_USER_VISIBLE.load(Ordering::SeqCst),
        settings_visible: app
            .get_webview_window("settings")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false),
    }
}

/// 배포본에서 F12가 막혀 있을 때 개발자 도구 강제 오픈
#[tauri::command]
fn open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{label}' missing"))?;
    #[cfg(any(debug_assertions, target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        win.open_devtools();
    }
    let _ = win;
    Ok(())
}

/// 캐릭터 클릭 먹통 응급 해제 — ignore 끄고 캐시 무효화
#[tauri::command]
fn force_overlay_interactive(app: AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    CLICK_THROUGH.store(255, Ordering::SeqCst);
    overlay
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    CLICK_THROUGH.store(0, Ordering::SeqCst);
    let _ = overlay.show();
    let _ = overlay.set_always_on_top(true);
    promote_overlay_zorder(&overlay);
    Ok(())
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
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };

    if should_yield {
        IN_REGION_SELECT.store(false, Ordering::SeqCst);
        // 상태가 같아도 매 틱 재적용 — 다른 경로가 show/topmost 해도 다시 숨김
        let _ = overlay.set_always_on_top(false);
        let _ = overlay.hide();
        return;
    }

    if prev == next {
        return;
    }
    if OVERLAY_USER_VISIBLE.load(Ordering::SeqCst) {
        restore_overlay_foreground(&overlay);
    }
}

/// alwaysOnTop + TOPMOST로 다른 앱 뒤에 깔리지 않게
fn restore_overlay_foreground(overlay: &tauri::WebviewWindow) {
    let _ = overlay.show();
    let _ = overlay.set_always_on_top(true);
    promote_window_zorder(overlay);
    let _ = overlay.set_ignore_cursor_events(true);
    CLICK_THROUGH.store(255, Ordering::SeqCst);
}

#[cfg(windows)]
fn promote_window_zorder(win: &tauri::WebviewWindow) {
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

    let Ok(hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as isize;
    unsafe {
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOPMOST);
        let _ = SetWindowPos(
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
fn promote_window_zorder(_win: &tauri::WebviewWindow) {}

fn promote_overlay_zorder(overlay: &tauri::WebviewWindow) {
    // 과도한 SetWindowPos 방지 (최소 1.5초 간격)
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let prev = LAST_Z_PROMOTE_MS.load(Ordering::SeqCst);
    if now_ms.saturating_sub(prev) < 1500 {
        return;
    }
    LAST_Z_PROMOTE_MS.store(now_ms, Ordering::SeqCst);
    promote_window_zorder(overlay);
}
/// 캡처 세션 중 강제 표시 (양보 상태와 무관하게 show + topmost)
fn force_overlay_visible_for_capture(app: &AppHandle) {
    if FILE_DIALOG_OPEN.load(Ordering::SeqCst) {
        return;
    }
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

    /// 영역 선택 중 프로세스 (상주 SnippingTool은 제외 — 항상 숨김 방지)
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
            // Win+Shift+S 또는 PrtSc
            print_screen || (win && shift && s)
        }
    }

    pub fn screen_clipping_host_running() -> bool {
        any_process_matching(REGION_SELECT_PROCESSES)
    }

    /// 핫키 또는 캡처 관련 프로세스
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
    pub fn capture_hotkey_down() -> bool {
        false
    }

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
        let mut suppress_select_until: Option<Instant> = None;
        let mut inactive_since: Option<Instant> = None;
        let mut hotkey_hold_until: Option<Instant> = None;
        let mut last_topmost_refresh = Instant::now();

        loop {
            let hotkey =
                std::panic::catch_unwind(capture_detect::capture_hotkey_down).unwrap_or(false);
            let host_running = std::panic::catch_unwind(
                capture_detect::screen_clipping_host_running,
            )
            .unwrap_or(false);
            let selecting =
                std::panic::catch_unwind(capture_detect::region_select_active).unwrap_or(false);

            if hotkey {
                hotkey_hold_until = Some(Instant::now() + HOTKEY_SESSION_HOLD);
            }
            // Host를 본 뒤 사라지면 세션 종료 쪽으로
            if saw_clipping_host && !host_running && !hotkey {
                hotkey_hold_until = None;
            }
            let hotkey_hold = hotkey_hold_until.is_some_and(|t| Instant::now() < t);

            let toast_yielding = capture_yield_active();
            let select_suppressed = suppress_select_until
                .is_some_and(|t| Instant::now() < t)
                && !host_running
                && !hotkey_hold;

            let capturing =
                (selecting || host_running || hotkey || hotkey_hold) && !select_suppressed;
            let started = session_started_at.unwrap_or_else(Instant::now);
            let waiting_for_host =
                in_capture_session && !saw_clipping_host && started.elapsed() < HOST_SPAWN_WAIT;

            if capturing || waiting_for_host {
                // 캡처 중: 캐릭터 유지(스크린샷 포함) + 이동만 정지
                if !in_capture_session {
                    session_started_at = Some(Instant::now());
                    saw_clipping_host = false;
                    suppress_select_until = None;
                    YIELD_EXHAUSTED.store(false, Ordering::SeqCst);
                }
                in_capture_session = true;
                inactive_since = None;
                if host_running {
                    saw_clipping_host = true;
                }
                clear_capture_yield();
                notify_capture_freeze(&app, true);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    force_overlay_visible_for_capture(&app);
                }));
            } else if in_capture_session {
                // 캡처 종료 → 토스트용으로만 숨김 (캐릭터는 캡처 중에 이미 찍힘)
                let since = inactive_since.get_or_insert_with(Instant::now);
                notify_capture_freeze(&app, true);
                extend_capture_yield();
                if since.elapsed() >= CAPTURE_END_DEBOUNCE {
                    notify_capture_freeze(&app, false);
                    IN_REGION_SELECT.store(false, Ordering::SeqCst);
                    suppress_select_until = Some(Instant::now() + TOAST_GRACE);
                    hotkey_hold_until = None;
                    in_capture_session = false;
                    session_started_at = None;
                    saw_clipping_host = false;
                    inactive_since = None;
                }
            } else if !toast_yielding {
                notify_capture_freeze(&app, false);
                IN_REGION_SELECT.store(false, Ordering::SeqCst);
                YIELD_EXHAUSTED.store(false, Ordering::SeqCst);
                inactive_since = None;
                if suppress_select_until.is_some_and(|t| Instant::now() >= t) {
                    suppress_select_until = None;
                }
                if OVERLAY_USER_VISIBLE.load(Ordering::SeqCst)
                    && YIELD_STATE.load(Ordering::SeqCst) == 0
                    && !FILE_DIALOG_OPEN.load(Ordering::SeqCst)
                    && last_topmost_refresh.elapsed() >= Duration::from_secs(2)
                {
                    last_topmost_refresh = Instant::now();
                    if let Some(overlay) = app.get_webview_window("overlay") {
                        // 설정 창이 위에 있으면 z-promote로 덮지 않음
                        let settings_open = app
                            .get_webview_window("settings")
                            .and_then(|w| w.is_visible().ok())
                            .unwrap_or(false);
                        if !settings_open {
                            let _ = overlay.set_always_on_top(true);
                            promote_overlay_zorder(&overlay);
                        }
                    }
                }
            }

            // 캡처 "중"에는 숨기지 않음 — 끝난 뒤에만 양보
            let yielding =
                capture_yield_active() && !capturing && !waiting_for_host;
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                apply_capture_yield(&app, yielding);
            }));
            thread::sleep(Duration::from_millis(50));
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
            flip_overlay_visibility,
            is_overlay_user_visible,
            is_settings_visible,
            show_invite_toast,
            hide_invite_toast,
            get_cursor_pos,
            is_capture_freeze,
            get_click_debug,
            open_devtools,
            force_overlay_interactive,
            pick_chat_file
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

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
                                hide_invite_toast_window(app);
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
