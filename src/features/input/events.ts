import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { GlobalKeyEvent, ListenErrorEvent } from "./types";

// Typed listeners for rdev events emitted by the Rust backend.
export const rdevEvents = {
  keyEvent: async (handler: (payload: GlobalKeyEvent) => void): Promise<UnlistenFn> => {
    return await listen<GlobalKeyEvent>("rdev_key_event", (event) => {
      handler(event.payload);
    });
  },

  listenError: async (handler: (payload: ListenErrorEvent) => void): Promise<UnlistenFn> => {
    return await listen<ListenErrorEvent>("rdev_listen_error", (event) => {
      handler(event.payload);
    });
  },
};
