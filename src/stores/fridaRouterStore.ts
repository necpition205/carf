import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

type ScriptMessageEnvelope = {
  session_id: number;
  script_id: number;
  message: unknown;
  data?: number[];
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

const pending = new Map<number, PendingRequest>();

function isResponseEnvelope(envelope: ScriptMessageEnvelope): envelope is ScriptMessageEnvelope & {
  message: {
    type: "send";
    payload: { type: "carf:response"; id: number; result: string; returns: unknown };
  };
} {
  const msg = envelope.message as { type?: unknown; payload?: unknown };
  if (!msg || msg.type !== "send") return false;
  const payload = msg.payload as { type?: unknown; id?: unknown; result?: unknown };
  return (
    !!payload &&
    payload.type === "carf:response" &&
    typeof payload.id === "number" &&
    typeof payload.result === "string"
  );
}

export type FridaRouterStoreState = {
  listenerReady: boolean;
  startListener: () => Promise<void>;
  stopListener: () => void;

  loadDefaultScript: (sessionId: number) => Promise<{ script_id: number }>;
  unloadScript: (scriptId: number) => Promise<void>;

  post: (scriptId: number, message: unknown, data?: Uint8Array) => Promise<void>;
  request: (scriptId: number, method: string, params?: unknown) => Promise<unknown>;
};

let unlisten: UnlistenFn | null = null;
let nextRequestId = 1;

export const useFridaRouterStore = create<FridaRouterStoreState>((set, get) => ({
  listenerReady: false,

  startListener: async () => {
    if (unlisten) {
      set({ listenerReady: true });
      return;
    }

    unlisten = await listen<ScriptMessageEnvelope>("frida_script_message", (event) => {
      const envelope = event.payload;
      if (!isResponseEnvelope(envelope)) return;

      const { id, result, returns } = envelope.message.payload;
      const req = pending.get(id);
      if (!req) return;

      pending.delete(id);

      if (result === "ok") req.resolve(returns);
      else req.reject(returns);
    });

    set({ listenerReady: true });
  },

  stopListener: () => {
    if (!unlisten) return;
    const fn = unlisten;
    unlisten = null;
    set({ listenerReady: false });
    pending.clear();
    fn();
  },

  loadDefaultScript: async (sessionId) => {
    return await invoke<{ script_id: number }>("frida_load_default_script", {
      session_id: sessionId,
    });
  },

  unloadScript: async (scriptId) => {
    await invoke<void>("frida_unload_script", { script_id: scriptId });
  },

  post: async (scriptId, message, data) => {
    await invoke<void>("frida_script_post", {
      script_id: scriptId,
      message,
      data: data ? Array.from(data) : undefined,
    });
  },

  request: async (scriptId, method, params) => {
    await get().startListener();

    const id = nextRequestId++;

    const message = {
      type: "carf:request",
      payload: {
        id,
        method,
        params,
      },
    };

    const p = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    await get().post(scriptId, message);
    return await p;
  },
}));
