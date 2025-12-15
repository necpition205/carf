import { create } from "zustand";

import type { DeviceInfo, ProcessInfo, SessionAttachedEvent, SessionDetachedEvent } from "./types";
import { agentRpc } from "./agentRpc";
import { fridaBackendApi } from "./backendApi";
import { fridaEvents } from "./events";

type StoreState = {
  busy: boolean;
  error: string | null;

  version: string;
  devices: DeviceInfo[];
  selectedDeviceId: string;
  processes: ProcessInfo[];

  attachedSessionId: number | null;
  loadedScriptId: number | null;

  listenersReady: boolean;
};

type StoreActions = {
  clearError: () => void;
  setSelectedDeviceId: (deviceId: string) => void;

  init: () => Promise<void>;
  startListeners: () => Promise<void>;
  stopListeners: () => void;

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

  agentRequest: (method: string, params?: unknown) => Promise<unknown>;
};

let unlistenAttached: (() => void) | null = null;
let unlistenDetached: (() => void) | null = null;

let initDone = false;
let initInFlight: Promise<void> | null = null;

let refreshProcessesInFlight: Promise<void> | null = null;
let refreshProcessesInFlightDeviceId: string | null = null;

function withErrorHandling<T>(
  set: (partial: Partial<StoreState>) => void,
  op: () => Promise<T>,
): Promise<T> {
  set({ busy: true, error: null });
  return op()
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      set({ error: message });
      throw e;
    })
    .finally(() => {
      set({ busy: false });
    });
}

export const useFridaStore = create<StoreState & StoreActions>((set, get) => ({
  busy: false,
  error: null,

  version: "",
  devices: [],
  selectedDeviceId: "",
  processes: [],

  attachedSessionId: null,
  loadedScriptId: null,

  listenersReady: false,

  clearError: () => set({ error: null }),
  setSelectedDeviceId: (deviceId) => set({ selectedDeviceId: deviceId }),

  init: async () => {
    if (initDone) return;

    // React StrictMode runs effects twice in dev. Keep init idempotent to avoid repeated
    // Frida calls (process enumeration can crash if spammed).
    if (initInFlight) {
      await initInFlight;
      return;
    }

    initInFlight = (async () => {
      await get().startListeners();
      await get().refreshVersion();
      await get().refreshDevices();
    })();

    try {
      await initInFlight;
      initDone = true;
    } finally {
      initInFlight = null;
    }
  },

  startListeners: async () => {
    if (get().listenersReady) return;

    const onAttached = (_p: SessionAttachedEvent) => {
      set({
        attachedSessionId: _p.session_id,
        loadedScriptId: _p.script_id,
      });
    };

    const onDetached = (_p: SessionDetachedEvent) => {
      set({
        attachedSessionId: null,
        loadedScriptId: null,
      });
    };

    unlistenAttached = await fridaEvents.sessionAttached(onAttached);
    unlistenDetached = await fridaEvents.sessionDetached(onDetached);

    // Agent RPC listener is FE-side (not Rust), but we treat it as part of the feature.
    await agentRpc.start();

    set({ listenersReady: true });
  },

  stopListeners: () => {
    if (unlistenAttached) {
      unlistenAttached();
      unlistenAttached = null;
    }

    if (unlistenDetached) {
      unlistenDetached();
      unlistenDetached = null;
    }

    agentRpc.stop();

    set({ listenersReady: false });
  },

  refreshVersion: async () => {
    await withErrorHandling(set, async () => {
      const version = await fridaBackendApi.version();
      set({ version });
    });
  },

  refreshDevices: async () => {
    await withErrorHandling(set, async () => {
      const devices = await fridaBackendApi.listDevices();

      let selectedDeviceId = get().selectedDeviceId;
      if (!selectedDeviceId) {
        selectedDeviceId = devices.find((d) => d.id === "local")?.id ?? devices[0]?.id ?? "";
      }

      set({ devices, selectedDeviceId });
    });
  },

  refreshProcesses: async (deviceId) => {
    const id = deviceId ?? get().selectedDeviceId;
    if (!id) {
      set({ processes: [] });
      return;
    }

    if (refreshProcessesInFlight && refreshProcessesInFlightDeviceId === id) {
      await refreshProcessesInFlight;
      return;
    }

    const request = withErrorHandling(set, async () => {
      const processes = await fridaBackendApi.listProcesses(id);
      set({ processes });
    });

    refreshProcessesInFlight = request;
    refreshProcessesInFlightDeviceId = id;

    try {
      await request;
    } finally {
      if (refreshProcessesInFlight === request) {
        refreshProcessesInFlight = null;
        refreshProcessesInFlightDeviceId = null;
      }
    }
  },

  attach: async (pid) => {
    await get().startListeners();

    const deviceId = get().selectedDeviceId;
    if (!deviceId) throw new Error("No device selected");

    await withErrorHandling(set, async () => {
      const session = await fridaBackendApi.attach(deviceId, pid);
      set({ attachedSessionId: session.session_id, loadedScriptId: session.script_id });
    });
  },

  detach: async () => {
    await get().startListeners();

    const sessionId = get().attachedSessionId;
    if (sessionId == null) return;

    await withErrorHandling(set, async () => {
      await fridaBackendApi.detach(sessionId);
      set({ attachedSessionId: null, loadedScriptId: null });
    });
  },

  spawn: async (program, argv) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) throw new Error("No device selected");

    return await withErrorHandling(set, async () => {
      return await fridaBackendApi.spawn(deviceId, program, argv);
    });
  },

  resume: async (pid) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) return;

    await withErrorHandling(set, async () => {
      await fridaBackendApi.resume(deviceId, pid);
    });
  },

  kill: async (pid) => {
    const deviceId = get().selectedDeviceId;
    if (!deviceId) return;

    await withErrorHandling(set, async () => {
      await fridaBackendApi.kill(deviceId, pid);
    });
    await get().refreshProcesses(deviceId);
  },

  loadDefaultScript: async () => {
    const alreadyLoaded = get().loadedScriptId;
    if (alreadyLoaded != null) return alreadyLoaded;

    const sessionId = get().attachedSessionId;
    if (sessionId == null) throw new Error("No attached session");

    return await withErrorHandling(set, async () => {
      const info = await fridaBackendApi.loadDefaultScript(sessionId);
      set({ loadedScriptId: info.script_id });
      return info.script_id;
    });
  },

  unloadScript: async () => {
    const scriptId = get().loadedScriptId;
    if (scriptId == null) return;

    await withErrorHandling(set, async () => {
      await fridaBackendApi.unloadScript(scriptId);
      set({ loadedScriptId: null });
    });
  },

  agentRequest: async (method, params) => {
    const scriptId = get().loadedScriptId;
    if (scriptId == null) throw new Error("No loaded script");

    return await withErrorHandling(set, async () => {
      return await agentRpc.request(scriptId, method, params);
    });
  },
}));
