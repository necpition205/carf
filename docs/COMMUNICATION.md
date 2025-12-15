# CARF Communication & Extension Guide (Backend ↔ Frontend ↔ Agent)

This document explains how CARF wires **Tauri (Rust backend)**, **React (frontend)**, and the **Frida agent (injected script)** together.

## Glossary

- **FE**: Frontend (React, TypeScript)
- **BE**: Backend (Tauri Rust)
- **Agent**: Frida script running inside the target process (compiled from `src-frida/`)

## High-level architecture

CARF uses a 3-hop model:

1. **FE → BE** via **Tauri commands** (`invoke`)
2. **BE → FE** via **Tauri events** (`app.emit` + `listen`)
3. **BE ↔ Agent** via **Frida script messaging** (`script.post` / `send` / `recv`)

The Frida Rust bindings are mostly `!Send/!Sync`, so CARF runs all Frida calls on a **single dedicated worker thread**.

## Backend (Rust) APIs

### Commands (FE → BE)

Commands are registered in **one place**:

- `src-tauri/src/commands/mod.rs` exports `handler()`
- `src-tauri/src/lib.rs` uses `.invoke_handler(commands::handler())`

This is intentionally “router-like”: adding a command should mean **adding a function + adding it to `handler()`**.

Currently exposed commands:

- `frida_version() -> Result<String, String>`
- `frida_list_devices() -> Result<DeviceInfo[], String>`
- `frida_list_processes({ device_id }) -> Result<ProcessInfo[], String>`
- `frida_attach({ device_id, pid }) -> Result<SessionInfo, String>`
- `frida_detach({ session_id }) -> Result<(), String>`
- `frida_spawn({ device_id, program, argv? }) -> Result<pid: u32, String>`
- `frida_resume({ device_id, pid }) -> Result<(), String>`
- `frida_kill({ device_id, pid }) -> Result<(), String>`
- `frida_load_default_script({ session_id }) -> Result<ScriptInfo, String>`
- `frida_unload_script({ script_id }) -> Result<(), String>`
- `frida_script_post({ script_id, message, data? }) -> Result<(), String>`

### Events (BE → FE)

The backend emits these events:

- `frida_session_attached`
  - payload: `{ session_id: number, device_id: string, pid: number }`
- `frida_session_detached`
  - payload: `{ session_id: number, reason: "user" | "disposed" }`
- `frida_script_message`
  - payload: `{ session_id: number, script_id: number, message: ScriptMessage, data?: number[] }`

Where `ScriptMessage` is a normalized envelope built by Rust:

- `{ type: "send", payload: { type, id, result, returns } }`
- `{ type: "log", payload: { level, payload } }`
- `{ type: "error", payload: { description, stack, file_name, line_number, column_number } }`
- `{ type: "other", payload: any }`

### Global input events (rdev)

The backend also emits global keyboard events using the `rdev` crate.

- `rdev_key_event`
  - payload: `{ action: "press" | "release", key: string, name: string | null, modifiers: { ctrl, shift, alt, meta } }`
- `rdev_listen_error`
  - payload: `{ error: string }`

Frontend helpers live under:

- `src/features/input/events.ts`
- `src/features/input/store.ts`

## Agent messaging model

### Backend → Agent

The backend calls `script.post(message_json, data)`.

- `message_json` is a JSON string
- `data` is optional bytes

In the Agent, you receive it with `recv(<channel>, callback)`.

### Agent → Backend

The agent uses Frida’s `send(payload)`.

On the Rust side, this arrives as a `Message::Send`, and CARF forwards it to the frontend as the `frida_script_message` event.

## RPC-style protocol used by the default agent

CARF’s default agent implements a simple request/response protocol:

- Requests from host: `recv("carf:request", ...)`
- Responses to host: `send({ type: "carf:response", id, result, returns })`

### Request shape (host → agent)

```json
{
  "type": "carf:request",
  "payload": {
    "id": 1,
    "method": "ping",
    "params": {}
  }
}
```

### Response shape (agent → host)

```json
{
  "type": "carf:response",
  "id": 1,
  "result": "ok",
  "returns": { "pong": true }
}
```

The agent source lives in `src-frida/index.ts`.

## Frontend implementation map

### FE → BE

- Typed invoke wrappers: `src/features/frida/backendApi.ts`
- High-level state/actions: `src/features/frida/store.ts`

### FE ↔ Agent (through BE)

- Request/response matching: `src/features/frida/agentRpc.ts`
  - Listens to `frida_script_message`
  - Matches `carf:response` by `id`

### Session lifecycle

- `src/features/frida/store.ts` listens to `frida_session_attached/detached` and updates state

## Extending CARF (DX-first)

### 1) Add a new backend command (Express-like “route”)

Goal: add `frida_read_memory`.

1. Create a new command function in a module under `src-tauri/src/commands/` (either `frida.rs` or a new module like `memory.rs`).
2. Add it to `commands::handler()` in `src-tauri/src/commands/mod.rs`.
3. Add a TypeScript wrapper in `src/features/frida/backendApi.ts`.
4. (Optional) Add a Zustand action in `src/features/frida/store.ts`.

This mirrors an Express flow:

- Express: `router.get('/read-memory', ...)` then `app.use(router)`
- CARF: `commands::memory::read_memory` then `commands::handler()` mounts it

### 2) Add a new agent RPC method (FE → Agent)

1. Add a new file under `src-frida/methods/`.
2. Register it in `src-frida/methods/index.ts`.
3. Rebuild the agent bundle (`bun run compile`) so `src-frida/dist/index.js` updates.
4. Ensure the session has a loaded script (`frida_load_default_script`).
5. Call from FE:

- `await useFridaStore.getState().agentRequest("your_method", params)`

### 3) Add a streaming event (Agent → FE)

If you want continuous events (e.g. thread creation, stalker events):

1. In agent: `send({ type: 'carf:event', ... })`
2. In FE: listen using `src/features/frida/events.ts` (`scriptMessage`) and filter by session/script.

## Example: calling the existing agent methods

Assuming you have:

- `sessionId` from `frida_attach`
- `scriptId` from `frida_load_default_script`

Call `get_arch`:

- `await useFridaStore.getState().agentRequest("get_arch")`

Expected return:

- `{ arch: "x64" | "arm64" | ... }`
