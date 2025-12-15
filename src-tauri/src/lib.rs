mod commands;
mod frida_service;
mod input_service;

use frida_service::FridaWorker;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            input_service::start_global_key_listener(app.handle().clone());
            app.manage(FridaWorker::new(app.handle().clone()));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
