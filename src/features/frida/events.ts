import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ScriptMessageEvent, SessionAttachedEvent, SessionDetachedEvent } from "./types";

// Typed event listeners around Tauri events.
export const fridaEvents = {
  sessionAttached: async (
    handler: (payload: SessionAttachedEvent) => void,
  ): Promise<UnlistenFn> => {
    return await listen<SessionAttachedEvent>("frida_session_attached", (event) => {
      handler(event.payload);
    });
  },

  sessionDetached: async (
    handler: (payload: SessionDetachedEvent) => void,
  ): Promise<UnlistenFn> => {
    return await listen<SessionDetachedEvent>("frida_session_detached", (event) => {
      handler(event.payload);
    });
  },

  scriptMessage: async (
    handler: (payload: ScriptMessageEvent) => void,
  ): Promise<UnlistenFn> => {
    return await listen<ScriptMessageEvent>("frida_script_message", (event) => {
      handler(event.payload);
    });
  },
};
