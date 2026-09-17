use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn set_click_through(app: AppHandle, enabled: bool) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    overlay
        .set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_overlay(app: AppHandle, visible: bool) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window missing".to_string())?;
    if visible {
        overlay.show().map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            show_settings,
            toggle_overlay,
            get_cursor_pos
        ])
        .setup(|app| {
            setup_overlay(app.handle())?;

            let show_i = MenuItem::with_id(app, "show", "설정 열기", true, None::<&str>)?;
            let toggle_i =
                MenuItem::with_id(app, "toggle", "오버레이 표시/숨김", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &toggle_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("MoniBuddy")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_settings(app.clone());
                    }
                    "toggle" => {
                        if let Some(overlay) = app.get_webview_window("overlay") {
                            if overlay.is_visible().unwrap_or(true) {
                                let _ = overlay.hide();
                            } else {
                                let _ = overlay.show();
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MoniBuddy");
}
