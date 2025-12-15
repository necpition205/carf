use crate::frida_service::{DeviceInfo, FridaWorker, ProcessInfo, ScriptInfo, SessionInfo};
use tauri::State;

#[tauri::command]
pub async fn frida_version(frida: State<'_, FridaWorker>) -> Result<String, String> {
    frida.version().await
}

#[tauri::command]
pub async fn frida_list_devices(frida: State<'_, FridaWorker>) -> Result<Vec<DeviceInfo>, String> {
    frida.list_devices().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_list_processes(
    frida: State<'_, FridaWorker>,
    device_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    frida.list_processes(device_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_attach(
    frida: State<'_, FridaWorker>,
    device_id: String,
    pid: u32,
) -> Result<SessionInfo, String> {
    frida.attach(device_id, pid).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_detach(frida: State<'_, FridaWorker>, session_id: u64) -> Result<(), String> {
    frida.detach(session_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_spawn(
    frida: State<'_, FridaWorker>,
    device_id: String,
    program: String,
    argv: Option<Vec<String>>,
) -> Result<u32, String> {
    frida.spawn(device_id, program, argv).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_resume(
    frida: State<'_, FridaWorker>,
    device_id: String,
    pid: u32,
) -> Result<(), String> {
    frida.resume(device_id, pid).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_kill(
    frida: State<'_, FridaWorker>,
    device_id: String,
    pid: u32,
) -> Result<(), String> {
    frida.kill(device_id, pid).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_load_default_script(
    frida: State<'_, FridaWorker>,
    session_id: u64,
) -> Result<ScriptInfo, String> {
    frida.load_default_script(session_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_unload_script(frida: State<'_, FridaWorker>, script_id: u64) -> Result<(), String> {
    frida.unload_script(script_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn frida_script_post(
    frida: State<'_, FridaWorker>,
    script_id: u64,
    message: serde_json::Value,
    data: Option<Vec<u8>>,
) -> Result<(), String> {
    frida.script_post(script_id, message, data).await
}
