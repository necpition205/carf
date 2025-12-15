pub mod frida;

// Router-like command registration.
// Add new command modules here and mount them in `handler()`.
pub fn handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        frida::frida_version,
        frida::frida_list_devices,
        frida::frida_list_processes,
        frida::frida_attach,
        frida::frida_detach,
        frida::frida_spawn,
        frida::frida_resume,
        frida::frida_kill,
        frida::frida_load_default_script,
        frida::frida_unload_script,
        frida::frida_script_post,
    ]
}
