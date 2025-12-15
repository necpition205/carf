# 프론트엔드 가이드: Backend Invoke Spec → Typed API → Zustand Store (Clean Architecture)

웹 개발자가 CARF 기능을 확장할 때 **Express/Elysia 같은 DX**로 작업할 수 있도록 정리한 문서입니다.

## 목표

새 기능을 추가할 때 아래를 빠르게 매핑할 수 있어야 합니다.

- **백엔드 커맨드 이름이 무엇인가?** (Tauri command)
- **TS 시그니처는 어떻게 가져가나?** (typed API wrapper)
- **상태는 어디에 두나?** (Zustand store)
- **백엔드 이벤트는 어디서 받아 반영하나?** (typed event listeners)

## Feature 모듈 구조 (권장)

프론트는 기능별로 `src/features/<feature>/` 아래에 파일을 간단하게 둡니다.

Frida 예시 (`src/features/frida/`):

- `types.ts`
  - 해당 기능에서 공통으로 쓰는 타입 정의
- `backendApi.ts`
  - Tauri `invoke` thin wrapper (타입만 잡고 로직 최소화)
- `events.ts`
  - Tauri `listen` thin wrapper
- `agentRpc.ts`
  - Agent와 통신하는 request/response 매칭
- `store.ts`
  - Zustand store (state + actions)

이 구조는 “한 기능 폴더 = 필요한 최소 파일들”이라 유지보수가 쉽습니다.

## 1) Backend command spec (Rust)

커맨드 등록 위치:

- `src-tauri/src/commands/mod.rs` (라우터처럼 handler)
- `src-tauri/src/commands/frida.rs` (커맨드 구현)

예시:

- Rust `frida_list_processes` + `#[tauri::command(rename_all = "snake_case")]`
- FE 호출: `invoke("frida_list_processes", { device_id })`

### 규칙

- 커맨드 이름 = Rust 함수명
- args는 snake_case 키 사용 (가능하면 `rename_all = "snake_case"` 고정)

## 2) Typed API wrapper

`<feature>/backendApi.ts`에 “얇은 wrapper”를 둡니다.

좋은 wrapper의 조건:

- **React / Zustand 로직 없음**
- **비즈니스 로직 없음**
- input 매핑 + `invoke` + 리턴타입만

## 3) Zustand store (presentation)

Store 역할:

- UI 상태 보관 (`busy`, `error`, 리스트/선택 상태)
- typed API 호출하는 action 제공
- typed event 구독 (attach/detach/script 메시지)
- 멀티 스텝 작업(init/startListeners) 오케스트레이션

### Store 형태 추천

- 모든 store에 `busy/error` 포함
- action 이름은 동사 기반:
  - `refreshDevices`, `attach`, `detach`, `loadDefaultScript`

### 에러 처리 패턴

`withErrorHandling(set, op)` 같은 헬퍼로 action의 try/catch/finally를 통일합니다.

## 4) 이벤트 기반 상태 반영

UI가 session 상태를 추측하지 않도록:

- BE가 이벤트 emit (`frida_session_attached`, `frida_session_detached`)
- FE가 `src/features/frida/events.ts`로 listen
- store가 이벤트를 받아 state 갱신

## 5) FE → Agent RPC 패턴

권장 구조:

- request/response 매칭을 `src/features/frida/agentRpc.ts`로 분리
- store는 `agentRpc.request(scriptId, method, params)`만 호출

웹 개발 관점에서:

- REST client wrapper
- request middleware
- store가 소비

패턴과 거의 동일합니다.

## 예시: 백엔드 커맨드 end-to-end 추가

### Backend (Rust)

1. `src-tauri/src/frida_service.rs` (worker) 구현
2. `src-tauri/src/commands/frida.rs`에 command 노출

- `#[tauri::command(rename_all = "snake_case")]`
- `pub async fn frida_read_memory(...) -> Result<Vec<u8>, String>`

3. `src-tauri/src/commands/mod.rs`의 `handler()`에 등록

### Frontend

1. `src/features/frida/backendApi.ts`에 typed API 추가

2. `src/features/frida/store.ts`에 store action 추가

3. UI에서 호출:

- `const { readMemory } = useFridaStore()`

## 테스트 팁

배선(wiring) 확인은 간단하게:

- 임시 버튼 + 결과를 `<pre>`로 출력하는 방식이 가장 빠릅니다.

동작 확인 후, 제대로 된 패널 컴포넌트로 분리하세요.
