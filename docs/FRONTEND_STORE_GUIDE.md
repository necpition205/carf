# Frontend Guide: Backend Invoke Spec → Typed API → Zustand Store (Clean Architecture)

This guide is written for web developers who want an Express/Elysia-like DX while building CARF features.

## Goal

When you add a new feature, you should be able to answer:

- **What is the backend command name?** (Tauri command)
- **What is the TS signature?** (typed API wrapper)
- **Where does state live?** (Zustand store)
- **How do I react to backend events?** (typed event listeners)

## Feature module layout (recommended)

CARF’s frontend is organized per feature under `src/features/<feature>/`.

For Frida (`src/features/frida/`):

- `types.ts`
  - Shared type definitions for this feature.
- `backendApi.ts`
  - Thin typed wrappers around Tauri `invoke`.
- `events.ts`
  - Thin typed wrappers around Tauri `listen`.
- `agentRpc.ts`
  - Request/response matching for talking to the injected agent.
- `store.ts`
  - Zustand store (state + actions).

This keeps the DX close to what web devs expect: one folder per feature, minimal files.

## 1) Backend command spec (Rust)

Backend commands are registered in:

- `src-tauri/src/commands/mod.rs` (router-like handler)
- `src-tauri/src/commands/frida.rs` (commands)

Example command name:

- Rust function `frida_list_processes` with `#[tauri::command(rename_all = "snake_case")]`
- Frontend calls: `invoke("frida_list_processes", { device_id })`

### Rule of thumb

- Command name = Rust function name
- Args are snake_case JSON keys (use `rename_all = "snake_case"` consistently)

## 2) Typed API wrapper

Create a thin wrapper in `<feature>/backendApi.ts`.

Example:

- file: `src/features/frida/backendApi.ts`
- function: `listProcesses(deviceId: string)`

Properties of a good wrapper:

- **No React / no Zustand**
- **No business logic**
- Just input mapping + `invoke` + return type

## 3) Zustand store

Store responsibilities:

- Hold UI state (`busy`, `error`, list data, selection)
- Provide actions that call the typed API
- Subscribe to typed events (attach/detach/script messages)
- Orchestrate multi-step operations (init/startListeners)

### Store shape suggestion

- `busy/error` in every store
- Keep action names *verbs*:
  - `refreshDevices`, `attach`, `detach`, `loadDefaultScript`

### Error handling helper

`withErrorHandling(set, op)` pattern keeps code consistent.

## 4) Event-driven updates

Don’t make UI guess session state.

- Backend emits events (`frida_session_attached`, `frida_session_detached`)
- FE listens via `src/features/frida/events.ts`
- Store updates state from events

## 5) FE → Agent RPC pattern

The recommended approach is:

- Put request/response matching in `src/features/frida/agentRpc.ts`
- Store calls `agentRpc.request(scriptId, method, params)`

This mirrors how web developers build:

- REST client wrappers
- a request middleware
- and a store that consumes it

## Example: add a new backend command end-to-end

### Backend (Rust)

1. Implement in `src-tauri/src/frida_service.rs` (worker)
2. Expose in `src-tauri/src/commands/frida.rs`:

- `#[tauri::command(rename_all = "snake_case")]`
- `pub async fn frida_read_memory(...) -> Result<Vec<u8>, String>`

3. Register in `src-tauri/src/commands/mod.rs` `handler()`

### Frontend

1. Add typed API in `src/features/frida/backendApi.ts`

2. Add store action in `src/features/frida/store.ts`

3. Call in UI:

- `const { readMemory } = useFridaStore()`

## Testing tip

To quickly validate the wiring:

- Add a temporary UI button that calls the new action and prints JSON into a `<pre>`.

When it works, extract UI into a proper panel component.
