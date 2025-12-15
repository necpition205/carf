# CARF 통신/확장 가이드 (Backend ↔ Frontend ↔ Agent)

이 문서는 CARF에서 **Tauri(Rust 백엔드)**, **React(프론트엔드)**, **Frida Agent(주입 스크립트)**가 어떻게 연결되는지와, 기능을 확장하는 방법을 정리합니다.

## 용어

- **FE**: Frontend (React, TypeScript)
- **BE**: Backend (Tauri Rust)
- **Agent**: 타겟 프로세스 안에서 동작하는 Frida Script (`src-frida/`에서 컴파일됨)

## 전체 구조

CARF는 3-hop 모델입니다.

1. **FE → BE**: Tauri command (`invoke`)
2. **BE → FE**: Tauri event (`app.emit` + `listen`)
3. **BE ↔ Agent**: Frida script messaging (`script.post` / `send` / `recv`)

Frida Rust 바인딩 타입은 대부분 `!Send/!Sync`라서, CARF는 Frida 호출을 **전용 워커 스레드 1개**에서만 수행합니다.

## Backend(Rust) API

### Commands (FE → BE)

Command 등록은 한 곳에서 관리합니다.

- `src-tauri/src/commands/mod.rs`의 `handler()`
- `src-tauri/src/lib.rs`에서 `.invoke_handler(commands::handler())`

즉, 새로운 API 추가 DX는 “라우터”처럼 **함수 추가 + handler에 마운트**로 끝나도록 설계합니다.

현재 노출된 commands:

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

백엔드는 아래 이벤트를 emit 합니다.

- `frida_session_attached`
  - payload: `{ session_id: number, device_id: string, pid: number }`
- `frida_session_detached`
  - payload: `{ session_id: number, reason: "user" | "disposed" }`
- `frida_script_message`
  - payload: `{ session_id: number, script_id: number, message: ScriptMessage, data?: number[] }`

`ScriptMessage`는 Rust에서 정규화한 envelope입니다.

- `{ type: "send", payload: { type, id, result, returns } }`
- `{ type: "log", payload: { level, payload } }`
- `{ type: "error", payload: { description, stack, file_name, line_number, column_number } }`
- `{ type: "other", payload: any }`

### Global input events (rdev)

백엔드는 `rdev` 크레이트를 사용해 글로벌 키보드 이벤트도 emit 합니다.

- `rdev_key_event`
  - payload: `{ action: "press" | "release", key: string, name: string | null, modifiers: { ctrl, shift, alt, meta } }`
- `rdev_listen_error`
  - payload: `{ error: string }`

프론트 구현 위치:

- `src/features/input/events.ts`
- `src/features/input/store.ts`

## Agent 메시징 모델

### Backend → Agent

백엔드는 `script.post(message_json, data)`를 호출합니다.

- `message_json`: JSON 문자열
- `data`: optional bytes

Agent에서는 `recv(<channel>, callback)`로 수신합니다.

### Agent → Backend

Agent는 Frida의 `send(payload)`를 사용합니다.

Rust에서는 이것이 `Message::Send`로 들어오고, CARF가 이를 `frida_script_message` 이벤트로 FE에 전달합니다.

## 기본 Agent의 RPC 프로토콜

기본 Agent는 request/response RPC를 구현합니다.

- Host → Agent: `recv("carf:request", ...)`
- Agent → Host: `send({ type: "carf:response", id, result, returns })`

### Request 형태 (host → agent)

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

### Response 형태 (agent → host)

```json
{
  "type": "carf:response",
  "id": 1,
  "result": "ok",
  "returns": { "pong": true }
}
```

Agent 소스는 `src-frida/index.ts`에 있습니다.

## Frontend 구현 위치

### FE → BE

- typed invoke wrapper: `src/features/frida/backendApi.ts`
- 상태/액션 store: `src/features/frida/store.ts`

### FE ↔ Agent (BE를 경유)

- request/response 매칭: `src/features/frida/agentRpc.ts`
  - `frida_script_message` listen
  - `carf:response`를 `id`로 매칭하여 Promise resolve/reject

### Session 라이프사이클

- `src/features/frida/store.ts`: `frida_session_attached/detached` listen 및 상태 반영

## CARF 확장 방법 (DX 우선)

### 1) Backend command 추가 (Express 느낌 “route” 추가)

예: `frida_read_memory`를 추가하고 싶다면

1. `src-tauri/src/commands/` 아래 모듈(`frida.rs` 또는 `memory.rs` 같은 신규 파일)에 command 함수 추가
2. `src-tauri/src/commands/mod.rs`의 `handler()`에 command를 추가(마운트)
3. `src/features/frida/backendApi.ts`에 invoke wrapper 추가
4. (옵션) `src/features/frida/store.ts`에 액션 추가

Express와 비교하면:

- Express: `router.get('/read-memory', ...)` 후 `app.use(router)`
- CARF: `commands::memory::read_memory` 후 `commands::handler()`에 등록

### 2) Agent RPC 메서드 추가 (FE → Agent)

1. `src-frida/methods/` 아래에 신규 파일을 추가
2. `src-frida/methods/index.ts`에 등록
3. `bun run compile`로 `src-frida/dist/index.js` 갱신
4. 세션에 스크립트가 로드되어 있어야 함 (`frida_load_default_script`)
5. FE에서 호출:

- `await useFridaStore.getState().agentRequest("your_method", params)`

### 3) 스트리밍 이벤트 추가 (Agent → FE)

스레드 생성/스톨커 같은 지속 이벤트를 받고 싶다면

1. Agent에서 `send({ type: 'carf:event', ... })`
2. FE에서 `src/features/frida/events.ts` (`scriptMessage`)로 listen + session/script 필터링

## 예제: 현재 구현된 agent 메서드 호출

아래가 준비되어 있다고 가정:

- `sessionId`: `frida_attach` 결과
- `scriptId`: `frida_load_default_script` 결과

`get_arch` 호출:

- `await useFridaStore.getState().agentRequest("get_arch")`

예상 결과:

- `{ arch: "x64" | "arm64" | ... }`
