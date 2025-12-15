import { create } from "zustand";

import type { GlobalKeyEvent } from "./types";
import { rdevEvents } from "./events";

type InputStoreState = {
  listenerReady: boolean;
  error: string | null;

  lastKeyEvent: GlobalKeyEvent | null;
  history: GlobalKeyEvent[];

  startListener: () => Promise<void>;
  stopListener: () => void;
  clear: () => void;
};

let unlistenKey: (() => void) | null = null;
let unlistenError: (() => void) | null = null;

const MAX_HISTORY = 50;

export const useInputStore = create<InputStoreState>((set, get) => ({
  listenerReady: false,
  error: null,

  lastKeyEvent: null,
  history: [],

  startListener: async () => {
    if (get().listenerReady) return;

    unlistenKey = await rdevEvents.keyEvent((payload) => {
      set((prev) => {
        const nextHistory = [payload, ...prev.history].slice(0, MAX_HISTORY);
        return {
          lastKeyEvent: payload,
          history: nextHistory,
        };
      });
    });

    unlistenError = await rdevEvents.listenError((payload) => {
      set({ error: payload.error });
    });

    set({ listenerReady: true });
  },

  stopListener: () => {
    if (unlistenKey) {
      unlistenKey();
      unlistenKey = null;
    }

    if (unlistenError) {
      unlistenError();
      unlistenError = null;
    }

    set({ listenerReady: false });
  },

  clear: () => set({ lastKeyEvent: null, history: [], error: null }),
}));
