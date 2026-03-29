mod auth;
mod commands;
mod esoui;
mod installer;
mod manifest;
mod metadata;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Stores the approved addons directory path. Commands that perform
/// write operations validate the caller-supplied path against this
/// value, preventing a compromised webview from targeting arbitrary
/// filesystem locations.
pub struct ApprovedAddonsPath {
    pub configured: PathBuf,
    pub canonical: PathBuf,
}

pub struct AllowedAddonsPath(pub Mutex<Option<ApprovedAddonsPath>>);

/// Actions that can be triggered by a deep link URL.
#[derive(Clone)]
enum DeepLinkAction {
    /// Open a pack by ID: `eso-addon-manager://pack/{id}`
    Pack(String),
    /// Import a shared pack by code: `eso-addon-manager://share/{code}`
    Share(String),
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeepLinkPayload {
    pub pack_id: Option<String>,
    pub share_code: Option<String>,
}

pub struct PendingDeepLink(pub Mutex<PendingDeepLinkPayload>);

/// Extract an action from a deep link URL.
fn parse_deep_link(url: &str) -> Option<DeepLinkAction> {
    let url = url.trim();

    // Share codes: eso-addon-manager://share/{code}
    if let Some(rest) = url.strip_prefix("eso-addon-manager://share/") {
        let code = rest.split(['/', '?', '#']).next()?.trim();
        if !code.is_empty() {
            return Some(DeepLinkAction::Share(code.to_string()));
        }
    }

    // Pack IDs: eso-addon-manager://pack/{id} or eso-addon-manager://packs/{id}
    let path = url
        .strip_prefix("eso-addon-manager://pack/")
        .or_else(|| url.strip_prefix("eso-addon-manager://packs/"))?;
    let id = path.split(['/', '?', '#']).next()?.trim();
    if id.is_empty() {
        None
    } else {
        Some(DeepLinkAction::Pack(id.to_string()))
    }
}

/// Focus the main window and emit the appropriate deep-link event.
fn emit_deep_link(app: &tauri::AppHandle, action: &DeepLinkAction) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    match action {
        DeepLinkAction::Pack(id) => {
            let _ = app.emit("deep-link-pack", id.as_str());
        }
        DeepLinkAction::Share(code) => {
            let _ = app.emit("deep-link-share", code.as_str());
        }
    }
}

fn pending_deep_link_payload(action: &DeepLinkAction) -> PendingDeepLinkPayload {
    match action {
        DeepLinkAction::Pack(id) => PendingDeepLinkPayload {
            pack_id: Some(id.clone()),
            share_code: None,
        },
        DeepLinkAction::Share(code) => PendingDeepLinkPayload {
            pack_id: None,
            share_code: Some(code.clone()),
        },
    }
}

pub fn run() {
    // Enable Chrome DevTools Protocol in debug builds only
    #[cfg(debug_assertions)]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--remote-debugging-port=9222",
    );

    tauri::Builder::default()
        .manage(AllowedAddonsPath(Mutex::new(None)))
        .manage(auth::AuthState(Mutex::new(None)))
        .manage(PendingDeepLink(Mutex::new(
            PendingDeepLinkPayload::default(),
        )))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Focus the existing window when a duplicate instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Check argv for deep link URLs (Windows/Linux pass them as CLI args)
            for arg in &argv {
                if let Some(action) = parse_deep_link(arg) {
                    emit_deep_link(app, &action);
                    break;
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            if let Some(action) = std::env::args().find_map(|arg| parse_deep_link(&arg)) {
                if let Ok(mut pending) = app.state::<PendingDeepLink>().0.lock() {
                    *pending = pending_deep_link_payload(&action);
                }
            }

            // Register the deep link scheme at runtime (for dev / non-installer builds)
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

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

            // Load saved auth tokens from store
            {
                use tauri_plugin_store::StoreExt;
                if let Ok(store) = app.store("settings.json") {
                    if let Some(val) = store.get("auth_tokens") {
                        if let Ok(tokens) = serde_json::from_value::<auth::AuthTokens>(val.clone())
                        {
                            if let Ok(mut guard) = app.state::<auth::AuthState>().0.lock() {
                                *guard = Some(tokens);
                            }
                        }
                    }
                }
            }

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
            commands::set_addon_tags,
            commands::resolve_esoui_addon,
            commands::search_esoui_addons,
            commands::fetch_esoui_detail,
            commands::install_addon,
            commands::remove_addon,
            commands::install_dependency,
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
            commands::list_packs,
            commands::get_pack,
            commands::auth_login,
            commands::auth_logout,
            commands::auth_get_user,
            commands::consume_initial_deep_link,
            commands::create_pack,
            commands::update_pack,
            commands::vote_pack,
            commands::create_share_code,
            commands::resolve_share_code,
            commands::export_pack_file,
            commands::import_pack_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
