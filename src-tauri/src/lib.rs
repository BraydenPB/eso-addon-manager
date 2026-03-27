mod commands;
mod esoui;
mod installer;
mod manifest;
mod metadata;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// Stores the approved addons directory path. Commands that perform
/// write operations validate the caller-supplied path against this
/// value, preventing a compromised webview from targeting arbitrary
/// filesystem locations.
pub struct AllowedAddonsPath(pub Mutex<Option<PathBuf>>);

pub fn run() {
    // Enable Chrome DevTools Protocol in debug builds only
    #[cfg(debug_assertions)]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--remote-debugging-port=9222",
    );

    tauri::Builder::default()
        .manage(AllowedAddonsPath(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the existing window when a duplicate instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            let show_item = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("default window icon must be set in tauri.conf.json"),
                )
                .tooltip("ESO Addon Manager")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_addons_path,
            commands::detect_addons_folder,
            commands::scan_installed_addons,
            commands::resolve_esoui_addon,
            commands::search_esoui_addons,
            commands::fetch_esoui_detail,
            commands::install_addon,
            commands::remove_addon,
            commands::check_for_updates,
            commands::update_addon,
            commands::export_addon_list,
            commands::import_addon_list,
            commands::auto_link_addons,
            commands::batch_remove_addons,
            commands::get_esoui_categories,
            commands::browse_esoui_category,
            commands::check_api_compatibility,
            commands::list_backups,
            commands::create_backup,
            commands::restore_backup,
            commands::delete_backup,
            commands::list_profiles,
            commands::create_profile,
            commands::activate_profile,
            commands::delete_profile,
            commands::list_characters,
            commands::backup_character_settings,
            commands::detect_minion,
            commands::migrate_from_minion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
