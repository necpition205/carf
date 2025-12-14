mod frida_service;

use frida_service::{DeviceInfo, FridaWorker, ProcessInfo, SessionInfo};
use tauri::State;

#[tauri::command]
async fn frida_version(frida: State<'_, FridaWorker>) -> Result<String, String> {
    frida.version().await
}

#[tauri::command]
async fn frida_list_devices(frida: State<'_, FridaWorker>) -> Result<Vec<DeviceInfo>, String> {
    frida.list_devices().await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_list_processes(
    frida: State<'_, FridaWorker>,
    device_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    frida.list_processes(device_id).await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_attach(
    frida: State<'_, FridaWorker>,
    device_id: String,
    pid: u32,
) -> Result<SessionInfo, String> {
    frida.attach(device_id, pid).await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_detach(frida: State<'_, FridaWorker>, session_id: u64) -> Result<(), String> {
    frida.detach(session_id).await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_spawn(
    frida: State<'_, FridaWorker>,
    device_id: String,
    program: String,
    argv: Option<Vec<String>>,
) -> Result<u32, String> {
    frida.spawn(device_id, program, argv).await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_resume(frida: State<'_, FridaWorker>, device_id: String, pid: u32) -> Result<(), String> {
    frida.resume(device_id, pid).await
}

#[tauri::command(rename_all = "snake_case")]
async fn frida_kill(frida: State<'_, FridaWorker>, device_id: String, pid: u32) -> Result<(), String> {
    frida.kill(device_id, pid).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FridaWorker::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            frida_version,
            frida_list_devices,
            frida_list_processes,
            frida_attach,
            frida_detach,
            frida_spawn,
            frida_resume,
            frida_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
