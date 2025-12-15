use frida::{Device, DeviceManager, Frida, Message, Script, ScriptHandler, ScriptOption, Session, SpawnOptions};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    mem::ManuallyDrop,
    sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender},
    time::{Duration, Instant},
};
use tauri::Emitter;

fn debug_log(_msg: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[carf] {}", _msg);
}

// Run all Frida calls on a single dedicated thread because most frida-rust types are !Send/!Sync.
type Job = Box<dyn FnOnce(&mut FridaContext) + Send + 'static>;

#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub device_type: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Clone)]
struct ProcessListCache {
    device_id: String,
    fetched_at: Instant,
    processes: Vec<ProcessInfo>,
}

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub session_id: u64,
    pub script_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ScriptInfo {
    pub script_id: u64,
}

struct SessionRecord {
    _device_id: String,
    _pid: u32,
    // Safety: `Session` may internally depend on the `Device` being alive while dropping.
    // We manually control drop order to prevent potential use-after-free.
    session: ManuallyDrop<Session<'static>>,
    _device: ManuallyDrop<Device<'static>>,
    script_ids: Vec<u64>,
}

impl Drop for SessionRecord {
    fn drop(&mut self) {
        // Drop `Session` first, then the keepalive `Device`.
        unsafe {
            ManuallyDrop::drop(&mut self.session);
            ManuallyDrop::drop(&mut self._device);
        }
    }
}

struct ScriptRecord {
    session_id: u64,
    // Safety: Script is leaked (Box::leak) to ensure the callback handler pointer remains valid
    // for the lifetime of the Frida GLib main loop. We manually drop it via Box::from_raw.
    script: *mut Script<'static>,
}

pub struct FridaWorker {
    tx: Sender<Job>,
}

impl FridaWorker {
    pub fn new(app: tauri::AppHandle) -> Self {
        let (tx, rx) = channel::<Job>();

        std::thread::spawn(move || {
            let mut ctx = FridaContext::new(app);
            ctx.run(rx);
        });

        Self { tx }
    }

    // IPC-friendly wrappers so the rest of the app doesn't need access to `FridaContext`.
    pub async fn version(&self) -> Result<String, String> {
        self.request(|ctx| Ok(ctx.version())).await
    }

    pub async fn list_devices(&self) -> Result<Vec<DeviceInfo>, String> {
        self.request(|ctx| Ok(ctx.list_devices())).await
    }

    pub async fn list_processes(&self, device_id: String) -> Result<Vec<ProcessInfo>, String> {
        self.request(move |ctx| ctx.list_processes(&device_id)).await
    }

    pub async fn attach(&self, device_id: String, pid: u32) -> Result<SessionInfo, String> {
        self.request(move |ctx| ctx.attach(&device_id, pid)).await
    }

    pub async fn detach(&self, session_id: u64) -> Result<(), String> {
        self.request(move |ctx| ctx.detach(session_id)).await
    }

    pub async fn spawn(
        &self,
        device_id: String,
        program: String,
        argv: Option<Vec<String>>,
    ) -> Result<u32, String> {
        self.request(move |ctx| ctx.spawn(&device_id, program, argv)).await
    }

    pub async fn resume(&self, device_id: String, pid: u32) -> Result<(), String> {
        self.request(move |ctx| ctx.resume(&device_id, pid)).await
    }

    pub async fn kill(&self, device_id: String, pid: u32) -> Result<(), String> {
        self.request(move |ctx| ctx.kill(&device_id, pid)).await
    }

    pub async fn load_default_script(&self, session_id: u64) -> Result<ScriptInfo, String> {
        self.request(move |ctx| ctx.load_default_script(session_id)).await
    }

    pub async fn unload_script(&self, script_id: u64) -> Result<(), String> {
        self.request(move |ctx| ctx.unload_script(script_id)).await
    }

    pub async fn script_post(
        &self,
        script_id: u64,
        message: serde_json::Value,
        data: Option<Vec<u8>>,
    ) -> Result<(), String> {
        self.request(move |ctx| ctx.script_post(script_id, message, data)).await
    }

