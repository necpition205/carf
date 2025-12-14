import { create } from "zustand";

import * as api from "../api/fridaBackend";
import { useFridaSessionStore } from "./fridaSessionStore";

export type FridaBackendState = {
  busy: boolean;
  error: string | null;

  version: string;
  devices: api.DeviceInfo[];
  selectedDeviceId: string;
  processes: api.ProcessInfo[];

  attachedSessionId: number | null;

  loadedScriptId: number | null;

  setSelectedDeviceId: (deviceId: string) => void;
  clearError: () => void;

  refreshVersion: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  refreshProcesses: (deviceId?: string) => Promise<void>;

  attach: (pid: number) => Promise<void>;
  detach: () => Promise<void>;

  spawn: (program: string, argv?: string[] | null) => Promise<number>;
  resume: (pid: number) => Promise<void>;
  kill: (pid: number) => Promise<void>;

  loadDefaultScript: () => Promise<number>;
  unloadScript: () => Promise<void>;

  scriptPost: (message: unknown, data?: Uint8Array) => Promise<void>;
};

export const useFridaBackendStore = create<FridaBackendState>((set, get) => ({
  busy: false,
  error: null,

  version: "",
  devices: [],
  selectedDeviceId: "",
  processes: [],

  attachedSessionId: null,
  loadedScriptId: null,

  setSelectedDeviceId: (deviceId) => set({ selectedDeviceId: deviceId }),
  clearError: () => set({ error: null }),

  refreshVersion: async () => {
    set({ busy: true, error: null });
    try {
      const version = await api.fridaVersion();
      set({ version });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  refreshDevices: async () => {
    set({ busy: true, error: null });
    try {
      const devices = await api.fridaListDevices();
      let selectedDeviceId = get().selectedDeviceId;
      if (!selectedDeviceId) {
        selectedDeviceId = devices.find((d) => d.id === "local")?.id ?? devices[0]?.id ?? "";
      }
      set({ devices, selectedDeviceId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  refreshProcesses: async (deviceId) => {
    const id = deviceId ?? get().selectedDeviceId;
    if (!id) {
      set({ processes: [] });
      return;
    }

    set({ busy: true, error: null });
    try {
      const processes = await api.fridaListProcesses(id);
      set({ processes });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  attach: async (pid) => {
    await useFridaSessionStore.getState().startListener();

    const deviceId = get().selectedDeviceId;
    if (!deviceId) throw new Error("No device selected");

    set({ busy: true, error: null });
    try {
      const session = await api.fridaAttach(deviceId, pid);
      set({ attachedSessionId: session.session_id, loadedScriptId: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  detach: async () => {
    await useFridaSessionStore.getState().startListener();

    const sessionId = get().attachedSessionId;
    if (sessionId == null) return;

    set({ busy: true, error: null });
    try {
      await api.fridaDetach(sessionId);
      set({ attachedSessionId: null, loadedScriptId: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  spawn: async (program, argv) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) throw new Error("No device selected");

    set({ busy: true, error: null });
    try {
      return await api.fridaSpawn(deviceId, program, argv);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  resume: async (pid) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) return;
    await api.fridaResume(deviceId, pid);
  },

  kill: async (pid) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) return;
    await api.fridaKill(deviceId, pid);
    await get().refreshProcesses(deviceId);
  },

  loadDefaultScript: async () => {
    const sessionId = get().attachedSessionId;
    if (sessionId == null) throw new Error("No attached session");

    set({ busy: true, error: null });
    try {
      const info = await api.fridaLoadDefaultScript(sessionId);
      set({ loadedScriptId: info.script_id });
      return info.script_id;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  unloadScript: async () => {
    const scriptId = get().loadedScriptId;
    if (scriptId == null) return;

    set({ busy: true, error: null });
    try {
      await api.fridaUnloadScript(scriptId);
      set({ loadedScriptId: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  scriptPost: async (message, data) => {
    const scriptId = get().loadedScriptId;
    if (scriptId == null) throw new Error("No loaded script");

    set({ busy: true, error: null });
    try {
      await api.fridaScriptPost(scriptId, message, data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      throw e;
    } finally {
      set({ busy: false });
    }
  },
}));

useFridaSessionStore.subscribe((session) => {
  if (!session.attached) {
    useFridaBackendStore.setState({ attachedSessionId: null, loadedScriptId: null });
    return;
  }

  if (session.sessionId != null) {
    useFridaBackendStore.setState({ attachedSessionId: session.sessionId });
  }
});
