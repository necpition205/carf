use frida::{DeviceManager, Frida, Message, Script, ScriptHandler, ScriptOption, Session, SpawnOptions};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender},
    time::Duration,
};
use tauri::Emitter;

// Run all Frida calls on a single dedicated thread because most frida-rust types are !Send/!Sync.
type Job = Box<dyn FnOnce(&mut FridaContext) + Send + 'static>;

#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub device_type: String,
}

#[derive(Debug, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct SessionInfo {
    pub session_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ScriptInfo {
    pub script_id: u64,
}

struct SessionRecord {
    _device_id: String,
    _pid: u32,
    session: Session<'static>,
    script_ids: Vec<u64>,
}

struct ScriptRecord {
    session_id: u64,
    script: Script<'static>,
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

    fn list_processes(&self, device_id: &str) -> Result<Vec<ProcessInfo>, String> {
        validate_no_nul("device_id", device_id)?;

        let device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        Ok(device
            .enumerate_processes()
            .into_iter()
            .map(|process| ProcessInfo {
                pid: process.get_pid(),
                name: process.get_name().to_string(),
            })
            .collect())
    }

    fn attach(&mut self, device_id: &str, pid: u32) -> Result<SessionInfo, String> {
        validate_no_nul("device_id", device_id)?;

        let device = self
            .device_manager
            .get_device_by_id(device_id)
            .map_err(|e| e.to_string())?;

        let session = device.attach(pid).map_err(|e| e.to_string())?;

        // Safety: sessions are reference-counted internally (frida_unref on Drop). We keep the
        // Frida runtime alive for the lifetime of this context, so it's safe to extend the
        // session lifetime.
        let session: Session<'static> = unsafe { std::mem::transmute(session) };

        let session_id = self.next_session_id;
        self.next_session_id = self.next_session_id.saturating_add(1);

        self.sessions.insert(
            session_id,
            SessionRecord {
                _device_id: device_id.to_string(),
                _pid: pid,
                session,
                script_ids: Vec::new(),
            },
        );

        let _ = self.app.emit(
            "frida_session_attached",
            json!({ "session_id": session_id, "device_id": device_id, "pid": pid }),
        );

        Ok(SessionInfo { session_id })
    }

    fn detach(&mut self, session_id: u64) -> Result<(), String> {
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
                if record.session.is_detached() {
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
        static DEFAULT_SCRIPT: &str = include_str!("../../src-frida/dist/index.js");

        let record = self
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| "Unknown session_id".to_string())?;

        let script_id = self.next_script_id;
        self.next_script_id = self.next_script_id.saturating_add(1);

        let mut options = ScriptOption::new().set_name("carf-agent");

        let mut script = record
            .session
            .create_script(DEFAULT_SCRIPT, &mut options)
            .map_err(|e| e.to_string())?;

        script
            .handle_message(TauriScriptHandler {
                app: self.app.clone(),
                session_id,
                script_id,
            })
            .map_err(|e| e.to_string())?;

        script.load().map_err(|e| e.to_string())?;

        // Safety: we keep the underlying Frida runtime and session alive for the lifetime of this
        // context. Scripts are reference-counted internally and will be dropped before detaching
        // the session.
        let script: Script<'static> = unsafe { std::mem::transmute(script) };

        self.scripts.insert(
            script_id,
            ScriptRecord {
                session_id,
                script,
            },
        );
        record.script_ids.push(script_id);

        Ok(ScriptInfo { script_id })
    }

    fn unload_script(&mut self, script_id: u64) -> Result<(), String> {
        let record = self
            .scripts
            .remove(&script_id)
            .ok_or_else(|| "Unknown script_id".to_string())?;

        if let Some(session) = self.sessions.get_mut(&record.session_id) {
            session.script_ids.retain(|id| *id != script_id);
        }

        record.script.unload().map_err(|e| e.to_string())
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

        let message_json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        validate_no_nul("message", &message_json)?;

        record
            .script
            .post(message_json, data.as_deref())
            .map_err(|e| e.to_string())
    }

    fn spawn(
        &mut self,
        device_id: &str,
        program: String,
        argv: Option<Vec<String>>,
    ) -> Result<u32, String> {
        validate_no_nul("device_id", device_id)?;
        validate_no_nul("program", &program)?;

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