    async fn request<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut FridaContext) -> Result<T, String> + Send + 'static,
    {
        let (reply_tx, reply_rx) = channel::<Result<T, String>>();

        let job: Job = Box::new(move |ctx| {
            let result = f(ctx);
            let _ = reply_tx.send(result);
        });

        self.tx
            .send(job)
            .map_err(|_| "Frida worker thread closed".to_string())?;

        let recv_result = tauri::async_runtime::spawn_blocking(move || reply_rx.recv())
            .await
            .map_err(|_| "Failed to wait for Frida worker response".to_string())?;

        recv_result.map_err(|_| "Frida worker did not respond".to_string())?
    }
}

struct FridaContext {
    app: tauri::AppHandle,
    sessions: HashMap<u64, SessionRecord>,
    scripts: HashMap<u64, ScriptRecord>,
    next_session_id: u64,
    next_script_id: u64,
    process_list_cache: Option<ProcessListCache>,
    device_manager: DeviceManager<'static>,
    _frida: Frida,
}

impl FridaContext {
    fn new(app: tauri::AppHandle) -> Self {
        let frida = unsafe { Frida::obtain() };
        let dm = DeviceManager::obtain(&frida);

        // Safety: We keep `frida` alive for the lifetime of this context, so it's safe to extend
        // the device manager lifetime.
        let device_manager: DeviceManager<'static> = unsafe { std::mem::transmute(dm) };

        Self {
            app,
            sessions: HashMap::new(),
            scripts: HashMap::new(),
            next_session_id: 1,
            next_script_id: 1,
            process_list_cache: None,
            device_manager,
            _frida: frida,
        }
    }

