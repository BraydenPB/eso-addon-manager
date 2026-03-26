mod commands;
mod esoui;
mod installer;
mod manifest;
mod metadata;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::detect_addons_folder,
            commands::scan_installed_addons,
            commands::resolve_esoui_addon,
            commands::install_addon,
            commands::remove_addon,
            commands::check_for_updates,
            commands::update_addon,
            commands::export_addon_list,
            commands::import_addon_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
