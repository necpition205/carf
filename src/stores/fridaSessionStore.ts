import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

export type SessionDetachReason = "user" | "disposed";

export type FridaSessionState = {
  attached: boolean;
  sessionId: number | null;
  deviceId: string | null;
  pid: number | null;

  lastDetachReason: SessionDetachReason | null;

  listenerReady: boolean;
  startListener: () => Promise<void>;
  stopListener: () => void;

  // Imperative setters (backendStore can call these)
  markAttached: (args: { sessionId: number; deviceId: string; pid: number }) => void;
  markDetached: (args: { sessionId: number; reason: SessionDetachReason }) => void;
};

let unlistenAttached: UnlistenFn | null = null;
let unlistenDetached: UnlistenFn | null = null;

export const useFridaSessionStore = create<FridaSessionState>((set, get) => ({
  attached: false,
  sessionId: null,
  deviceId: null,
  pid: null,
  lastDetachReason: null,

  listenerReady: false,

  startListener: async () => {
    if (unlistenAttached || unlistenDetached) {
      set({ listenerReady: true });
      return;
    }

    unlistenAttached = await listen<{
      session_id: number;
      device_id: string;
      pid: number;
    }>("frida_session_attached", (event) => {
      const { session_id, device_id, pid } = event.payload;
      get().markAttached({ sessionId: session_id, deviceId: device_id, pid });
    });

    unlistenDetached = await listen<{ session_id: number; reason: SessionDetachReason }>(
      "frida_session_detached",
      (event) => {
        const { session_id, reason } = event.payload;
        get().markDetached({ sessionId: session_id, reason });
      }
    );

    set({ listenerReady: true });
  },

  stopListener: () => {
    if (unlistenAttached) {
      unlistenAttached();
      unlistenAttached = null;
    }

    if (unlistenDetached) {
      unlistenDetached();
      unlistenDetached = null;
    }

    set({ listenerReady: false });
  },

  markAttached: ({ sessionId, deviceId, pid }) =>
    set({
      attached: true,
      sessionId,
      deviceId,
      pid,
      lastDetachReason: null,
    }),

  markDetached: ({ sessionId, reason }) => {
    const current = get().sessionId;
    // If we don't know current session (e.g. refresh race), accept detaches.
    if (current != null && current !== sessionId) return;

    set({
      attached: false,
      sessionId: null,
      deviceId: null,
      pid: null,
      lastDetachReason: reason,
    });
  },
}));