    fn run(&mut self, rx: Receiver<Job>) {
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(job) => job(self),
                Err(RecvTimeoutError::Timeout) => self.poll_detached_sessions(),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn poll_detached_sessions(&mut self) {
        let detached_ids: Vec<u64> = self
            .sessions
            .iter()
            .filter_map(|(session_id, record)| {
                if record.session.is_detached() {
                    Some(*session_id)
                } else {
                    None
                }
            })
            .collect();

        for session_id in detached_ids {
            let script_ids = self
                .sessions
                .get(&session_id)
                .map(|r| r.script_ids.clone())
                .unwrap_or_default();

            debug_log(&format!(
                "poll_detached_sessions: session_id={} detached, cleaning scripts={}",
                session_id,
                script_ids.len()
            ));

            for script_id in script_ids {
                let _ = self.unload_script(script_id);
            }

            let _ = self.sessions.remove(&session_id);

            let _ = self.app.emit(
                "frida_session_detached",
                json!({ "session_id": session_id, "reason": "disposed" }),
            );
        }
    }

    fn version(&self) -> String {
        Frida::version().to_string()
    }

    fn list_devices(&self) -> Vec<DeviceInfo> {
        debug_log("list_devices");

        self.device_manager
            .enumerate_all_devices()
            .into_iter()
            .map(|device| DeviceInfo {
                id: device.get_id().to_string(),
                name: device.get_name().to_string(),
                device_type: device.get_type().to_string(),
            })
            .collect()
    }

    fn list_processes(&mut self, device_id: &str) -> Result<Vec<ProcessInfo>, String> {
        validate_no_nul("device_id", device_id)?;

        debug_log(&format!("list_processes: device_id={device_id}"));

        if device_id == "socket" {
            return Err("Device 'socket' is not supported".to_string());
        }

        if let Some(cache) = self.process_list_cache.as_ref() {
            if cache.device_id == device_id && cache.fetched_at.elapsed() < Duration::from_secs(2) {
                debug_log(&format!(
                    "list_processes: returning cached results ({} processes)",
                    cache.processes.len()
                ));
                return Ok(cache.processes.clone());
            }
        }

        let device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        debug_log(&format!(
            "list_processes: resolved device name={} type={}",
            device.get_name(),
            device.get_type()
        ));

        let processes = device.enumerate_processes();
        debug_log(&format!(
            "list_processes: enumerated {} processes",
            processes.len()
        ));

        debug_log("list_processes: mapping begin");
        let infos: Vec<ProcessInfo> = processes
            .into_iter()
            .map(|process| ProcessInfo {
                pid: process.get_pid(),
                name: process.get_name().to_string(),
            })
            .collect();
        debug_log(&format!("list_processes: mapping done ({} processes)", infos.len()));

        self.process_list_cache = Some(ProcessListCache {
            device_id: device_id.to_string(),
            fetched_at: Instant::now(),
            processes: infos.clone(),
        });

        Ok(infos)
    }

    fn attach(&mut self, device_id: &str, pid: u32) -> Result<SessionInfo, String> {
        validate_no_nul("device_id", device_id)?;

        debug_log(&format!("attach: device_id={} pid={} - begin", device_id, pid));

        let device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        debug_log("attach: about to call device.attach");
        let session = device.attach(pid).map_err(|e| e.to_string())?;
        debug_log("attach: device.attach succeeded");

        // Keep a ref to the underlying device alive for the lifetime of the session.
        // This prevents potential use-after-free inside Frida when creating/loading scripts.
        //
        // Safety: Frida objects are reference-counted internally. We keep the Frida runtime alive
        // for the lifetime of this context, so it's safe to extend lifetimes to 'static.
        debug_log("attach: about to transmute session and device");
        let session: Session<'static> = unsafe { std::mem::transmute(session) };
        let device_keepalive: Device<'static> = unsafe { std::mem::transmute(device) };
        debug_log("attach: transmute succeeded");

        let session_id = self.next_session_id;
        self.next_session_id = self.next_session_id.saturating_add(1);

        debug_log(&format!("attach: about to insert session_id={}", session_id));
        self.sessions.insert(
            session_id,
            SessionRecord {
                _device_id: device_id.to_string(),
                _pid: pid,
                session: ManuallyDrop::new(session),
                _device: ManuallyDrop::new(device_keepalive),
                script_ids: Vec::new(),
            },
        );
        debug_log("attach: session inserted");

        // Load the default agent as part of attach so the caller doesn't need a separate step.
        debug_log("attach: about to load_default_script");
        let script_info = match self.load_default_script(session_id) {
            Ok(info) => {
                debug_log(&format!("attach: load_default_script succeeded script_id={}", info.script_id));
                info
            },
            Err(e) => {
                debug_log(&format!("attach: load_default_script failed: {}", e));
                // Best-effort cleanup so callers don't end up with a half-attached session.
                let _ = self.sessions.remove(&session_id);
                return Err(e);
            }
        };

        debug_log(&format!(
            "attach: device_id={} pid={} => session_id={} script_id={}",
            device_id, pid, session_id, script_info.script_id
        ));

        debug_log("attach: about to emit frida_session_attached event");
        let _ = self.app.emit(
            "frida_session_attached",
            json!({ "session_id": session_id, "script_id": script_info.script_id, "device_id": device_id, "pid": pid }),
        );
        debug_log("attach: event emitted");

        Ok(SessionInfo {
            session_id,
            script_id: script_info.script_id,
        })
    }

    fn detach(&mut self, session_id: u64) -> Result<(), String> {
        debug_log(&format!("detach: session_id={}", session_id));

        let script_ids = self
            .sessions
            .get(&session_id)
            .ok_or_else(|| "Unknown session_id".to_string())?
            .script_ids
            .clone();

        for script_id in script_ids {
            let _ = self.unload_script(script_id);
        }

        let record = self
            .sessions
            .remove(&session_id)
            .ok_or_else(|| "Unknown session_id".to_string())?;

        match record.session.detach() {
            Ok(()) => {
                let _ = self.app.emit(
                    "frida_session_detached",
                    json!({ "session_id": session_id, "reason": "user" }),
                );
                Ok(())
            }
            Err(e) => {
                if (&*record.session).is_detached() {
                    let _ = self.app.emit(
                        "frida_session_detached",
                        json!({ "session_id": session_id, "reason": "disposed" }),
                    );
                    Ok(())
                } else {
                    self.sessions.insert(session_id, record);
                    Err(e.to_string())
                }
            }
        }
    }

    fn load_default_script(&mut self, session_id: u64) -> Result<ScriptInfo, String> {
        debug_log(&format!("load_default_script: session_id={} - begin", session_id));
        static DEFAULT_SCRIPT_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/carf_default_agent.js"));

        debug_log("load_default_script: about to validate embedded script");
        let default_script = std::str::from_utf8(DEFAULT_SCRIPT_BYTES).map_err(|e| {
            format!(
                "Embedded agent script (src-frida/dist/index.js) is not valid UTF-8: {e}"
            )
        })?;
        if default_script.contains("__CARF_AGENT_MISSING__") {
            return Err(
                "Default agent bundle is missing. Build it first: `bun run compile`".to_string(),
            );
        }
        if default_script.trim().is_empty() {
            return Err("Embedded agent script (src-frida/dist/index.js) is empty".to_string());
        }
        validate_no_nul("default_script", default_script)?;
        debug_log("load_default_script: embedded script validation succeeded");

        debug_log("load_default_script: about to get session record");
        let record = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Unknown session_id".to_string())?;

        debug_log("load_default_script: about to check if session is detached");
        if (&*record.session).is_detached() {
            return Err("Session is detached".to_string());
        }

        let script_id = self.next_script_id;
        self.next_script_id = self.next_script_id.saturating_add(1);

        debug_log("load_default_script: about to create script");
        let mut options = ScriptOption::new().set_name("carf-agent");

        let script = record
            .session
            .create_script(default_script, &mut options)
            .map_err(|e| e.to_string())?;
        debug_log("load_default_script: create_script succeeded");

        // Safety: frida-rust has a known bug where the ScriptHandler callback pointer becomes
        // dangling after handle_message returns. We leak the Script to heap to ensure the
        // internal callback_handler RefCell stays valid for the Frida GLib main loop.
        debug_log("load_default_script: about to transmute script to 'static");
        let script: Script<'static> = unsafe { std::mem::transmute(script) };

        // Leak to heap so the callback handler pointer remains valid.
        let script_ptr = Box::into_raw(Box::new(script));
        debug_log("load_default_script: script leaked to heap");

        debug_log("load_default_script: about to handle_message");
        unsafe {
            (*script_ptr)
                .handle_message(TauriScriptHandler {
                    app: self.app.clone(),
                    session_id,
                    script_id,
                })
                .map_err(|e| {
                    // Clean up on failure
                    let _ = Box::from_raw(script_ptr);
                    e.to_string()
                })?;
        }
        debug_log("load_default_script: handle_message succeeded");

        debug_log("load_default_script: about to script.load()");
        unsafe {
            (*script_ptr).load().map_err(|e| {
                // Clean up on failure
                let _ = Box::from_raw(script_ptr);
                e.to_string()
            })?;
        }
        debug_log("load_default_script: script.load() succeeded");

        debug_log("load_default_script: about to insert script record");
        self.scripts.insert(
            script_id,
            ScriptRecord {
                session_id,
                script: script_ptr,
            },
        );
        record.script_ids.push(script_id);
        debug_log("load_default_script: script record inserted");

        debug_log(&format!(
            "load_default_script: session_id={} => script_id={}",
            session_id, script_id
        ));

        Ok(ScriptInfo { script_id })
    }

    fn unload_script(&mut self, script_id: u64) -> Result<(), String> {
        let record = self
            .scripts
            .remove(&script_id)
            .ok_or_else(|| "Unknown script_id".to_string())?;

        debug_log(&format!(
            "unload_script: script_id={} session_id={}",
            script_id, record.session_id
        ));

        if let Some(session) = self.sessions.get_mut(&record.session_id) {
            session.script_ids.retain(|id| *id != script_id);
        }

        // If the session is already detached/disposed, calling into Frida to unload can be unsafe.
        let should_unload = if let Some(session) = self.sessions.get(&record.session_id) {
            !(&*session.session).is_detached()
        } else {
            false
        };

        // Safety: script was allocated via Box::into_raw in load_default_script.
        let result = if should_unload {
            unsafe { (*record.script).unload().map_err(|e| e.to_string()) }
        } else {
            Ok(())
        };

        // Always reclaim the leaked memory.
        unsafe {
            let _ = Box::from_raw(record.script);
        }

        result
    }

    fn script_post(
        &mut self,
        script_id: u64,
        message: serde_json::Value,
        data: Option<Vec<u8>>,
    ) -> Result<(), String> {
        let record = self
            .scripts
            .get(&script_id)
            .ok_or_else(|| "Unknown script_id".to_string())?;

        if let Some(session) = self.sessions.get(&record.session_id) {
            if (&*session.session).is_detached() {
                return Err("Session is detached".to_string());
            }
        } else {
            return Err("Session is detached".to_string());
        }

        let message_json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        validate_no_nul("message", &message_json)?;

        // Safety: script was allocated via Box::into_raw in load_default_script.
        unsafe {
            (*record.script)
                .post(message_json, data.as_deref())
                .map_err(|e| e.to_string())
        }
    }

    fn spawn(
        &mut self,
        device_id: &str,
        program: String,
        argv: Option<Vec<String>>,
    ) -> Result<u32, String> {
        validate_no_nul("device_id", device_id)?;
        validate_no_nul("program", &program)?;

        self.process_list_cache = None;

        if let Some(ref argv) = argv {
            for (i, arg) in argv.iter().enumerate() {
                validate_no_nul(&format!("argv[{i}]"), arg)?;
            }
        }

        let mut device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        let mut options = SpawnOptions::new();
        if let Some(argv) = argv {
            options = options.argv(argv);
        }

        device.spawn(program, &options).map_err(|e| e.to_string())
    }

    fn resume(&mut self, device_id: &str, pid: u32) -> Result<(), String> {
        validate_no_nul("device_id", device_id)?;

        let device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        device.resume(pid).map_err(|e| e.to_string())
    }

    fn kill(&mut self, device_id: &str, pid: u32) -> Result<(), String> {
        validate_no_nul("device_id", device_id)?;

        self.process_list_cache = None;

        let mut device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        device.kill(pid).map_err(|e| e.to_string())
    }
}

fn validate_no_nul(label: &str, value: &str) -> Result<(), String> {
    if value.contains('\0') {
        return Err(format!(
            "{label} contains a NUL (\\0) byte, which frida-rust APIs do not support"
        ));
    }

    Ok(())
}

#[derive(Clone)]
struct TauriScriptHandler {
    app: tauri::AppHandle,
    session_id: u64,
    script_id: u64,
}

impl ScriptHandler for TauriScriptHandler {
    fn on_message(&mut self, message: Message, data: Option<Vec<u8>>) {
        let message_value = match message {
            Message::Send(m) => json!({
                "type": "send",
                "payload": {
                    "type": m.payload.r#type,
                    "id": m.payload.id,
                    "result": m.payload.result,
                    "returns": m.payload.returns,
                }
            }),
            Message::Log(m) => json!({
                "type": "log",
                "payload": {
                    "level": format!("{:?}", m.level),
                    "payload": m.payload,
                }
            }),
            Message::Error(m) => json!({
                "type": "error",
                "payload": {
                    "description": m.description,
                    "stack": m.stack,
                    "file_name": m.file_name,
                    "line_number": m.line_number,
                    "column_number": m.column_number,
                }
            }),
            Message::Other(v) => json!({
                "type": "other",
                "payload": v,
            }),
        };

        let payload = json!({
            "session_id": self.session_id,
            "script_id": self.script_id,
            "message": message_value,
            "data": data,
        });

        let _ = self.app.emit("frida_script_message", payload);
    }
}

#[cfg(test)]
mod tests {
    use super::validate_no_nul;

    #[test]
    fn validate_no_nul_allows_regular_strings() {
        assert!(validate_no_nul("device_id", "local").is_ok());
    }

    #[test]
    fn validate_no_nul_rejects_nul_bytes() {
        assert!(validate_no_nul("device_id", "a\0b").is_err());
    }
}
