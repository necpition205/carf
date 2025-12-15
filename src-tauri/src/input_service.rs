use rdev::{listen, Event, EventType, Key};
use serde::Serialize;
use serde_json::json;
use std::sync::{Mutex, Once};
use tauri::Emitter;

// Global keyboard listener based on rdev.
// We emit normalized key events to the frontend so it can implement hotkeys / command palette.

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub meta: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyAction {
    Press,
    Release,
}

#[derive(Debug, Clone, Serialize)]
pub struct GlobalKeyEvent {
    pub action: KeyAction,
    pub key: String,
    pub name: Option<String>,
    pub modifiers: Modifiers,
}

#[derive(Debug, Clone, Copy)]
struct ModifierCounters {
    ctrl: u8,
    shift: u8,
    alt: u8,
    meta: u8,
}

impl ModifierCounters {
    const fn new() -> Self {
        Self {
            ctrl: 0,
            shift: 0,
            alt: 0,
            meta: 0,
        }
    }

    fn snapshot(&self) -> Modifiers {
        Modifiers {
            ctrl: self.ctrl > 0,
            shift: self.shift > 0,
            alt: self.alt > 0,
            meta: self.meta > 0,
        }
    }
}

static START: Once = Once::new();
static MODS: Mutex<ModifierCounters> = Mutex::new(ModifierCounters::new());

fn bump(counter: &mut u8, is_down: bool) {
    if is_down {
        *counter = counter.saturating_add(1);
    } else {
        *counter = counter.saturating_sub(1);
    }
}

fn apply_modifier(counters: &mut ModifierCounters, key: Key, is_down: bool) {
    match key {
        Key::ControlLeft | Key::ControlRight => bump(&mut counters.ctrl, is_down),
        Key::ShiftLeft | Key::ShiftRight => bump(&mut counters.shift, is_down),
        Key::Alt | Key::AltGr => bump(&mut counters.alt, is_down),
        Key::MetaLeft | Key::MetaRight => bump(&mut counters.meta, is_down),
        _ => {}
    }
}

fn translate_key_event(event: Event) -> Option<GlobalKeyEvent> {
    let (action, key) = match event.event_type {
        EventType::KeyPress(key) => (KeyAction::Press, key),
        EventType::KeyRelease(key) => (KeyAction::Release, key),
        _ => return None,
    };

    let is_down = matches!(action, KeyAction::Press);

    let mut counters = MODS.lock().unwrap_or_else(|e| e.into_inner());
    apply_modifier(&mut counters, key, is_down);

    Some(GlobalKeyEvent {
        action,
        key: format!("{:?}", key),
        name: event.name,
        modifiers: counters.snapshot(),
    })
}

pub fn start_global_key_listener(app: tauri::AppHandle) {
    START.call_once(move || {
        std::thread::spawn(move || {
            let app_for_callback = app.clone();

            let callback = move |event: Event| {
                let Some(payload) = translate_key_event(event) else {
                    return;
                };

                let _ = app_for_callback.emit("rdev_key_event", payload);
            };

            if let Err(e) = listen(callback) {
                let _ = app.emit("rdev_listen_error", json!({ "error": format!("{:?}", e) }));
            }
        });
    });
}
