import { invoke } from "@tauri-apps/api/core";

export type DeviceInfo = {
  id: string;
  name: string;
  device_type: string;
};

export type ProcessInfo = {
  pid: number;
  name: string;
};

export type SessionInfo = {
  session_id: number;
};

export type ScriptInfo = {
  script_id: number;
};

export async function fridaVersion() {
  return await invoke<string>("frida_version");
}

export async function fridaListDevices() {
  return await invoke<DeviceInfo[]>("frida_list_devices");
}

export async function fridaListProcesses(deviceId: string) {
  return await invoke<ProcessInfo[]>("frida_list_processes", {
    device_id: deviceId,
  });
}

export async function fridaAttach(deviceId: string, pid: number) {
  return await invoke<SessionInfo>("frida_attach", {
    device_id: deviceId,
    pid,
  });
}

export async function fridaDetach(sessionId: number) {
  return await invoke<void>("frida_detach", {
    session_id: sessionId,
  });
}

export async function fridaSpawn(deviceId: string, program: string, argv?: string[] | null) {
  return await invoke<number>("frida_spawn", {
    device_id: deviceId,
    program,
    argv: argv ?? null,
  });
}

export async function fridaResume(deviceId: string, pid: number) {
  return await invoke<void>("frida_resume", {
    device_id: deviceId,
    pid,
  });
}

export async function fridaKill(deviceId: string, pid: number) {
  return await invoke<void>("frida_kill", {
    device_id: deviceId,
    pid,
  });
}

export async function fridaLoadDefaultScript(sessionId: number) {
  return await invoke<ScriptInfo>("frida_load_default_script", {
    session_id: sessionId,
  });
}

export async function fridaUnloadScript(scriptId: number) {
  return await invoke<void>("frida_unload_script", {
    script_id: scriptId,
  });
}

export async function fridaScriptPost(scriptId: number, message: unknown, data?: Uint8Array) {
  return await invoke<void>("frida_script_post", {
    script_id: scriptId,
    message,
    data: data ? Array.from(data) : undefined,
  });
}
