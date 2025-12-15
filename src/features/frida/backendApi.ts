import { invoke } from "@tauri-apps/api/core";

import type { DeviceInfo, ProcessInfo, ScriptInfo, SessionInfo } from "./types";

// Thin typed wrappers around Tauri commands.
export const fridaBackendApi = {
  version: async () => {
    return await invoke<string>("frida_version");
  },

  listDevices: async () => {
    return await invoke<DeviceInfo[]>("frida_list_devices");
  },

  listProcesses: async (deviceId: string) => {
    return await invoke<ProcessInfo[]>("frida_list_processes", {
      device_id: deviceId,
    });
  },

  attach: async (deviceId: string, pid: number) => {
    return await invoke<SessionInfo>("frida_attach", {
      device_id: deviceId,
      pid,
    });
  },

  detach: async (sessionId: number) => {
    return await invoke<void>("frida_detach", {
      session_id: sessionId,
    });
  },

  spawn: async (deviceId: string, program: string, argv?: string[] | null) => {
    return await invoke<number>("frida_spawn", {
      device_id: deviceId,
      program,
      argv: argv ?? null,
    });
  },

  resume: async (deviceId: string, pid: number) => {
    return await invoke<void>("frida_resume", {
      device_id: deviceId,
      pid,
    });
  },

  kill: async (deviceId: string, pid: number) => {
    return await invoke<void>("frida_kill", {
      device_id: deviceId,
      pid,
    });
  },

  loadDefaultScript: async (sessionId: number) => {
    return await invoke<ScriptInfo>("frida_load_default_script", {
      session_id: sessionId,
    });
  },

  unloadScript: async (scriptId: number) => {
    return await invoke<void>("frida_unload_script", {
      script_id: scriptId,
    });
  },

  scriptPost: async (scriptId: number, message: unknown, data?: Uint8Array) => {
    return await invoke<void>("frida_script_post", {
      script_id: scriptId,
      message,
      data: data ? Array.from(data) : undefined,
    });
  },
};
