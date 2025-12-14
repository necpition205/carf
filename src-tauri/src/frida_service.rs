use frida::{DeviceManager, Frida, Session, SpawnOptions};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::mpsc::{channel, Receiver, Sender},
};

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

struct SessionRecord {
    _device_id: String,
    _pid: u32,
    session: Session<'static>,
}

pub struct FridaWorker {
    tx: Sender<Job>,
}

impl FridaWorker {
    pub fn new() -> Self {
        let (tx, rx) = channel::<Job>();

        std::thread::spawn(move || {
            let mut ctx = FridaContext::new();
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
    sessions: HashMap<u64, SessionRecord>,
    next_session_id: u64,
    device_manager: DeviceManager<'static>,
    _frida: Frida,
}

impl FridaContext {
    fn new() -> Self {
        let frida = unsafe { Frida::obtain() };
        let dm = DeviceManager::obtain(&frida);

        // Safety: We keep `frida` alive for the lifetime of this context, so it's safe to extend
        // the device manager lifetime.
        let device_manager: DeviceManager<'static> = unsafe { std::mem::transmute(dm) };

        Self {
            sessions: HashMap::new(),
            next_session_id: 1,
            device_manager,
            _frida: frida,
        }
    }

    fn run(&mut self, rx: Receiver<Job>) {
        while let Ok(job) = rx.recv() {
            job(self);
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
            },
        );

        Ok(SessionInfo { session_id })
    }

    fn detach(&mut self, session_id: u64) -> Result<(), String> {
        let record = self
            .sessions
            .remove(&session_id)
            .ok_or_else(|| "Unknown session_id".to_string())?;

        record.session.detach().map_err(|e| e.to_string())
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
